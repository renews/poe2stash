import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Dispatch,
  SetStateAction,
} from "react";
import { Poe2Trade } from "../services/poe2trade";
import {
  CURRENCY_RATE_REFRESH_INTERVAL_MS,
  DEFAULT_MODIFIER_RANGE_PERCENT,
  DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES,
  CurrencyRates,
  normalizeModifierRangePercent,
  PriceChecker,
  Estimate,
} from "../services/PriceEstimator";
import { ModifierSelection, Poe2Item } from "../services/types";
import { SyncAccount } from "../jobs/SyncAccount";
import { PriceCheckAllItems } from "../jobs/PriceCheckAllItems";
import { Job } from "../jobs/Job";
import { handleJob } from "../components/JobQueue";
import { Leagues, League } from "../data/leagues";
import { NewItemTracker } from "../services/NewItemTracker";
import { alertOnMispricedItem } from "../services/PriceAlert";
import { useLiveListingMonitor } from "../hooks/useLiveListingMonitor";
import { sortStashTabNames } from "../services/stashScope";
import {
  DEFAULT_PRICE_CHECK_SHORTCUT,
  parsePriceCheckShortcut,
} from "../services/priceCheckShortcut";
import {
  clearPriceCheckFailure,
  getPriceCheckErrorMessages,
  loadPriceCheckFailures,
  persistPriceCheckFailures,
  PriceCheckFailures,
  recordPriceCheckFailure,
} from "../services/priceCheckFailureState";

export const MODIFIER_SELECTIONS_STORAGE_KEY = "modifierSelections";
export const SELECTED_LEAGUE_STORAGE_KEY = "selectedLeague";
export const MODIFIER_RANGE_PERCENT_STORAGE_KEY = "modifierRangePercent";
export const OPEN_MARKET_INSPECTOR_ON_SELECT_STORAGE_KEY =
  "openMarketInspectorOnSelect";
export const PRICE_CHECK_SHORTCUT_STORAGE_KEY = "priceCheckShortcut";

export function parseSavedLeague(value: string | null): League {
  return Leagues.includes(value as League) ? (value as League) : Leagues[0];
}

export function parseSavedModifierRange(value: string | null) {
  if (!value?.trim()) {
    return DEFAULT_MODIFIER_RANGE_PERCENT;
  }

  return normalizeModifierRangePercent(Number(value));
}

export function parseSavedPriceCheckCooldown(value: string | null) {
  if (!value?.trim()) {
    return DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES;
  }

  const saved = Number(value);
  return Number.isFinite(saved) && saved >= 0
    ? saved
    : DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES;
}

export function parseSavedOpenMarketInspectorOnSelect(value: string | null) {
  return value !== "false";
}

export function parseSavedPriceCheckShortcut(value: string | null) {
  return value
    ? parsePriceCheckShortcut(value)?.label || DEFAULT_PRICE_CHECK_SHORTCUT
    : DEFAULT_PRICE_CHECK_SHORTCUT;
}

export function parseSavedAccountName(value: string | null) {
  return value?.trim() || "";
}

function getItemScope(accountName: string, league: League) {
  return `${accountName.trim().toLowerCase()}:${league}`;
}

function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "boolean");
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isModifierSelection(value: unknown): value is ModifierSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Partial<ModifierSelection>;
  return (
    isBooleanArray(selection.explicit) &&
    isBooleanArray(selection.implicit) &&
    (selection.itemLevel === undefined || typeof selection.itemLevel === "boolean") &&
    (selection.requiredLevel === undefined ||
      typeof selection.requiredLevel === "boolean") &&
    isOptionalFiniteNumber(selection.requiredLevelMin) &&
    isOptionalFiniteNumber(selection.requiredLevelMax) &&
    (selection.runeSockets === undefined ||
      typeof selection.runeSockets === "boolean") &&
    isOptionalFiniteNumber(selection.runeSocketCount)
  );
}

export function parseModifierSelections(
  value: string | null,
): Record<string, ModifierSelection> {
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ModifierSelection] =>
          isModifierSelection(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function loadModifierSelections() {
  if (typeof localStorage === "undefined") {
    return {};
  }

  return parseModifierSelections(
    localStorage.getItem(MODIFIER_SELECTIONS_STORAGE_KEY),
  );
}

function persistModifierSelections(
  selections: Record<string, ModifierSelection>,
) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(
    MODIFIER_SELECTIONS_STORAGE_KEY,
    JSON.stringify(selections),
  );
}

interface AppContextType {
  accountName: string;
  setAccountName: Dispatch<SetStateAction<string>>;
  selectedLeague: League;
  setSelectedLeague: Dispatch<SetStateAction<League>>;
  items: Poe2Item[];
  setItems: Dispatch<SetStateAction<Poe2Item[]>>;
  liveSearchItems: Poe2Item[];
  setLiveSearchItems: Dispatch<SetStateAction<Poe2Item[]>>;
  stashTabs: string[];
  selectedStash: string;
  setSelectedStash: Dispatch<SetStateAction<string>>;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  isLiveMonitoring: boolean;
  isLiveMonitorStarting: boolean;
  liveMonitorError: string | null;
  toggleLiveMonitoring: () => void;
  isPriceChecking: boolean;
  isSyncing: boolean;
  priceCheckCooldownMinutes: number;
  setPriceCheckCooldownMinutes: Dispatch<SetStateAction<number>>;
  modifierRangePercent: number;
  setModifierRangePercent: Dispatch<SetStateAction<number>>;
  openMarketInspectorOnSelect: boolean;
  setOpenMarketInspectorOnSelect: Dispatch<SetStateAction<boolean>>;
  priceCheckShortcut: string;
  setPriceCheckShortcut: Dispatch<SetStateAction<string>>;
  currencyRates: CurrencyRates;
  currencyRatesUpdatedAt: number | null;
  isRefreshingCurrencyRates: boolean;
  refreshCurrencyRates: () => Promise<void>;
  priceEstimates: Record<string, Estimate>;
  priceCheckErrors: Record<string, string>;
  modifierSelections: Record<string, ModifierSelection>;
  setModifierSelection: (itemId: string, selection: ModifierSelection) => void;
  errorMessage: string | null;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  jobs: Job<unknown>[];
  setJobs: Dispatch<SetStateAction<Job<unknown>[]>>;
  getItems: (name: string) => Promise<void>;
  filterByStash: (stash: string) => void;
  priceCheckItem: (
    item: Poe2Item,
    selection?: ModifierSelection,
  ) => Promise<void>;
  priceCheckItems: (items: Poe2Item[]) => Promise<void>;
  refreshItem: (item: Poe2Item) => Promise<void>;
  refreshAllItems: () => Promise<void>;
  filteredItems: Poe2Item[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function getSavedPriceCheckCooldown() {
  return parseSavedPriceCheckCooldown(
    localStorage.getItem("priceCheckCooldownMinutes"),
  );
}

function getSavedModifierRange() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_MODIFIER_RANGE_PERCENT;
  }

  return parseSavedModifierRange(
    localStorage.getItem(MODIFIER_RANGE_PERCENT_STORAGE_KEY),
  );
}

function getSavedOpenMarketInspectorOnSelect() {
  if (typeof localStorage === "undefined") {
    return true;
  }

  return parseSavedOpenMarketInspectorOnSelect(
    localStorage.getItem(OPEN_MARKET_INSPECTOR_ON_SELECT_STORAGE_KEY),
  );
}

function getSavedPriceCheckShortcut() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_PRICE_CHECK_SHORTCUT;
  }

  return parseSavedPriceCheckShortcut(
    localStorage.getItem(PRICE_CHECK_SHORTCUT_STORAGE_KEY),
  );
}

function getSavedAccountName() {
  if (typeof localStorage === "undefined") {
    return "";
  }

  return parseSavedAccountName(localStorage.getItem("accountName"));
}

function getSavedLeague() {
  if (typeof localStorage === "undefined") {
    return Leagues[0];
  }

  return parseSavedLeague(localStorage.getItem(SELECTED_LEAGUE_STORAGE_KEY));
}

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return context;
};

export const AppContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [accountName, setAccountName] = useState(getSavedAccountName);
  const [selectedLeague, setSelectedLeague] = useState<League>(getSavedLeague);
  const [items, setItems] = useState<Poe2Item[]>([]);
  const [liveSearchItems, setLiveSearchItems] = useState<Poe2Item[]>([]);
  const [stashTabs, setStashTabs] = useState<string[]>([]);
  const [selectedStash, setSelectedStash] = useState<string>("All");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [syncedAccountName, setSyncedAccountName] = useState(
    getSavedAccountName,
  );
  const [isPriceChecking, setIsPriceChecking] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [priceCheckCooldownMinutes, setPriceCheckCooldownMinutes] = useState(
    getSavedPriceCheckCooldown,
  );
  const [modifierRangePercent, setModifierRangePercent] = useState(
    getSavedModifierRange,
  );
  const [openMarketInspectorOnSelect, setOpenMarketInspectorOnSelect] =
    useState(getSavedOpenMarketInspectorOnSelect);
  const [priceCheckShortcut, setPriceCheckShortcut] = useState(
    getSavedPriceCheckShortcut,
  );
  const [priceEstimates, setPriceEstimates] = useState<
    Record<string, Estimate>
  >({});
  const priceCheckFailureScope = useRef(
    getItemScope(getSavedAccountName(), getSavedLeague()),
  );
  const [priceCheckFailures, setPriceCheckFailures] =
    useState<PriceCheckFailures>(() =>
      loadPriceCheckFailures(priceCheckFailureScope.current),
    );
  const priceCheckErrors = useMemo(
    () => getPriceCheckErrorMessages(priceCheckFailures),
    [priceCheckFailures],
  );
  const [modifierSelections, setModifierSelections] = useState<
    Record<string, ModifierSelection>
  >(loadModifierSelections);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job<unknown>[]>([]);
  const [currencyRates, setCurrencyRates] = useState<CurrencyRates>({});
  const [currencyRatesUpdatedAt, setCurrencyRatesUpdatedAt] = useState<
    number | null
  >(null);
  const [isRefreshingCurrencyRates, setIsRefreshingCurrencyRates] =
    useState(false);
  const [loadedItemsScope, setLoadedItemsScope] = useState<string | null>(null);
  const newItemTracker = useRef(new NewItemTracker());
  const backgroundPriceCheckQueue = useRef<Promise<void>>(Promise.resolve());
  const activeItemScope = useRef(getItemScope(accountName, selectedLeague));
  activeItemScope.current = getItemScope(syncedAccountName, selectedLeague);
  const updatePriceCheckFailures = useCallback(
    (
      update: (current: PriceCheckFailures) => PriceCheckFailures,
      scope = priceCheckFailureScope.current,
    ) => {
      if (scope !== priceCheckFailureScope.current) {
        persistPriceCheckFailures(
          scope,
          update(loadPriceCheckFailures(scope)),
        );
        return;
      }

      setPriceCheckFailures((current) => {
        const next = update(current);
        persistPriceCheckFailures(scope, next);
        return next;
      });
    },
    [],
  );
  const {
    isMonitoring: isLiveMonitoring,
    isStarting: isLiveMonitorStarting,
    error: liveMonitorError,
    toggle: toggleLiveMonitoring,
  } = useLiveListingMonitor({
    accountName: syncedAccountName,
    league: selectedLeague,
    setItems,
    setLiveSearchItems,
  });

  const refreshCurrencyRates = useCallback(async () => {
    setIsRefreshingCurrencyRates(true);

    try {
      const rates = await PriceChecker.refreshExchangeRates(selectedLeague);
      if (Object.keys(rates).length) {
        setCurrencyRates(rates);
        setCurrencyRatesUpdatedAt(Date.now());
      }
    } finally {
      setIsRefreshingCurrencyRates(false);
    }
  }, [selectedLeague]);

  const updateStashTabs = (items: Poe2Item[]) => {
    const stashes = Poe2Trade.getStashTabs(items);
    setStashTabs(["All", ...sortStashTabNames(Object.keys(stashes))]);
    setSelectedStash("All");
  };

  const priceCheckItems = async (itemsToCheck: Poe2Item[]) => {
    setIsPriceChecking(true);
    const failureScope = priceCheckFailureScope.current;
    const priceCheck = new PriceCheckAllItems(
      itemsToCheck,
      true,
      selectedLeague,
      modifierSelections,
      priceCheckCooldownMinutes,
      modifierRangePercent,
      priceCheckFailures,
    );

    priceCheck.onCancel = async () => {
      setIsPriceChecking(false);
    };

    priceCheck.onStep = async (progress) => {
      console.log("price check", progress);
      updatePriceCheckFailures(
        (current) =>
          progress.data.error
            ? recordPriceCheckFailure(
                current,
                progress.data.item.id,
                progress.data.error,
              )
            : clearPriceCheckFailure(current, progress.data.item.id),
        failureScope,
      );
      setPriceEstimates(PriceChecker.getCachedEstimates(selectedLeague));
    };

    priceCheck.onItemStart = () => {
      setJobs((currentJobs) => [...currentJobs]);
    };

    try {
      await handleJob(priceCheck, setJobs, setErrorMessage);
      setPriceEstimates(PriceChecker.getCachedEstimates(selectedLeague));
    } finally {
      setIsPriceChecking(false);
    }
  };

  const getItems = async (name: string) => {
    setSyncedAccountName(name.trim());
    setIsSyncing(true);
    setErrorMessage("");

    const sync = new SyncAccount(name, selectedLeague);

    sync.onStep = async (progress) => {
      console.log("Sync step", progress);
      const items = await Poe2Trade.fetchAllItems(
        name,
        progress.data,
        false,
        selectedLeague,
      );
      setItems(items);
      updateStashTabs(items);
    };

    try {
      await handleJob(sync, setJobs, setErrorMessage);
      if (sync.status !== "done") {
        return;
      }

      const accountItems = await Poe2Trade.getAllCachedAccountItems(
        name,
        selectedLeague,
      );
      setItems(accountItems);
      updateStashTabs(accountItems);
      if (accountItems.length) {
        await priceCheckItems(accountItems);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const filterByStash = (stash: string) => {
    setSelectedStash(stash);
  };

  const setModifierSelection = (
    itemId: string,
    selection: ModifierSelection,
  ) => {
    setModifierSelections((current) => ({
      ...current,
      [itemId]: selection,
    }));
  };

  const priceCheckItem = async (
    item: Poe2Item,
    selection = modifierSelections[item.id],
  ) => {
    const failureScope = priceCheckFailureScope.current;

    try {
      const price = await PriceChecker.estimateItemPrice(
        item,
        selectedLeague,
        selection,
        modifierRangePercent,
      );
      setPriceEstimates(PriceChecker.getCachedEstimates(selectedLeague));
      updatePriceCheckFailures(
        (current) => clearPriceCheckFailure(current, item.id),
        failureScope,
      );
      console.log(price);
    } catch (error) {
      PriceChecker.removeCachedEstimate(item.id);
      setPriceEstimates(PriceChecker.getCachedEstimates(selectedLeague));
      updatePriceCheckFailures(
        (current) =>
          recordPriceCheckFailure(
            current,
            item.id,
            error instanceof Error ? error.message : "Price check failed.",
          ),
        failureScope,
      );
      throw error;
    }
  };

  const refreshItem = async (item: Poe2Item) => {
    await Poe2Trade.fetchAllItems(
      accountName,
      [item.id],
      true,
      selectedLeague,
    );
    const accountItems = await Poe2Trade.getAllCachedAccountItems(
      accountName,
      selectedLeague,
    );
    setItems(accountItems);
  };

  const refreshAllItems = async () => {
    await getItems(accountName);
  };

  const filterItems = (items: Poe2Item[], stash: string, search: string) => {
    return items
      .filter((item) => stash === "All" || item.listing.stash.name === stash)
      .filter((item) => {
        if (!search) return true;
        const itemString = JSON.stringify(item).toLowerCase();
        return search
          .toLowerCase()
          .split(/\s+/)
          .every((term) => itemString.includes(term));
      });
  };

  const filteredItems = filterItems(items, selectedStash, searchTerm);

  useEffect(() => {
    let cancelled = false;
    const scope = getItemScope(accountName, selectedLeague);

    const getCachedItems = async (name: string) => {
      const accountItems = await Poe2Trade.getAllCachedAccountItems(
        name,
        selectedLeague,
      );
      if (!cancelled) {
        setItems(accountItems);
        setLoadedItemsScope(scope);
      }
    };

    setPriceEstimates(PriceChecker.getCachedEstimates(selectedLeague));
    priceCheckFailureScope.current = scope;
    setPriceCheckFailures(loadPriceCheckFailures(scope));
    setLoadedItemsScope(null);

    if (accountName) {
      void getCachedItems(accountName);
    } else {
      setItems([]);
      setLoadedItemsScope(scope);
    }

    return () => {
      cancelled = true;
    };
  }, [accountName, selectedLeague]);

  useEffect(() => {
    const scope = getItemScope(syncedAccountName, selectedLeague);
    if (
      !syncedAccountName ||
      accountName.trim().toLowerCase() !== syncedAccountName.toLowerCase() ||
      loadedItemsScope !== scope
    ) {
      return;
    }

    const newItems = newItemTracker.current.update(scope, items, isSyncing);
    for (const item of newItems) {
      const selection = modifierSelections[item.id];
      const rangePercent = modifierRangePercent;

      backgroundPriceCheckQueue.current = backgroundPriceCheckQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (activeItemScope.current !== scope) {
            return;
          }

          try {
            const estimate = await PriceChecker.estimateItemPrice(
              item,
              selectedLeague,
              selection,
              rangePercent,
            );
            setPriceEstimates(
              PriceChecker.getCachedEstimates(selectedLeague),
            );
            updatePriceCheckFailures(
              (current) => clearPriceCheckFailure(current, item.id),
              scope,
            );
            await alertOnMispricedItem(item, estimate, selectedLeague);
          } catch (error) {
            PriceChecker.removeCachedEstimate(item.id);
            setPriceEstimates(
              PriceChecker.getCachedEstimates(selectedLeague),
            );
            updatePriceCheckFailures(
              (current) =>
                recordPriceCheckFailure(
                  current,
                  item.id,
                  error instanceof Error
                    ? error.message
                    : "Price check failed.",
                ),
              scope,
            );
            console.error(
              `Automatic price check failed for ${item.item?.name || item.item?.typeLine || item.id}`,
              error,
            );
          }
        });
    }
  }, [
    accountName,
    isSyncing,
    items,
    loadedItemsScope,
    modifierRangePercent,
    modifierSelections,
    selectedLeague,
    syncedAccountName,
    updatePriceCheckFailures,
  ]);

  useEffect(() => {
    void refreshCurrencyRates();
    const interval = window.setInterval(
      () => void refreshCurrencyRates(),
      CURRENCY_RATE_REFRESH_INTERVAL_MS,
    );

    return () => window.clearInterval(interval);
  }, [refreshCurrencyRates]);

  useEffect(() => {
    localStorage.setItem(
      "priceCheckCooldownMinutes",
      priceCheckCooldownMinutes.toString(),
    );
  }, [priceCheckCooldownMinutes]);

  useEffect(() => {
    localStorage.setItem(
      MODIFIER_RANGE_PERCENT_STORAGE_KEY,
      modifierRangePercent.toString(),
    );
  }, [modifierRangePercent]);

  useEffect(() => {
    localStorage.setItem(
      OPEN_MARKET_INSPECTOR_ON_SELECT_STORAGE_KEY,
      openMarketInspectorOnSelect.toString(),
    );
  }, [openMarketInspectorOnSelect]);

  useEffect(() => {
    localStorage.setItem(PRICE_CHECK_SHORTCUT_STORAGE_KEY, priceCheckShortcut);
    void window.desktopApi?.priceCheck
      ?.setShortcut(priceCheckShortcut)
      .catch((error) =>
        console.error("Unable to update the live price check shortcut", error),
      );
  }, [priceCheckShortcut]);

  useEffect(() => {
    localStorage.setItem(SELECTED_LEAGUE_STORAGE_KEY, selectedLeague);
  }, [selectedLeague]);

  useEffect(() => {
    persistModifierSelections(modifierSelections);
  }, [modifierSelections]);

  useEffect(() => {
    updateStashTabs(items);
  }, [items]);

  const value: AppContextType = {
    accountName,
    setAccountName,
    selectedLeague,
    setSelectedLeague,
    items,
    setItems,
    liveSearchItems,
    setLiveSearchItems,
    stashTabs,
    selectedStash,
    setSelectedStash,
    searchTerm,
    setSearchTerm,
    isLiveMonitoring,
    isLiveMonitorStarting,
    liveMonitorError,
    toggleLiveMonitoring,
    isPriceChecking,
    isSyncing,
    priceCheckCooldownMinutes,
    setPriceCheckCooldownMinutes,
    modifierRangePercent,
    setModifierRangePercent,
    openMarketInspectorOnSelect,
    setOpenMarketInspectorOnSelect,
    priceCheckShortcut,
    setPriceCheckShortcut,
    currencyRates,
    currencyRatesUpdatedAt,
    isRefreshingCurrencyRates,
    refreshCurrencyRates,
    priceEstimates,
    priceCheckErrors,
    modifierSelections,
    setModifierSelection,
    errorMessage,
    setErrorMessage,
    jobs,
    setJobs,
    getItems,
    filterByStash,
    priceCheckItem,
    priceCheckItems,
    refreshItem,
    refreshAllItems,
    filteredItems,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
