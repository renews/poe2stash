import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Estimate } from "../services/PriceEstimator";
import { toggleExpandedItemIds } from "../services/compactItemState";
import { getListingSinceDateTime } from "../services/listing";
import { completeModifierSelection } from "../services/modifierSelection";
import { groupItemsByStash } from "../services/stashScope";
import {
  formatPriceAmount,
  formatSuggestedPriceLabel,
  ModifierSelection,
  Poe2Item,
} from "../services/types";
import { ItemPriceCheckOptions } from "./ItemPriceCheckOptions";

export type ItemViewMode = "detailed" | "compact";

export function ItemViewToggle(props: {
  value: ItemViewMode;
  onChange: (value: ItemViewMode) => void;
}) {
  const buttonClassName = (value: ItemViewMode) =>
    `rounded-md px-3 py-2 text-sm font-semibold transition ${
      props.value === value
        ? "bg-blue-500 text-white"
        : "bg-gray-700 text-gray-200 hover:bg-gray-600"
    }`;

  return (
    <div
      role="group"
      aria-label="Item view"
      className="flex rounded-md border border-gray-600 bg-gray-800 p-1"
    >
      <button
        type="button"
        aria-pressed={props.value === "detailed"}
        className={buttonClassName("detailed")}
        onClick={() => props.onChange("detailed")}
      >
        Detailed
      </button>
      <button
        type="button"
        aria-pressed={props.value === "compact"}
        className={buttonClassName("compact")}
        onClick={() => props.onChange("compact")}
      >
        Compact
      </button>
    </div>
  );
}

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
    <section aria-label="Compact item list" className="space-y-3">
      {groups.map(({ stashName, items }) => {
        const isCheckingStash = checkingStashName === stashName;
        const stashPriceCheckError = stashPriceCheckErrors[stashName];

        return (
          <div key={stashName} className="relative">
            <details
              open
              className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800"
            >
              <summary className="cursor-pointer select-none bg-gray-700 py-3 pl-4 pr-44 font-semibold text-gray-100 hover:bg-gray-600">
                {stashName} ({items.length}{" "}
                {items.length === 1 ? "item" : "items"})
              </summary>
              <div className="overflow-x-auto">
                <div className="min-w-[58rem]">
                  <div className="grid grid-cols-[minmax(0,1fr)_10rem_14rem_10rem_7rem] gap-4 border-b border-gray-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <span>Item</span>
                    <span>Current price</span>
                    <span>Suggested price</span>
                    <span>On sale since</span>
                    <span>Action</span>
                  </div>
                  {items.map((item) => {
                    const itemName = getItemName(item);
                    const estimate = props.priceEstimates[item.id];
                    const isChecking = checkingItemIds.has(item.id);
                    const priceCheckError = priceCheckErrors[item.id];
                    const optionsExpanded = expandedItemIds.has(item.id);
                    const optionsId = `compact-price-check-options-${item.id}`;

                    return (
                      <div
                        key={item.id}
                        className="border-b border-gray-700/70 last:border-b-0"
                      >
                        <div
                          aria-label={`${itemName} prices`}
                          className="grid grid-cols-[minmax(0,1fr)_10rem_14rem_10rem_7rem] items-center gap-4 px-4 py-2 text-sm"
                        >
                          <CompactItemNameButton
                            itemName={itemName}
                            rarity={item.item?.rarity}
                            expanded={optionsExpanded}
                            optionsId={optionsId}
                            onToggle={() =>
                              setExpandedItemIds((current) =>
                                toggleExpandedItemIds(current, item.id),
                              )
                            }
                          />
                          <span className="whitespace-nowrap text-green-400">
                            {formatListedPrice(item)}
                          </span>
                          <span
                            className={`whitespace-nowrap ${estimate?.matchesCurrentPrice ? "text-green-400" : "text-orange-400"}`}
                          >
                            {formatSuggestedPriceLabel(
                              estimate?.price,
                              estimate?.matchesCurrentPrice,
                            )}
                          </span>
                          <span className="whitespace-nowrap text-gray-300">
                            {getListingSinceDateTime(item.listing?.indexed) ||
                              "Unknown"}
                          </span>
                          <button
                            type="button"
                            aria-label={`Price check ${itemName}`}
                            disabled={isChecking || props.isPriceChecking}
                            title={priceCheckError || "Update suggested price"}
                            onClick={() => void checkPrice(item)}
                            className={`rounded px-2 py-1 text-xs font-semibold text-white transition disabled:cursor-wait disabled:opacity-60 ${
                              priceCheckError
                                ? "bg-red-600 hover:bg-red-500"
                                : "bg-blue-500 hover:bg-blue-600"
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
                          <div
                            id={optionsId}
                            className="border-t border-gray-700/70 px-4 py-4"
                          >
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
              className={`absolute right-3 top-2 z-10 rounded px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-wait disabled:opacity-60 ${
                stashPriceCheckError
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-blue-500 hover:bg-blue-600"
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
