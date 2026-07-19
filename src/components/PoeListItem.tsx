import {
  formatItemMod,
  formatDateTime,
  formatPriceAmount,
  formatSuggestedPriceLabel,
  ModifierSelection,
  Price,
  Poe2Item,
  getItemModifierHash,
  getModifierDisplayKind,
} from "../services/types";
import { useState } from "react";
import { Estimate, PriceChecker } from "../services/PriceEstimator";
import { createTradeSearchUrl } from "../services/externalLinks";
import { getListingSinceLabel } from "../services/listing";
import { ChevronDown } from "lucide-react";
import {
  getItemBlockExpanded,
  setItemBlockExpanded,
} from "../services/itemBlockState";
import { completeModifierSelection } from "../services/modifierSelection";
import { modifierColorClass } from "./formStyles";
import { ItemPriceCheckOptions } from "./ItemPriceCheckOptions";

export const ItemNameWithRarity: React.FC<{
  item: Poe2Item;
  expanded: boolean;
  onToggle: () => void;
}> = ({ item, expanded, onToggle }) => {
  const getRarityColor = (rarity: string = "magic") => {
    switch (rarity.toLowerCase()) {
      case "normal":
        return "text-gray-200";
      case "magic":
        return "text-blue-300";
      case "rare":
        return "text-yellow-300";
      case "unique":
        return "text-orange-400";
      default:
        return "text-blue-300";
    }
  };

  const rarityColor = getRarityColor(item.item?.rarity);
  const itemName =
    item.item.name || item.item.typeLine || item.item.baseType || "Item";

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${itemName}`}
      onClick={onToggle}
      className="group flex items-center gap-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      <ChevronDown
        aria-hidden="true"
        className={`h-5 w-5 shrink-0 text-gray-400 transition-transform group-hover:text-gray-200 ${expanded ? "" : "-rotate-90"}`}
      />
      <h2 className={`font-bold text-xl ${rarityColor} text-left`}>
        {itemName}
      </h2>
    </button>
  );
};

const ComparableItemTooltip: React.FC<{
  item: Poe2Item;
  usedExplicitHashes?: Set<string>;
  usedImplicitHashes?: Set<string>;
}> = ({ item, usedExplicitHashes, usedImplicitHashes }) => {
  const renderMods = (
    mods: Poe2Item["item"]["explicitMods"],
    section: "implicit" | "explicit" | "enchant",
  ) =>
    mods?.map((mod, index) => {
      const kind = getModifierDisplayKind(item, section, index);
      const usedHashes =
        section === "explicit"
          ? usedExplicitHashes
          : section === "implicit"
            ? usedImplicitHashes
            : undefined;
      const hash = getItemModifierHash(item, section, index, mod);
      const isUsed = !usedHashes || !hash || usedHashes.has(hash);

      return (
        <li
          key={index}
          className={`${modifierColorClass(kind)} ${isUsed ? "" : "line-through opacity-60"}`}
          title={isUsed ? kind : `${kind} · not used in search`}
        >
          {formatItemMod(mod)}
        </li>
      );
    });

  return (
    <div className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-gray-500 bg-gray-900 p-3 text-left text-xs text-gray-100 shadow-2xl group-hover:visible group-focus-within:visible">
      <div className="flex items-start gap-3">
        <img
          src={item.item.icon}
          alt={item.item.name || item.item.typeLine}
          className="h-12 w-12 rounded"
        />
        <div>
          <p className="font-semibold text-orange-300">
            {item.item.name || item.item.typeLine}
          </p>
          <p className="text-gray-300">
            {item.item.rarity} {item.item.typeLine || item.item.baseType}
          </p>
          <p className="text-gray-400">
            Item level {item.item.ilvl} · {item.listing.price.amount}{" "}
            {item.listing.price.currency}
          </p>
        </div>
      </div>

      {item.item.corrupted && (
        <p className="mt-2 font-semibold text-red-400">Corrupted</p>
      )}

      {item.item.properties?.length > 0 && (
        <ul className="mt-2 space-y-1 text-gray-300">
          {item.item.properties.map((property, index) => (
            <li key={index}>
              {property.name}:{" "}
              {property.values.map((value) => value[0]).join(", ")}
            </li>
          ))}
        </ul>
      )}

      {item.item.implicitMods?.length ? (
        <div className="mt-2">
          <p className="font-semibold text-blue-300">Implicit</p>
          <ul className="space-y-1 text-blue-200">
            {renderMods(item.item.implicitMods, "implicit")}
          </ul>
        </div>
      ) : null}

      {item.item.enchantMods?.length ? (
        <div className="mt-2">
          <p className="font-semibold text-purple-300">Enchant</p>
          <ul className="space-y-1 text-purple-200">
            {renderMods(item.item.enchantMods, "enchant")}
          </ul>
        </div>
      ) : null}

      {item.item.explicitMods?.length ? (
        <div className="mt-2">
          <p className="font-semibold text-gray-300">Explicit</p>
          <ul className="space-y-1 text-gray-200">
            {renderMods(item.item.explicitMods, "explicit")}
          </ul>
        </div>
      ) : null}

      {item.item.sockets?.length ? (
        <p className="mt-2 text-gray-400">
          Sockets: {item.item.sockets.length}
        </p>
      ) : null}
    </div>
  );
};

export function PoeListItem(props: {
  item: Poe2Item;
  league: string;
  modifierSelection?: ModifierSelection;
  onModifierSelectionChange?: (selection: ModifierSelection) => void;
  priceSuggestion?: Price;
  priceEstimate?: Estimate;
  modifierRangePercent?: number;
  onPriceClick?: (
    item: Poe2Item,
    selection?: ModifierSelection,
  ) => void | Promise<void>;
  onRefreshClick?: (item: Poe2Item) => void;
}) {
  const { item } = props;
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPriceChecking, setIsPriceChecking] = useState(false);
  const [priceCheckError, setPriceCheckError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(() =>
    getItemBlockExpanded(item.id),
  );

  const copyNameToClipboard = () => {
    navigator.clipboard.writeText(item.item.name || item.item.typeLine);
  };

  const toggleItemBlock = () => {
    const expanded = !isExpanded;
    setIsExpanded(expanded);
    setItemBlockExpanded(item.id, expanded);
  };

  const openSearchInDefaultBrowser = async () => {
    const itemLeague = item.item?.league || props.league;
    setSearchError(null);

    try {
      const matchingItem = await PriceChecker.findMatchingItem(
        item,
        itemLeague,
        completeModifierSelection(item, props.modifierSelection),
        props.modifierRangePercent,
      );
      if (!matchingItem?.id) {
        setSearchError("No trade search was created.");
        return;
      }

      window.open(createTradeSearchUrl(itemLeague, matchingItem.id), "_blank");
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Unable to open trade search.",
      );
    }
  };

  const handlePriceClick = async () => {
    if (!props.onPriceClick || isPriceChecking) return;

    setIsPriceChecking(true);
    setPriceCheckError(null);

    try {
      await props.onPriceClick(
        item,
        completeModifierSelection(item, props.modifierSelection),
      );
    } catch (error) {
      setPriceCheckError(
        error instanceof Error ? error.message : "Price check failed.",
      );
    } finally {
      setIsPriceChecking(false);
    }
  };

  const itemLeague = item.item?.league || props.league;
  const listingSinceLabel = getListingSinceLabel(item.listing?.indexed);
  const priceEstimate = props.priceEstimate;
  const hasGreatPrice = priceEstimate?.matchesCurrentPrice === true;
  const comparableCount = priceEstimate?.comparables?.length || 0;
  const sourceComparableCount =
    priceEstimate?.sourceComparableCount ?? comparableCount;
  const marketValuation = priceEstimate?.market;
  const marketIsPrimary = priceEstimate?.source === "poe2scout";
  const confidenceLabel = priceEstimate?.confidence
    ? `${priceEstimate.confidence[0].toUpperCase()}${priceEstimate.confidence.slice(1)}`
    : "Unknown";
  const usedExplicitHashes = priceEstimate?.search?.explicitHashes
    ? new Set(priceEstimate.search.explicitHashes)
    : undefined;
  const usedImplicitHashes = priceEstimate?.search?.implicitHashes
    ? new Set(priceEstimate.search.implicitHashes)
    : undefined;

  const buttonStyle = `bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md transition duration-300 ease-in-out w-full`;

  return (
    <div className="flex flex-col sm:flex-row items-start rounded-lg shadow-lg p-6 mb-6 bg-gray-800 transition-all duration-300 hover:shadow-xl">
      <div className="flex-shrink-0 mb-4 sm:mb-0 sm:mr-6">
        <img src={item.item.icon} alt={item.item.name} className="rounded-md" />
      </div>
      <div className="flex-grow w-full sm:w-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start mb-2">
          <div>
            <ItemNameWithRarity
              item={item}
              expanded={isExpanded}
              onToggle={toggleItemBlock}
            />
            <p className="text-sm text-gray-400 text-left">
              {!item.item.name ? item.item.baseType : item.item.typeLine}
            </p>
          </div>

          <div className="text-right mt-2 sm:mt-0">
            <div className="font-semibold text-green-600 text-lg">
              {item.listing.price.amount} {item.listing.price.currency}
              {props.priceSuggestion && (
                <p
                  className={
                    hasGreatPrice
                      ? "font-normal text-green-600"
                      : "font-semibold text-orange-600"
                  }
                  title={
                    !hasGreatPrice && props.priceSuggestion.lowerPrice
                      ? `Lower denomination: ${formatPriceAmount(props.priceSuggestion.lowerPrice.amount)} ${props.priceSuggestion.lowerPrice.currency}`
                      : undefined
                  }
                >
                  {formatSuggestedPriceLabel(
                    props.priceSuggestion,
                    hasGreatPrice,
                    true,
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        {isExpanded && item.item.corrupted && (
          <p className="text-red-500 font-semibold mb-2">Corrupted</p>
        )}

        <ItemPriceCheckOptions
          item={item}
          modifierSelection={props.modifierSelection}
          onModifierSelectionChange={props.onModifierSelectionChange}
          className={`space-y-4 ${isExpanded ? "" : "hidden"}`}
        />

        {isExpanded && priceEstimate && (
          <details className="bg-gray-700 p-3 rounded-md mb-4 text-left">
            <summary className="cursor-pointer font-semibold text-orange-300">
              {marketIsPrimary && marketValuation
                ? marketValuation.method === "current-snapshot"
                  ? "Poe2Scout current market snapshot"
                  : `Poe2Scout market value · ${marketValuation.quantity.toLocaleString()} volume`
                : `Suggested price uses ${comparableCount} of ${sourceComparableCount} listings · ${confidenceLabel} confidence`}
            </summary>
            <p className="mt-2 text-xs text-gray-400">
              {marketIsPrimary && marketValuation ? (
                <>
                  Source: Poe2Scout{" "}
                  {marketValuation.method === "current-snapshot"
                    ? "current market snapshot"
                    : "market history"}{" "}
                  · Updated: {formatDateTime(marketValuation.updatedAt)}
                  {comparableCount > 0
                    ? ` · ${comparableCount} official trade comparable${comparableCount === 1 ? "" : "s"} shown below`
                    : " · official trade comparables unavailable"}
                </>
              ) : (
                <>
                  Method: robust median
                  {(priceEstimate.excludedComparableCount || 0) > 0
                    ? ` · ${priceEstimate.excludedComparableCount} duplicate, stale, or outlier listing${priceEstimate.excludedComparableCount === 1 ? "" : "s"} excluded`
                    : " · no listings excluded"}
                </>
              )}
            </p>
            {!marketIsPrimary && marketValuation && (
              <p className="mt-2 rounded border border-blue-700 bg-blue-950/40 p-2 text-xs text-blue-200">
                Poe2Scout market baseline:{" "}
                {formatPriceAmount(marketValuation.price.amount)}{" "}
                {marketValuation.price.currency} · Updated:{" "}
                {formatDateTime(marketValuation.updatedAt)}
              </p>
            )}
            <p
              className="text-sm text-gray-300 mt-2"
              title={
                priceEstimate.price.lowerPrice
                  ? `Lower denomination: ${formatPriceAmount(priceEstimate.price.lowerPrice.amount)} ${priceEstimate.price.lowerPrice.currency}`
                  : undefined
              }
            >
              Search:{" "}
              {priceEstimate.search?.name ||
                priceEstimate.search?.baseType ||
                "item"}
              {priceEstimate.search?.rarity
                ? ` (${priceEstimate.search.rarity})`
                : ""}
              {priceEstimate.search?.league
                ? ` in ${priceEstimate.search.league}`
                : ""}
              {` · ${priceEstimate.search?.explicitCount || 0} explicit, ${priceEstimate.search?.implicitCount || 0} implicit modifiers`}
              {priceEstimate.search?.itemLevel !== undefined
                ? ` · item level ≥ ${priceEstimate.search.itemLevel}`
                : ""}
              {priceEstimate.search?.requiredLevelMin !== undefined &&
              priceEstimate.search?.requiredLevelMax !== undefined
                ? ` · required level ${priceEstimate.search.requiredLevelMin}–${priceEstimate.search.requiredLevelMax}`
                : ""}
              {priceEstimate.search?.strategy === "one-mod-relaxed"
                ? ` · fallback: at least ${priceEstimate.search.minimumModifierCount} of ${priceEstimate.search.selectedModifierCount} selected modifiers`
                : ""}
            </p>
            {marketValuation && marketValuation.history.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                  Recent market history
                </p>
                <ul className="mt-1 space-y-1 text-xs text-gray-300">
                  {marketValuation.history
                    .slice(-6)
                    .reverse()
                    .map((point) => (
                      <li key={point.updatedAt}>
                        {formatDateTime(point.updatedAt)} ·{" "}
                        {formatPriceAmount(point.amount)} exalted ·{" "}
                        {point.quantity.toLocaleString()} volume
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {comparableCount > 0 && (
              <div className="mt-3">
                {marketValuation && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-200">
                    Official trade comparables
                  </p>
                )}
                <ul className="mt-1 space-y-1 text-sm text-gray-200">
                  {(priceEstimate.comparables || []).map(
                    (comparable, index) => (
                      <li
                        key={`${comparable.itemId}-${index}`}
                        tabIndex={comparable.item ? 0 : undefined}
                        className="group relative rounded px-1 py-0.5 hover:bg-gray-600 focus:bg-gray-600"
                      >
                        <span>
                          {comparable.listedAmount} {comparable.listedCurrency}
                          {comparable.currency !==
                            comparable.listedCurrency && (
                            <span className="text-gray-400">
                              {` (~${formatPriceAmount(comparable.amount)} ${comparable.currency})`}
                            </span>
                          )}
                        </span>
                        {comparable.item && (
                          <ComparableItemTooltip
                            item={comparable.item}
                            usedExplicitHashes={usedExplicitHashes}
                            usedImplicitHashes={usedImplicitHashes}
                          />
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
            <p
              className={`text-sm mt-2 ${hasGreatPrice ? "text-green-600" : "text-gray-300"}`}
            >
              {hasGreatPrice
                ? formatSuggestedPriceLabel(priceEstimate.price, hasGreatPrice)
                : marketIsPrimary
                  ? `Suggested price: ${formatPriceAmount(priceEstimate.price.amount)} ${priceEstimate.price.currency}`
                  : `Suggested price: ${formatPriceAmount(priceEstimate.price.amount)} ${priceEstimate.price.currency} | Spread: ${formatPriceAmount(priceEstimate.stdDev.amount)} ${priceEstimate.stdDev.currency}`}
              {priceEstimate.checkedAt !== undefined &&
                ` | Checked at: ${formatDateTime(priceEstimate.checkedAt)}`}
            </p>
          </details>
        )}

        <p
          className={`${isExpanded ? "" : "hidden"} text-sm text-gray-400 mt-4`}
        >
          Stash: {item.listing.stash.name} (x: {item.listing.stash.x}, y:{" "}
          {item.listing.stash.y})
        </p>
        {isExpanded && listingSinceLabel && (
          <p className="mt-1 text-sm text-gray-400">{listingSinceLabel}</p>
        )}
      </div>
      <div
        className={`${isExpanded ? "flex" : "hidden"} flex-col sm:flex-col flex-shrink-0 mt-4 sm:mt-0 sm:ml-4 w-full sm:w-auto gap-4`}
      >
        <button
          onClick={() => props.onRefreshClick?.(item)}
          className={buttonStyle}
        >
          Refresh
        </button>

        <button
          onClick={handlePriceClick}
          disabled={isPriceChecking}
          className={`${buttonStyle} disabled:opacity-50`}
        >
          {isPriceChecking ? "Checking..." : "Price Check"}
        </button>
        <button className={buttonStyle} onClick={copyNameToClipboard}>
          Copy
        </button>
        <button onClick={openSearchInDefaultBrowser} className={buttonStyle}>
          Search
        </button>
        {isPriceChecking && (
          <p className="text-sm text-blue-300 text-left">
            Searching {itemLeague} listings...
          </p>
        )}
        {priceCheckError && (
          <p className="text-sm text-red-300 text-left">{priceCheckError}</p>
        )}
        {searchError && (
          <p className="text-sm text-red-300 text-left">{searchError}</p>
        )}
      </div>
    </div>
  );
}
