import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
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
import { RefreshAllItems } from "../jobs/RefreshAllItems";
import {
  getApiRequestProgressLabel,
  getPriceCheckProgressLabel,
  PriceCheckAllItems,
} from "../jobs/PriceCheckAllItems";
import { Job } from "../jobs/Job";
import { handleJob } from "../components/JobQueue";
import { Leagues, League } from "../data/leagues";

export const MODIFIER_SELECTIONS_STORAGE_KEY = "modifierSelections";
export const SELECTED_LEAGUE_STORAGE_KEY = "selectedLeague";
export const MODIFIER_RANGE_PERCENT_STORAGE_KEY = "modifierRangePercent";

export function parseSavedLeague(value: string | null): League {
  return Leagues.includes(value as League) ? (value as League) : Leagues[0];
}

export function parseSavedModifierRange(value: string | null) {
  if (!value?.trim()) {
    return DEFAULT_MODIFIER_RANGE_PERCENT;
  }

  return normalizeModifierRangePercent(Number(value));
}

export function parseSavedAccountName(value: string | null) {
  return value?.trim() || "";
}

function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "boolean");
}

function isModifierSelection(value: unknown): value is ModifierSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Partial<ModifierSelection>;
  return (
    isBooleanArray(selection.explicit) &&
    isBooleanArray(selection.implicit) &&
    (selection.itemLevel === undefined || typeof selection.itemLevel === "boolean")
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
  setIsLiveMonitoring: Dispatch<SetStateAction<boolean>>;
  isPriceChecking: boolean;
  isSyncing: boolean;
  priceCheckProgress: string;
  priceCheckCooldownMinutes: number;
  setPriceCheckCooldownMinutes: Dispatch<SetStateAction<number>>;
  modifierRangePercent: number;
  setModifierRangePercent: Dispatch<SetStateAction<number>>;
  currencyRates: CurrencyRates;
  currencyRatesUpdatedAt: number | null;
  isRefreshingCurrencyRates: boolean;
  refreshCurrencyRates: () => Promise<void>;
  priceEstimates: Record<string, Estimate>;
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
  refreshItem: (item: Poe2Item) => Promise<void>;
  refreshAllItems: () => Promise<void>;
  priceCheckAllItems: () => Promise<void>;
  filteredItems: Poe2Item[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function getSavedPriceCheckCooldown() {
  const saved = Number(localStorage.getItem("priceCheckCooldownMinutes"));
  return Number.isFinite(saved) && saved >= 0
    ? saved
    : DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES;
}

function getSavedModifierRange() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_MODIFIER_RANGE_PERCENT;
  }

  return parseSavedModifierRange(
    localStorage.getItem(MODIFIER_RANGE_PERCENT_STORAGE_KEY),
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
  const [isLiveMonitoring, setIsLiveMonitoring] = useState<boolean>(false);
  const [isPriceChecking, setIsPriceChecking] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [priceCheckProgress, setPriceCheckProgress] = useState("");
  const [priceCheckCooldownMinutes, setPriceCheckCooldownMinutes] = useState(
    getSavedPriceCheckCooldown,
  );
  const [modifierRangePercent, setModifierRangePercent] = useState(
    getSavedModifierRange,
  );
  const [priceEstimates, setPriceEstimates] = useState<
    Record<string, Estimate>
  >({});
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
    setStashTabs(["All", ...Object.keys(stashes).sort()]);
    setSelectedStash("All");
  };

  const priceCheckItems = async (itemsToCheck: Poe2Item[]) => {
    let currentItemProgress = "";
    setIsPriceChecking(true);
    setPriceCheckProgress(
      itemsToCheck.length
        ? `Preparing to check ${itemsToCheck.length} item${itemsToCheck.length === 1 ? "" : "s"}...`
        : "",
    );
    const priceCheck = new PriceCheckAllItems(
      itemsToCheck,
      true,
      selectedLeague,
      modifierSelections,
      priceCheckCooldownMinutes,
      modifierRangePercent,
    );

    priceCheck.onCancel = async () => {
      setIsPriceChecking(false);
      setPriceCheckProgress("");
    };

    priceCheck.onStep = async (progress) => {
      console.log("price check", progress);
      setPriceEstimates(PriceChecker.getCachedEstimates());
    };

    priceCheck.onItemStart = ({ current, total, item }) => {
      currentItemProgress = getPriceCheckProgressLabel(current, total, item);
      setPriceCheckProgress(currentItemProgress);
    };

    priceCheck.onRequestState = (state) => {
      const requestProgress = getApiRequestProgressLabel(state);
      setPriceCheckProgress(
        requestProgress
          ? `${currentItemProgress} · ${requestProgress}`
          : currentItemProgress,
      );
    };

    try {
      await handleJob(priceCheck, setJobs, setErrorMessage);
      setPriceEstimates(PriceChecker.getCachedEstimates());
    } finally {
      setIsPriceChecking(false);
      setPriceCheckProgress("");
    }
  };

  const getItems = async (name: string) => {
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
    const price = await PriceChecker.estimateItemPrice(
      item,
      selectedLeague,
      selection,
      modifierRangePercent,
    );
    setPriceEstimates(PriceChecker.getCachedEstimates());
    console.log(price);
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
    const refresh = new RefreshAllItems(
      accountName,
      filteredItems,
      selectedLeague,
    );

    refresh.onStep = async (progress) => {
      setItems(progress.data);
    };

    await handleJob(refresh, setJobs, setErrorMessage);
  };

  const priceCheckAllItems = async () => {
    await priceCheckItems(filteredItems);
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
    const getCachedItems = async (name: string) => {
      const accountItems = await Poe2Trade.getAllCachedAccountItems(
        name,
        selectedLeague,
      );
      setItems(accountItems);
    };

    setPriceEstimates(PriceChecker.getCachedEstimates());

    if (accountName) {
      getCachedItems(accountName);
    }
  }, [accountName, selectedLeague]);

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
    setIsLiveMonitoring,
    isPriceChecking,
    isSyncing,
    priceCheckProgress,
    priceCheckCooldownMinutes,
    setPriceCheckCooldownMinutes,
    modifierRangePercent,
    setModifierRangePercent,
    currencyRates,
    currencyRatesUpdatedAt,
    isRefreshingCurrencyRates,
    refreshCurrencyRates,
    priceEstimates,
    modifierSelections,
    setModifierSelection,
    errorMessage,
    setErrorMessage,
    jobs,
    setJobs,
    getItems,
    filterByStash,
    priceCheckItem,
    refreshItem,
    refreshAllItems,
    priceCheckAllItems,
    filteredItems,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
