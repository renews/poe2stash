import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { WebsocketClient } from "../services/WebsocketClient";
import { chatService } from "../services/ChatService";
import { PoeListItem } from "./PoeListItem";
import { Poe2Trade } from "../services/poe2trade";
import { Poe2Item, ChatOffer } from "../services/types";
import { useAppContext } from "../contexts/AppContext";
import { JobQueue } from "./JobQueue";
import {
  formFieldClassName,
  primaryButtonClassName,
} from "./formStyles";

const MessagesPage: React.FC = () => {
  const [chatFilePath, setChatFilePath] = useState(
    () => chatService.getSavedChatFilePath() || "",
  );
  const [offers, setOffers] = useState<ChatOffer[]>([]);
  const [accountItems, setAccountItems] = useState<Poe2Item[]>([]);
  const [messageSearchTerm, setMessageSearchTerm] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const {
    priceCheckItem,
    modifierRangePercent,
    selectedLeague,
    refreshItem,
    priceEstimates,
    modifierSelections,
    setModifierSelection,
    jobs,
    setJobs,
    setErrorMessage,
  } = useAppContext();

  const wsRef = useRef<WebsocketClient | null>(null);

  const fetchOffers = useCallback(async () => {
    try {
      const fetchedOffers = await chatService.getOffers();
      setOffers(fetchedOffers);
    } catch (error) {
      setErrorMessage("Error fetching offers: " + (error as Error).message);
      console.error("Error fetching offers:", error);
    }
  }, [setErrorMessage]);

  const fetchAccountItems = useCallback(async () => {
    const accountName = localStorage.getItem("accountName");
    const cachedAccountItems = accountName
      ? await Poe2Trade.getAllCachedAccountItems(accountName, selectedLeague)
      : [];
    if (cachedAccountItems.length === 0) {
      setErrorMessage(
        "No account items found. Please check your account name in the settings.",
      );
    }
    setAccountItems(cachedAccountItems);
  }, [selectedLeague, setErrorMessage]);

  const setupWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebsocketClient("/chat");
    ws.onMessage = async (event) => {
      console.log("Chat file changed:", event);

      if (event) {
        void fetchOffers();
        void fetchAccountItems();
      }
    };
    wsRef.current = ws;
  }, [fetchAccountItems, fetchOffers]);

  useEffect(() => {
    const initialize = async () => {
      const savedPath = chatService.getSavedChatFilePath();
      if (savedPath) {
        try {
          await chatService.setChatFilePath(savedPath);
        } catch (error) {
          chatService.clearSavedChatFilePath();
          setChatFilePath("");
          setErrorMessage(
            "Error restoring chat file: " + (error as Error).message,
          );
        }
      }

      setupWebSocket();
      await fetchOffers();
      await fetchAccountItems();
    };

    void initialize();

    return () => {
      if (wsRef) {
        wsRef.current?.close();
      }
    };
  }, [fetchAccountItems, fetchOffers, setErrorMessage, setupWebSocket]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatFilePath) {
      console.error("No file selected");
      return;
    }
    try {
      await chatService.setChatFilePath(chatFilePath);
      await fetchOffers();
      setupWebSocket(); // Reconnect WebSocket after setting new chat file
    } catch (error) {
      console.error("Error:", error);
      setErrorMessage("Error setting chat file: " + (error as Error).message);
    }
  };

  const findItem = (offer: ChatOffer) => {
    const item = offer.item;
    const foundItem =
      accountItems.find(
        (i) =>
          item.name.startsWith(i.item.name || i.item.typeLine) &&
          item.position.left == i.listing.stash.x &&
          item.position.top == i.listing.stash.y,
      ) ||
      accountItems.find((i) =>
        item.name.startsWith(i.item.name || i.item.typeLine),
      );

    return { found: foundItem, offer };
  };

  const foundOffers = offers
    .map((offer) => findItem(offer))
    .filter((o) => o.found || !activeOnly) as {
    found: Poe2Item;
    offer: ChatOffer;
  }[];

  const filteredOffers = useMemo(() => {
    return foundOffers.filter((offer) =>
      JSON.stringify(offer)
        .toLowerCase()
        .includes(messageSearchTerm.toLowerCase()),
    );
  }, [messageSearchTerm, foundOffers]);

  const getMessageContent = (message: string) => {
    return message.split("@From")[1];
  };

  const handleMessageSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageSearchTerm(e.target.value);
  };

  return (
    <div className="w-full p-4 pt-16">
      <h1 className="text-2xl font-bold mb-4">Chat Monitor</h1>
      <form onSubmit={handleSubmit} className="mb-4">
        <input
          type="file"
          onChange={(e) =>
            setChatFilePath(e.target.files?.[0]?.path || "")
          }
          accept=".txt,.log,.json"
          className={`${formFieldClassName} mr-2 file:mr-4 file:rounded-md file:border-0 file:bg-blue-500 file:px-3 file:py-1 file:font-semibold file:text-white hover:file:bg-blue-600`}
        />
        <button
          type="submit"
          className={primaryButtonClassName}
        >
          Load Messages
        </button>
      </form>
      {chatFilePath && (
        <p className="text-sm text-gray-400 mb-4">Log file: {chatFilePath}</p>
      )}

      <div className="flex items-center mb-4">
        <input
          type="text"
          value={messageSearchTerm}
          onChange={handleMessageSearch}
          placeholder="Search messages..."
          className={`${formFieldClassName} mr-2 flex-grow`}
        />
        <div className="flex items-center">
          <label htmlFor="activeOnly" className="mr-2">
            Active Only
          </label>
          <input
            type="checkbox"
            id="activeOnly"
            checked={activeOnly}
            onChange={() => setActiveOnly(!activeOnly)}
            className="form-checkbox h-5 w-5 text-blue-600 rounded"
          />
        </div>
      </div>

      {jobs.length > 0 && (
        <JobQueue
          jobs={jobs}
          setJobs={setJobs}
          setErrorMessage={setErrorMessage}
        />
      )}

      <div className="space-y-4">
        {filteredOffers.map((o, index) => (
          <div
            key={index}
            className="rounded-lg shadow-lg p-6 mb-6 bg-gray-750 transition-all duration-300 hover:shadow-xl"
          >
            <p className="mb-2 w-full text-left flex items-center">
              <span className="text-sm text-gray-400 mr-2">
                {new Date(o.offer.timestamp).toLocaleString()}
              </span>
              {getMessageContent(o.offer.message)}
            </p>
            {o.found && (
              <PoeListItem
                item={o.found}
                league={selectedLeague}
                key={o.found.id}
                onPriceClick={priceCheckItem}
                modifierRangePercent={modifierRangePercent}
                onRefreshClick={refreshItem}
                modifierSelection={modifierSelections[o.found.id]}
                onModifierSelectionChange={(selection) =>
                  setModifierSelection(o.found.id, selection)
                }
                priceSuggestion={priceEstimates[o.found.id]?.price}
                priceEstimate={priceEstimates[o.found.id]}
              />
            )}
            <div className="flex flex-col items-start mt-2">
              <div className="text-sm text-gray-600 text-left">
                <p>Account: {o.offer.characterName}</p>
                <p>Item: {o.offer.item.name}</p>
                <p>Price: {o.offer.item.price}</p>
                <p>Stash Tab: {o.offer.item.stashTab}</p>
                <p>
                  Position: Left {o.offer.item.position.left}, Top{" "}
                  {o.offer.item.position.top}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MessagesPage;
