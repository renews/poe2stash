import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ClipboardPaste,
  Keyboard,
  LoaderCircle,
  ScanSearch,
} from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import { checkCopiedItemPrice } from "../services/copiedItemPriceCheck";
import { parseCopiedItemText } from "../services/copiedItemParser";
import { PriceChecker, type Estimate } from "../services/PriceEstimator";
import {
  createTradeExchangeUrl,
  createTradeSearchUrl,
} from "../services/externalLinks";
import { completeModifierSelection } from "../services/modifierSelection";
import {
  formatItemMod,
  formatSuggestedPriceLabel,
  type ModifierSelection,
  type Poe2Item,
} from "../services/types";
import { ItemPriceCheckOptions } from "./ItemPriceCheckOptions";
import { MarketInspector } from "./TradeWorkspace";

type PriceCheckStatus = "idle" | "checking";

export interface PriceCheckShortcutStatus {
  registered: boolean;
  shortcut: string;
  error?: string;
}

interface PriceCheckPageViewProps {
  itemText: string;
  selectedLeague: string;
  status: PriceCheckStatus;
  shortcutStatus: PriceCheckShortcutStatus;
  error?: string;
  item?: Poe2Item;
  estimate?: Estimate;
  modifierSelection?: ModifierSelection;
  onItemTextChange: (value: string) => void;
  onModifierSelectionChange?: (selection: ModifierSelection) => void;
  onOpenOfficialTrade?: () => void | Promise<void>;
  isOpeningOfficialTrade?: boolean;
  onSubmit: () => void;
}

export interface CapturedPriceCheckItem {
  sequence: number;
  text: string;
}

function getSkippedModifiers(
  item?: Poe2Item,
  selection?: ModifierSelection,
) {
  if (!item || !selection) {
    return [];
  }

  const selectionWithEnchant = selection as ModifierSelection & {
    enchant?: boolean[];
  };
  const sections = [
    [item.item.implicitMods || [], selection.implicit],
    [item.item.explicitMods || [], selection.explicit],
    [item.item.enchantMods || [], selectionWithEnchant.enchant || []],
  ] as const;

  return sections.flatMap(([modifiers, selected]) =>
    modifiers.flatMap((modifier, index) =>
      selected[index] === false ? [formatItemMod(modifier)] : [],
    ),
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function prepareCopiedItemPreview(
  itemText: string,
  league: string,
  currentSelection?: ModifierSelection,
) {
  const item = parseCopiedItemText(itemText);
  item.item.league = league;
  const completeSelection = completeModifierSelection(item, currentSelection);
  const selection: ModifierSelection & { enchant?: boolean[] } = {
    ...completeSelection,
    implicit: [...completeSelection.implicit],
    explicit: [...completeSelection.explicit],
    ...("enchant" in completeSelection &&
    Array.isArray(
      (completeSelection as ModifierSelection & { enchant?: boolean[] })
        .enchant,
    )
      ? {
          enchant: [
            ...((completeSelection as ModifierSelection & {
              enchant: boolean[];
            }).enchant || []),
          ],
        }
      : {}),
  };

  for (const modifier of PriceChecker.parseItemMods(item).unresolved) {
    const values = selection[modifier.section];
    if (values) {
      values[modifier.sourceIndex] = false;
    }
  }

  return { item, selection };
}

export function PriceCheckPageView(props: PriceCheckPageViewProps) {
  const isChecking = props.status === "checking";
  const canSubmit = Boolean(props.itemText.trim()) && !isChecking;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) {
      props.onSubmit();
    }
  };

  return (
    <article className="page-shell price-check-page">
      <header className="page-heading price-check-heading">
        <div>
          <p className="page-eyebrow">Live market appraisal</p>
          <h1>Price Check</h1>
          <p className="page-description">
            Copy an item in Path of Exile 2 or paste its details here to search
            comparable listings in {props.selectedLeague}.
          </p>
        </div>
        <ScanSearch aria-hidden="true" />
      </header>

      <div
        className="price-check-shortcut"
        data-ready={props.shortcutStatus.registered}
      >
        <Keyboard aria-hidden="true" />
        <div>
          <strong>
            {props.shortcutStatus.registered
              ? "In-game shortcut ready"
              : "In-game shortcut unavailable"}
          </strong>
          <span>
            Hover an item in game and press{" "}
            <kbd>{props.shortcutStatus.shortcut}</kbd>
            {props.shortcutStatus.error
              ? `: ${props.shortcutStatus.error}`
              : ""}
          </span>
        </div>
        <span className="price-check-shortcut__league">
          League <strong>{props.selectedLeague}</strong>
        </span>
      </div>

      <div className="price-check-layout">
        <section
          className="surface-card price-check-input"
          aria-labelledby="price-check-input-title"
        >
          <header>
            <ClipboardPaste aria-hidden="true" />
            <div>
              <p className="trade-kicker">Item source</p>
              <h2 id="price-check-input-title">Copied item data</h2>
            </div>
          </header>
          <form onSubmit={submit}>
            <label htmlFor="price-check-item-data">
              Paste item details copied from Path of Exile 2
            </label>
            <p id="price-check-item-data-help">
              In game, hover the item and press Ctrl+C. English item text is
              supported in this first version.
            </p>
            <textarea
              id="price-check-item-data"
              aria-describedby={`price-check-item-data-help price-check-status${
                props.error ? " price-check-error" : ""
              }`}
              value={props.itemText}
              onChange={(event) => props.onItemTextChange(event.target.value)}
              rows={12}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={"Item Class: Rings\nRarity: Rare\n..."}
            />
            {props.error && (
              <p
                id="price-check-error"
                className="feedback feedback--error"
                role="alert"
              >
                {props.error}
              </p>
            )}
            <div
              id="price-check-status"
              className="price-check-status"
              data-checking={isChecking}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {isChecking && (
                <span className="price-check-status__spinner">
                  <LoaderCircle aria-hidden="true" />
                </span>
              )}
              <div className="price-check-status__message">
                {isChecking ? (
                  <>
                    <strong>Checking price…</strong>
                    <span>
                      Searching comparable listings in {props.selectedLeague}.
                    </span>
                  </>
                ) : (
                  <span>
                    {props.estimate
                      ? `Price check complete. Recommended price ${formatSuggestedPriceLabel(props.estimate.price)} in ${props.selectedLeague}.`
                      : props.itemText.trim()
                        ? "Item data ready to check."
                        : "Paste an item to begin."}
                  </span>
                )}
              </div>
            </div>
            {props.item && props.modifierSelection && (
              <details className="price-check-options">
                <summary>Pricing filters</summary>
                <ItemPriceCheckOptions
                  item={props.item}
                  modifierSelection={props.modifierSelection}
                  onModifierSelectionChange={props.onModifierSelectionChange}
                  className="price-check-options__content"
                />
              </details>
            )}
            <button
              type="submit"
              className="app-button app-button--primary"
              disabled={!canSubmit}
            >
              <ScanSearch aria-hidden="true" />
              {isChecking
                ? "Checking price"
                : props.error
                  ? "Retry price check"
                  : "Check price"}
            </button>
          </form>
        </section>

        <MarketInspector
          item={props.item}
          estimate={props.estimate}
          hidden={false}
          isPriceChecking={isChecking}
          onPriceCheck={() => props.onSubmit()}
          league={props.selectedLeague}
          showListedPrice={false}
          showAction={false}
          showTradeAction={Boolean(props.item && props.onOpenOfficialTrade)}
          isOpeningTrade={props.isOpeningOfficialTrade}
          skippedModifiers={getSkippedModifiers(
            props.item,
            props.modifierSelection,
          )}
          onOpenOfficialTrade={props.onOpenOfficialTrade}
          kicker="Market evidence"
          title="Price estimate"
          emptyMessage="Paste an item to inspect its identity, modifiers, and comparable listings."
        />
      </div>
    </article>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The price check failed. Check the selected league and try again.";
}

// eslint-disable-next-line react-refresh/only-export-components
export function getCompletedPriceCheckTradeUrl(
  estimate: Estimate | undefined,
  league: string,
) {
  return estimate?.source === "currency-exchange"
    ? createTradeExchangeUrl(league, estimate.search.searchId || "")
    : undefined;
}

export function PriceCheckPage(props: {
  capturedItem?: CapturedPriceCheckItem;
  onCapturedItemHandled?: (sequence: number) => void;
}) {
  const { capturedItem, onCapturedItemHandled } = props;
  const {
    selectedLeague,
    modifierRangePercent,
    priceCheckShortcut,
  } = useAppContext();
  const [itemText, setItemText] = useState("");
  const [item, setItem] = useState<Poe2Item>();
  const [estimate, setEstimate] = useState<Estimate>();
  const [modifierSelection, setModifierSelection] =
    useState<ModifierSelection>();
  const modifierSelectionRef = useRef<ModifierSelection>();
  const [status, setStatus] = useState<PriceCheckStatus>("idle");
  const [error, setError] = useState<string>();
  const [isOpeningOfficialTrade, setIsOpeningOfficialTrade] = useState(false);
  const [shortcutStatus, setShortcutStatus] =
    useState<PriceCheckShortcutStatus>({
      registered: false,
      shortcut: priceCheckShortcut,
      error: "Checking desktop shortcut availability.",
    });
  const activeRequest = useRef<AbortController>();
  const officialTradeRequest = useRef<AbortController>();
  const handledCapture = useRef<number>();

  useEffect(() => {
    let active = true;
    const priceCheckApi = window.desktopApi?.priceCheck;
    if (!priceCheckApi) {
      setShortcutStatus({
        registered: false,
        shortcut: priceCheckShortcut,
        error: "Manual paste is available in this environment.",
      });
      return;
    }

    void priceCheckApi
      .setShortcut(priceCheckShortcut)
      .then((nextStatus) => {
        if (active) {
          setShortcutStatus(nextStatus);
        }
      })
      .catch(() => {
        if (active) {
          setShortcutStatus({
            registered: false,
            shortcut: priceCheckShortcut,
            error:
              "Shortcut status could not be read. Manual paste still works.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [priceCheckShortcut]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      officialTradeRequest.current?.abort();
    },
    [],
  );

  const runPriceCheck = useCallback(
    async (nextText: string, useCurrentSelection: boolean) => {
      activeRequest.current?.abort();
      officialTradeRequest.current?.abort();
      setIsOpeningOfficialTrade(false);
      const controller = new AbortController();
      activeRequest.current = controller;
      setItemText(nextText);
      setEstimate(undefined);
      setError(undefined);
      setStatus("checking");
      try {
        const preview = prepareCopiedItemPreview(
          nextText,
          selectedLeague,
          useCurrentSelection ? modifierSelectionRef.current : undefined,
        );
        setItem(preview.item);
        modifierSelectionRef.current = preview.selection;
        setModifierSelection(preview.selection);
      } catch {
        setItem(undefined);
        if (!useCurrentSelection) {
          modifierSelectionRef.current = undefined;
          setModifierSelection(undefined);
        }
      }

      try {
        const result = await checkCopiedItemPrice({
          itemText: nextText,
          league: selectedLeague,
          modifierRangePercent,
          selection: useCurrentSelection
            ? modifierSelectionRef.current
            : undefined,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setItem(result.item);
        setEstimate(result.estimate);
        modifierSelectionRef.current = result.selection;
        setModifierSelection(result.selection);
      } catch (nextError) {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (!controller.signal.aborted) {
          setStatus("idle");
        }
      }
    },
    [modifierRangePercent, selectedLeague],
  );

  useEffect(() => {
    const capture = capturedItem;
    if (!capture || handledCapture.current === capture.sequence) {
      return;
    }
    handledCapture.current = capture.sequence;
    onCapturedItemHandled?.(capture.sequence);
    void runPriceCheck(capture.text, false);
  }, [capturedItem, onCapturedItemHandled, runPriceCheck]);

  const changeItemText = (nextText: string) => {
    activeRequest.current?.abort();
    officialTradeRequest.current?.abort();
    setIsOpeningOfficialTrade(false);
    setItemText(nextText);
    setItem(undefined);
    setEstimate(undefined);
    modifierSelectionRef.current = undefined;
    setModifierSelection(undefined);
    setError(undefined);
    setStatus("idle");
  };

  const changeModifierSelection = (selection: ModifierSelection) => {
    activeRequest.current?.abort();
    officialTradeRequest.current?.abort();
    setIsOpeningOfficialTrade(false);
    modifierSelectionRef.current = selection;
    setModifierSelection(selection);
    setEstimate(undefined);
    setError(undefined);
    setStatus("idle");
  };

  const openOfficialTrade = useCallback(async () => {
    if (!item || !modifierSelection) {
      return;
    }

    officialTradeRequest.current?.abort();
    const controller = new AbortController();
    officialTradeRequest.current = controller;
    setError(undefined);
    setIsOpeningOfficialTrade(true);
    try {
      const completedTradeUrl = getCompletedPriceCheckTradeUrl(
        estimate,
        selectedLeague,
      );
      if (completedTradeUrl) {
        window.open(
          completedTradeUrl,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }

      const matchingItem = await PriceChecker.findMatchingItem(
        item,
        selectedLeague,
        modifierSelection,
        modifierRangePercent,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        return;
      }
      if (!matchingItem?.id) {
        throw new Error("No official trade search was created.");
      }
      window.open(
        createTradeSearchUrl(selectedLeague, matchingItem.id),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (nextError) {
      if (controller.signal.aborted) {
        return;
      }
      window.open(
        createTradeSearchUrl(selectedLeague, ""),
        "_blank",
        "noopener,noreferrer",
      );
      setError(
        `${getErrorMessage(nextError)} Official trade was opened without item filters for manual search.`,
      );
    } finally {
      if (officialTradeRequest.current === controller) {
        officialTradeRequest.current = undefined;
        setIsOpeningOfficialTrade(false);
      }
    }
  }, [estimate, item, modifierRangePercent, modifierSelection, selectedLeague]);

  return (
    <PriceCheckPageView
      itemText={itemText}
      item={item}
      estimate={estimate}
      modifierSelection={modifierSelection}
      selectedLeague={selectedLeague}
      status={status}
      error={error}
      shortcutStatus={shortcutStatus}
      isOpeningOfficialTrade={isOpeningOfficialTrade}
      onItemTextChange={changeItemText}
      onModifierSelectionChange={changeModifierSelection}
      onOpenOfficialTrade={openOfficialTrade}
      onSubmit={() => void runPriceCheck(itemText, true)}
    />
  );
}
