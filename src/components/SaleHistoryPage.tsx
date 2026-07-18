import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  History as HistoryIcon,
  LogIn,
} from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import {
  MerchantHistoryError,
  merchantHistoryService,
} from "../services/MerchantHistoryService";
import {
  MerchantHistoryEntry,
  filterMerchantHistory,
  getMerchantHistoryItemTooltipDetails,
} from "../services/merchantHistory";
import {
  createMerchantHistoryUrl,
} from "../services/externalLinks";
import { loadPriceSnapshots } from "../services/priceHistory";
import {
  matchSalesToPriceSnapshots,
  summarizeSaleCalibration,
} from "../services/saleCalibration";
import {
  formFieldClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./formStyles";

function formatHistoryDate(timestamp: string | number) {
  if (!timestamp) {
    return "Unknown date";
  }

  const value =
    typeof timestamp === "number" && timestamp < 2_000_000_000
      ? timestamp * 1000
      : timestamp;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

const tooltipSectionColors: Record<string, string> = {
  Properties: "text-gray-300",
  Implicit: "text-blue-200",
  Enchant: "text-purple-200",
  Rune: "text-amber-200",
  Prefixes: "text-cyan-200",
  Suffixes: "text-fuchsia-200",
  "Other modifiers": "text-gray-200",
};

const MerchantHistoryItemTooltip: React.FC<{ entry: MerchantHistoryEntry }> = ({
  entry,
}) => {
  const cellRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<number | undefined>(undefined);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const details = getMerchantHistoryItemTooltipDetails(entry);

  const updatePosition = () => {
    const cell = cellRef.current;
    if (!cell) {
      return;
    }

    const rect = cell.getBoundingClientRect();
    const tooltipWidth = Math.min(448, window.innerWidth - 16);
    const tooltipHeight = Math.min(420, window.innerHeight - 16);
    const belowTop = rect.bottom + 8;
    const top =
      belowTop + tooltipHeight <= window.innerHeight
        ? belowTop
        : Math.max(8, rect.top - tooltipHeight - 8);
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - tooltipWidth - 8),
    );

    setPosition({ top, left });
  };

  const showTooltip = () => {
    window.clearTimeout(hideTimeout.current);
    updatePosition();
    setIsVisible(true);
  };

  const hideTooltip = () => {
    hideTimeout.current = window.setTimeout(() => setIsVisible(false), 120);
  };

  useEffect(() => {
    return () => window.clearTimeout(hideTimeout.current);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isVisible]);

  const tooltip = isVisible ? (
    <div
      className="fixed z-[100] max-h-[70vh] w-[28rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-gray-500 bg-gray-900 p-3 text-left text-xs text-gray-100 shadow-2xl"
      style={{ top: position.top, left: position.left }}
      onMouseEnter={() => window.clearTimeout(hideTimeout.current)}
      onMouseLeave={hideTooltip}
    >
      <div className="flex items-start gap-3 border-b border-gray-700 pb-2">
        {entry.itemIcon && (
          <img
            src={entry.itemIcon}
            alt=""
            className="h-12 w-12 rounded object-contain"
          />
        )}
        <div>
          <p className="font-semibold text-orange-300">{details.title}</p>
          <p className="text-gray-300">{details.subtitle}</p>
        </div>
      </div>

      {details.metadata.length > 0 && (
        <div className="mt-2 space-y-1 text-gray-400">
          {details.metadata.map((metadata) => (
            <p key={metadata}>{metadata}</p>
          ))}
        </div>
      )}

      {details.sections.map((section) => (
        <div key={section.title} className="mt-2">
          <p
            className={`font-semibold ${tooltipSectionColors[section.title] || "text-gray-200"}`}
          >
            {section.title}
          </p>
          <ul
            className={`mt-1 space-y-1 ${tooltipSectionColors[section.title] || "text-gray-200"}`}
          >
            {section.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}

      <p className="mt-3 border-t border-gray-700 pt-2 font-semibold text-yellow-300">
        {details.sale}
      </p>
    </div>
  ) : null;

  return (
    <div
      ref={cellRef}
      tabIndex={0}
      aria-label={`View details for ${details.title}`}
      className="relative flex w-fit cursor-help items-center gap-2 outline-none"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {entry.itemIcon && (
        <img
          src={entry.itemIcon}
          alt=""
          className="h-8 w-8 rounded object-contain"
        />
      )}
      <span>{entry.itemName}</span>
      {entry.itemTypeLine !== entry.itemName && (
        <span className="block text-xs text-gray-400">
          {entry.itemTypeLine}
        </span>
      )}
      {typeof document !== "undefined" && tooltip
        ? createPortal(tooltip, document.body)
        : null}
    </div>
  );
};

const SaleHistoryPage: React.FC = () => {
  const { selectedLeague } = useAppContext();
  const [entries, setEntries] = useState<MerchantHistoryEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [session, setSession] = useState<{ loggedIn: boolean; cookiePresent: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const history = await merchantHistoryService.fetchHistory(selectedLeague);
      setEntries(history);
      setLastFetchedAt(Date.now());
      setSession({ loggedIn: true, cookiePresent: true });
    } catch (error) {
      if (error instanceof MerchantHistoryError && error.status === 401) {
        setSession({ loggedIn: false, cookiePresent: false });
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Ange Merchant History.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedLeague]);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        const currentSession = await merchantHistoryService.getSession();
        if (!isMounted) {
          return;
        }

        setSession(currentSession);
        if (currentSession.loggedIn) {
          await refreshHistory();
        }
      } catch (error) {
        if (isMounted) {
          setSession({ loggedIn: false, cookiePresent: false });
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to check the Path of Exile session.",
          );
        }
      }
    };

    void initialize();
    return () => {
      isMounted = false;
    };
  }, [refreshHistory]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);

    try {
      const nextSession = await merchantHistoryService.login();
      setSession(nextSession);
      if (nextSession.loggedIn) {
        await refreshHistory();
      } else {
        setErrorMessage("Log in to pathofexile.com to view Ange Merchant History.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to open the login window.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const openMerchantHistoryInBrowser = () => {
    window.open(createMerchantHistoryUrl(), "_blank");
  };

  const filteredEntries = useMemo(
    () => filterMerchantHistory(entries, searchTerm),
    [entries, searchTerm],
  );
  const priceSnapshots = useMemo(() => loadPriceSnapshots(), []);
  const calibrationMatches = useMemo(
    () =>
      matchSalesToPriceSnapshots(entries, priceSnapshots, selectedLeague),
    [entries, priceSnapshots, selectedLeague],
  );
  const calibrationBySaleId = useMemo(
    () =>
      new Map(
        calibrationMatches.map((match) => [match.sale.id, match] as const),
      ),
    [calibrationMatches],
  );
  const calibration = useMemo(
    () => summarizeSaleCalibration(calibrationMatches),
    [calibrationMatches],
  );

  return (
    <div className="w-full p-4 pt-16">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <HistoryIcon className="h-8 w-8 text-blue-300" />
          <div>
            <h1 className="text-2xl font-bold">Sale History</h1>
            <p className="text-sm text-gray-400">
              Completed shop sales from Ange Merchant History in {selectedLeague}.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-gray-800 p-4 text-sm text-gray-300 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-100">
              Ange Merchant History
            </p>
            <p className="mt-1">
              This is separate from Chat Monitor and does not read incoming trade
              whispers.
            </p>
            <p className="mt-1 text-gray-400">
              Log in here to load sales inside the app, or open the official
              history in your default browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session !== null && !session.loggedIn && (
              <button
                onClick={() => void handleLogin()}
                disabled={isLoading || isLoggingIn}
                className={`${primaryButtonClassName} inline-flex items-center gap-2`}
              >
                <LogIn className="h-4 w-4" />
                {isLoggingIn ? "Waiting for login..." : "Log in for app history"}
              </button>
            )}
            <button
              onClick={openMerchantHistoryInBrowser}
              className={`${secondaryButtonClassName} inline-flex items-center gap-2`}
            >
              <ExternalLink className="h-4 w-4" />
              Open in browser
            </button>
          </div>
        </div>
        {lastFetchedAt && (
          <p className="mt-1 text-gray-400">
            Last fetched: {new Date(lastFetchedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="mb-4 rounded-lg bg-gray-800 p-4 shadow-lg">
        <p className="font-semibold text-gray-100">Pricing calibration</p>
        {calibration.matchedSales > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md bg-gray-700 p-3">
              <p className="text-xs text-gray-400">Matched sales</p>
              <p className="text-lg font-semibold text-blue-200">
                {calibration.matchedSales}
              </p>
            </div>
            <div className="rounded-md bg-gray-700 p-3">
              <p className="text-xs text-gray-400">Median price error</p>
              <p className="text-lg font-semibold text-orange-200">
                {calibration.medianAbsoluteErrorPercent.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-md bg-gray-700 p-3">
              <p className="text-xs text-gray-400">Under / over</p>
              <p className="text-lg font-semibold text-purple-200">
                {calibration.underpriced} / {calibration.overpriced}
              </p>
            </div>
            <div className="rounded-md bg-gray-700 p-3">
              <p className="text-xs text-gray-400">Median time to sell</p>
              <p className="text-lg font-semibold text-green-200">
                {calibration.medianHoursToSell.toFixed(1)}h
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-400">
            Future sales will be matched with saved price checks to measure
            suggestion accuracy and time to sell.
          </p>
        )}
      </div>

      <input
        type="search"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search item, buyer, currency, or note..."
        className={`${formFieldClassName} mb-4 w-full`}
      />

      {errorMessage && (
        <p className="mb-4 rounded-md bg-red-900/40 p-3 text-red-200">
          {errorMessage}
        </p>
      )}

      <p className="mb-3 text-sm text-gray-400">
        Showing {filteredEntries.length} of {entries.length} sales
      </p>

      {filteredEntries.length > 0 ? (
        <div className="overflow-x-auto rounded-lg bg-gray-800 shadow-lg">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-700 text-gray-300">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Suggested</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredEntries.map((entry) => {
                const calibrationMatch = calibrationBySaleId.get(entry.id);
                return (
                <tr key={entry.id} className="hover:bg-gray-750">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">
                    {formatHistoryDate(entry.timestamp)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-100">
                    <MerchantHistoryItemTooltip entry={entry} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-yellow-300">
                    {entry.amount ?? "—"} {entry.currency}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-orange-200">
                    {calibrationMatch
                      ? `${calibrationMatch.suggestedAmount} ${calibrationMatch.currency} (${calibrationMatch.percentError >= 0 ? "+" : ""}${calibrationMatch.percentError.toFixed(1)}%)`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {entry.buyer || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {entry.note || "—"}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-800 p-6 text-gray-400 shadow-lg">
          {isLoading
            ? "Loading Ange Merchant History..."
            : session?.loggedIn
              ? "No completed shop sales were returned for this league."
              : "Log in to pathofexile.com to load your completed shop sales."}
        </div>
      )}
    </div>
  );
};

export default SaleHistoryPage;
