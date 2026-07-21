import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Estimate } from "../services/PriceEstimator";
import { toggleExpandedItemIds } from "../services/compactItemState";
import {
  getListingAge,
  getListingAgeStatus,
  getListingSinceLabel,
} from "../services/listing";
import { completeModifierSelection } from "../services/modifierSelection";
import { groupItemsByStash } from "../services/stashScope";
import {
  formatPriceAmount,
  formatSuggestedPriceLabel,
  ModifierSelection,
  Poe2Item,
} from "../services/types";
import { ItemPriceCheckOptions } from "./ItemPriceCheckOptions";

function getItemName(item: Poe2Item) {
  return (
    item.item?.name || item.item?.typeLine || item.item?.baseType || "Item"
  );
}

function getItemNameClassName(rarity?: string) {
  switch (rarity?.toLowerCase()) {
    case "normal":
      return "text-gray-200";
    case "magic":
      return "text-blue-300";
    case "rare":
      return "text-yellow-300";
    case "unique":
      return "text-orange-400";
    default:
      return "text-gray-200";
  }
}

export function CompactItemNameButton(props: {
  itemName: string;
  rarity?: string;
  expanded: boolean;
  optionsId?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Edit price check options for ${props.itemName}`}
      aria-expanded={props.expanded}
      aria-controls={props.optionsId}
      onClick={props.onToggle}
      style={{ background: "none", border: 0, padding: 0 }}
      className={`group flex min-w-0 items-center gap-1 truncate border-0 bg-transparent p-0 text-left font-semibold hover:border-transparent hover:bg-transparent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${getItemNameClassName(props.rarity)}`}
      title={props.itemName}
    >
      <ChevronDown
        aria-hidden="true"
        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:text-gray-200 ${props.expanded ? "" : "-rotate-90"}`}
      />
      <span className="truncate">{props.itemName}</span>
    </button>
  );
}

function formatListedPrice(item: Poe2Item) {
  const price = item.listing?.price;
  return price
    ? `${formatPriceAmount(price.amount)} ${price.currency}`
    : "Unpriced";
}

export function CompactItemList(props: {
  items: Poe2Item[];
  priceEstimates: Record<string, Estimate>;
  modifierSelections: Record<string, ModifierSelection>;
  selectedItemId?: string;
  onSelectItem?: (itemId: string) => void;
  onPriceCheck: (
    item: Poe2Item,
    selection?: ModifierSelection,
  ) => void | Promise<void>;
  onModifierSelectionChange: (
    itemId: string,
    selection: ModifierSelection,
  ) => void;
  onStashPriceCheck: (items: Poe2Item[]) => void | Promise<void>;
  isPriceChecking: boolean;
}) {
  const groups = groupItemsByStash(props.items);
  const [checkingItemIds, setCheckingItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [priceCheckErrors, setPriceCheckErrors] = useState<
    Record<string, string>
  >({});
  const [checkingStashName, setCheckingStashName] = useState<string | null>(
    null,
  );
  const [stashPriceCheckErrors, setStashPriceCheckErrors] = useState<
    Record<string, string>
  >({});
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(
    () => new Set(),
  );

  const checkPrice = async (item: Poe2Item) => {
    setCheckingItemIds((current) => new Set(current).add(item.id));
    setPriceCheckErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    try {
      await props.onPriceCheck(
        item,
        completeModifierSelection(item, props.modifierSelections[item.id]),
      );
    } catch (error) {
      setPriceCheckErrors((current) => ({
        ...current,
        [item.id]:
          error instanceof Error ? error.message : "Price check failed.",
      }));
    } finally {
      setCheckingItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const checkStashPrices = async (stashName: string, items: Poe2Item[]) => {
    setCheckingStashName(stashName);
    setStashPriceCheckErrors((current) => {
      const next = { ...current };
      delete next[stashName];
      return next;
    });

    try {
      await props.onStashPriceCheck(items);
    } catch (error) {
      setStashPriceCheckErrors((current) => ({
        ...current,
        [stashName]:
          error instanceof Error ? error.message : "Stash price check failed.",
      }));
    } finally {
      setCheckingStashName(null);
    }
  };

  return (
    <section aria-label="Compact item list" className="compact-item-list">
      {groups.map(({ stashName, items }) => {
        const isCheckingStash = checkingStashName === stashName;
        const stashPriceCheckError = stashPriceCheckErrors[stashName];

        return (
          <div key={stashName} className="stash-ledger-group">
            <details open>
              <summary className="stash-ledger-group__summary">
                {stashName} ({items.length}{" "}
                {items.length === 1 ? "item" : "items"})
              </summary>
              <div className="listing-ledger__scroller">
                <div className="listing-ledger__table">
                  <div className="compact-price-grid compact-price-grid--header">
                    <span>Item</span>
                    <span>Rarity</span>
                    <span>Current</span>
                    <span>Suggested</span>
                    <span>Position</span>
                    <span>Age</span>
                    <span>Action</span>
                  </div>
                  {items.map((item) => {
                    const itemName = getItemName(item);
                    const estimate = props.priceEstimates[item.id];
                    const isChecking = checkingItemIds.has(item.id);
                    const priceCheckError = priceCheckErrors[item.id];
                    const optionsExpanded = expandedItemIds.has(item.id);
                    const optionsId = `compact-price-check-options-${item.id}`;
                    const listingAge =
                      getListingAge(item.listing?.indexed) || "Unknown";
                    const listingAgeStatus = getListingAgeStatus(
                      item.listing?.indexed,
                    );

                    return (
                      <div key={item.id} className="trade-row-wrap">
                        <div
                          aria-label={`${itemName} prices`}
                          data-rarity={
                            item.item?.rarity?.toLowerCase() || "unknown"
                          }
                          data-selected={props.selectedItemId === item.id}
                          className="compact-price-grid trade-row"
                        >
                          <div className="trade-item-cell">
                            <button
                              type="button"
                              className="trade-item-cell__select"
                              aria-label={`Inspect ${itemName}`}
                              aria-pressed={props.selectedItemId === item.id}
                              onClick={() => props.onSelectItem?.(item.id)}
                            >
                              {item.item.icon && (
                                <img src={item.item.icon} alt="" />
                              )}
                            </button>
                            <div className="trade-item-cell__copy">
                              <CompactItemNameButton
                                itemName={itemName}
                                rarity={item.item?.rarity}
                                expanded={optionsExpanded}
                                optionsId={optionsId}
                                onToggle={() => {
                                  props.onSelectItem?.(item.id);
                                  setExpandedItemIds((current) =>
                                    toggleExpandedItemIds(current, item.id),
                                  );
                                }}
                              />
                              <span>
                                {item.item.typeLine || item.item.baseType}
                              </span>
                            </div>
                          </div>
                          <span className="rarity-label">
                            {item.item?.rarity || "Item"}
                          </span>
                          <span className="whitespace-nowrap listing-price">
                            {formatListedPrice(item)}
                          </span>
                          <span
                            data-price-status={
                              estimate?.matchesCurrentPrice
                                ? "matches"
                                : estimate
                                  ? "review"
                                  : "unchecked"
                            }
                            className="whitespace-nowrap suggested-price"
                          >
                            {formatSuggestedPriceLabel(
                              estimate?.price,
                              estimate?.matchesCurrentPrice,
                            )}
                          </span>
                          <span className="price-position-label">
                            {estimate?.matchesCurrentPrice
                              ? "Fair"
                              : estimate
                                ? "Review"
                                : "Unchecked"}
                          </span>
                          <span
                            className="whitespace-nowrap text-gray-300 trade-age"
                            data-age-status={listingAgeStatus}
                            aria-label={`${listingAge}, ${listingAgeStatus} listing`}
                            title={getListingSinceLabel(item.listing?.indexed)}
                          >
                            {listingAge}
                          </span>
                          <button
                            type="button"
                            aria-label={`Price check ${itemName}`}
                            disabled={isChecking || props.isPriceChecking}
                            title={priceCheckError || "Update suggested price"}
                            onClick={() => void checkPrice(item)}
                            className={`app-button compact-action ${
                              priceCheckError
                                ? "app-button--danger"
                                : "app-button--quiet"
                            }`}
                          >
                            {isChecking
                              ? "Checking…"
                              : priceCheckError
                                ? "Retry"
                                : "Price check"}
                          </button>
                        </div>
                        {optionsExpanded && (
                          <div id={optionsId} className="trade-row-options">
                            <ItemPriceCheckOptions
                              item={item}
                              modifierSelection={
                                props.modifierSelections[item.id]
                              }
                              onModifierSelectionChange={(selection) =>
                                props.onModifierSelectionChange(
                                  item.id,
                                  selection,
                                )
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
            <button
              type="button"
              aria-label={`Price check stash ${stashName}`}
              disabled={props.isPriceChecking || checkingStashName !== null}
              title={stashPriceCheckError || `Price check ${stashName}`}
              onClick={() => void checkStashPrices(stashName, items)}
              className={`app-button compact-action stash-ledger-group__action ${
                stashPriceCheckError
                  ? "app-button--danger"
                  : "app-button--quiet"
              }`}
            >
              {isCheckingStash
                ? "Checking stash…"
                : stashPriceCheckError
                  ? "Retry stash"
                  : "Price check stash"}
            </button>
          </div>
        );
      })}
    </section>
  );
}
