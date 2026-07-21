import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { parseLiveSearchItemIds } from "../services/LiveSearchEvents";
import { Poe2WebsocketClient } from "../services/Poe2WebsocketClient";
import { Poe2Trade } from "../services/poe2trade";
import { Poe2Item } from "../services/types";

const LIVE_ITEM_BATCH_DELAY_MS = 5_000;

type LiveListingMonitorOptions = {
  accountName: string;
  league: string;
  setItems: Dispatch<SetStateAction<Poe2Item[]>>;
  setLiveSearchItems: Dispatch<SetStateAction<Poe2Item[]>>;
};

export function useLiveListingMonitor({
  accountName,
  league,
  setItems,
  setLiveSearchItems,
}: LiveListingMonitorOptions) {
  const wsRef = useRef<Poe2WebsocketClient | null>(null);
  const monitoringRef = useRef(false);
  const generationRef = useRef(0);
  const pendingItemIds = useRef(new Set<string>());
  const batchTimerRef = useRef<number | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPendingBatch = useCallback(() => {
    if (batchTimerRef.current !== null) {
      window.clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingItemIds.current.clear();
  }, []);

  const stop = useCallback(
    (clearLiveItems: boolean) => {
      generationRef.current += 1;
      monitoringRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      clearPendingBatch();
      setIsStarting(false);
      setIsMonitoring(false);
      if (clearLiveItems) {
        setLiveSearchItems([]);
      }
    },
    [clearPendingBatch, setLiveSearchItems],
  );

  const flushPendingItems = useCallback(async () => {
    batchTimerRef.current = null;
    if (!monitoringRef.current) {
      pendingItemIds.current.clear();
      return;
    }

    const itemIds = [...pendingItemIds.current];
    pendingItemIds.current.clear();
    if (!itemIds.length) {
      return;
    }

    try {
      Poe2Trade.upsertCachedAccountItems(accountName, itemIds, league);
      const newItems = await Poe2Trade.fetchAllItems(
        accountName,
        itemIds,
        true,
        league,
      );
      if (!monitoringRef.current || !newItems.length) {
        return;
      }

      const fetchedIds = new Set(newItems.map((item) => item.id));
      setLiveSearchItems((current) => [
        ...newItems,
        ...current.filter((item) => !fetchedIds.has(item.id)),
      ]);
      setItems((current) => [
        ...newItems,
        ...current.filter((item) => !fetchedIds.has(item.id)),
      ]);
    } catch (fetchError) {
      console.error("Unable to fetch new live-search items", fetchError);
      setError("A new item was detected but could not be fetched.");
    }
  }, [accountName, league, setItems, setLiveSearchItems]);

  const queueLiveItems = useCallback(
    (itemIds: string[]) => {
      itemIds.forEach((itemId) => pendingItemIds.current.add(itemId));
      if (batchTimerRef.current === null && pendingItemIds.current.size > 0) {
        batchTimerRef.current = window.setTimeout(
          () => void flushPendingItems(),
          LIVE_ITEM_BATCH_DELAY_MS,
        );
      }
    },
    [flushPendingItems],
  );

  const setupWebSocket = useCallback(
    (searchId: string, generation: number) => {
      wsRef.current?.close();
      const ws = new Poe2WebsocketClient(`/live/poe2/${league}/${searchId}`);

      ws.onMessage = async (event: MessageEvent) => {
        if (
          generation !== generationRef.current ||
          !monitoringRef.current
        ) {
          return;
        }

        const message =
          typeof event.data === "string"
            ? event.data
            : event.data instanceof Blob
              ? await event.data.text()
              : "";
        queueLiveItems(parseLiveSearchItemIds(message));
      };
      ws.onClose = () => {
        if (
          generation === generationRef.current &&
          monitoringRef.current
        ) {
          monitoringRef.current = false;
          setIsMonitoring(false);
          setError(
            "Connection was lost. Reconnect to resume automatic sales updates.",
          );
        }
      };
      ws.onError = (webSocketError: Event) => {
        console.error("Live-search WebSocket error", webSocketError);
      };

      wsRef.current = ws;
    },
    [league, queueLiveItems],
  );

  const start = useCallback(async () => {
    const account = accountName.trim();
    if (!account || monitoringRef.current) {
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    monitoringRef.current = true;
    setIsStarting(true);
    setIsMonitoring(true);
    setError(null);

    try {
      const accountSearch = await Poe2Trade.getAccountLiveSearch(
        account,
        league,
      );
      if (
        generation !== generationRef.current ||
        !monitoringRef.current
      ) {
        return;
      }
      setupWebSocket(accountSearch.id, generation);
    } catch (startError) {
      console.error("Unable to start automatic sales monitor", startError);
      if (generation === generationRef.current) {
        monitoringRef.current = false;
        setIsMonitoring(false);
        setError(
          startError instanceof Error
            ? `Automatic sales monitor could not start: ${startError.message}`
            : "Automatic sales monitor could not start.",
        );
      }
    } finally {
      if (generation === generationRef.current) {
        setIsStarting(false);
      }
    }
  }, [accountName, league, setupWebSocket]);

  useEffect(() => {
    if (accountName.trim()) {
      void start();
    }

    return () => stop(true);
  }, [accountName, league, start, stop]);

  const toggle = useCallback(() => {
    if (monitoringRef.current) {
      stop(true);
      setError(null);
    } else {
      void start();
    }
  }, [start, stop]);

  return { isMonitoring, isStarting, error, toggle };
}
