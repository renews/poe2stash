import {
  formatItemMod,
  formatDateTime,
  formatPriceAmount,
  ModifierSelection,
  Price,
  Poe2Item,
  getItemModifierHash,
  getModifierDisplayKind,
  ModifierDisplayKind,
} from "../services/types";
import { useState } from "react";
import { Estimate, isGemItem, PriceChecker } from "../services/PriceEstimator";
import { createTradeSearchUrl } from "../services/externalLinks";

const ItemNameWithRarity: React.FC<{ item: Poe2Item }> = ({ item }) => {
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

  return (
    <h2 className={`font-bold text-xl ${rarityColor} text-left`}>
      {item.item.name || item.item.typeLine}
    </h2>
  );
};

type ModifierKind = "implicit" | "explicit";

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
  const [searchId, setSearchId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPriceChecking, setIsPriceChecking] = useState(false);
  const [priceCheckError, setPriceCheckError] = useState<string | null>(null);
  const gemItem = isGemItem(item);

  const isModifierSelected = (kind: ModifierKind, index: number) =>
    props.modifierSelection?.[kind]?.[index] !== false;

  const updateModifierSelection = (
    kind: ModifierKind,
    index: number,
    checked: boolean,
  ) => {
    const modifiers =
      kind === "implicit"
        ? item.item.implicitMods || []
        : item.item.explicitMods || [];
    const current = props.modifierSelection?.[kind] || [];
    const values = modifiers.map(
      (_modifier, modifierIndex) => current[modifierIndex] !== false,
    );
    values[index] = checked;

    props.onModifierSelectionChange?.({
      implicit:
        kind === "implicit"
          ? values
          : props.modifierSelection?.implicit ||
            (item.item.implicitMods || []).map(() => true),
      explicit:
        kind === "explicit"
          ? values
          : props.modifierSelection?.explicit ||
            (item.item.explicitMods || []).map(() => true),
      itemLevel: props.modifierSelection?.itemLevel === true,
    });
  };

  const copyNameToClipboard = () => {
    navigator.clipboard.writeText(item.item.name || item.item.typeLine);
  };

  const openSearchInDefaultBrowser = async () => {
    const itemLeague = item.item?.league || props.league;
    setSearchError(null);

    try {
      if (!searchId) {
        const matchingItem = await PriceChecker.findMatchingItem(
          item,
          itemLeague,
          props.modifierSelection,
          props.modifierRangePercent,
        );
        if (!matchingItem?.id) {
          setSearchError("No trade search was created.");
          return;
        }

        setSearchId(matchingItem.id);
        window.open(
          createTradeSearchUrl(itemLeague, matchingItem.id),
          "_blank",
        );
        return;
      }

      window.open(createTradeSearchUrl(itemLeague, searchId), "_blank");
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
      await props.onPriceClick(item, {
        implicit: (item.item.implicitMods || []).map(
          (_modifier, index) =>
            props.modifierSelection?.implicit?.[index] !== false,
        ),
        explicit: (item.item.explicitMods || []).map(
          (_modifier, index) =>
            props.modifierSelection?.explicit?.[index] !== false,
        ),
        itemLevel: !gemItem && props.modifierSelection?.itemLevel === true,
      });
    } catch (error) {
      setPriceCheckError(
        error instanceof Error ? error.message : "Price check failed.",
      );
    } finally {
      setIsPriceChecking(false);
    }
  };

  const itemLeague = item.item?.league || props.league;
  const priceEstimate = props.priceEstimate;
  const hasGreatPrice = priceEstimate?.matchesCurrentPrice === true;
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
            <ItemNameWithRarity item={item} />
            <p className="text-sm text-gray-400 text-left">
              {!item.item.name ? item.item.baseType : item.item.typeLine}
            </p>
          </div>

          <div className="text-right mt-2 sm:mt-0">
            <div className="font-semibold text-green-600 text-lg">
              {item.listing.price.amount} {item.listing.price.currency}
              {props.priceSuggestion && (
                <p
                  className="font-semibold text-orange-600"
                  title={
                    !hasGreatPrice && props.priceSuggestion.lowerPrice
                      ? `Lower denomination: ${formatPriceAmount(props.priceSuggestion.lowerPrice.amount)} ${props.priceSuggestion.lowerPrice.currency}`
                      : undefined
                  }
                >
                  {hasGreatPrice
                    ? "Already with a great price!"
                    : `suggested price: ~${formatPriceAmount(props.priceSuggestion.amount)} ${props.priceSuggestion.currency}`}
                </p>
              )}
            </div>
          </div>
        </div>

        {item.item.corrupted && (
          <p className="text-red-500 font-semibold mb-2">Corrupted</p>
        )}

        <div className="space-y-4">
          {!gemItem && (
            <div className="bg-gray-700 p-3 rounded-md">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={props.modifierSelection?.itemLevel === true}
                  onChange={(event) =>
                    props.onModifierSelectionChange?.({
                      implicit:
                        props.modifierSelection?.implicit ||
                        (item.item.implicitMods || []).map(() => true),
                      explicit:
                        props.modifierSelection?.explicit ||
                        (item.item.explicitMods || []).map(() => true),
                      itemLevel: event.target.checked,
                    })
                  }
                  className="form-checkbox text-blue-600"
                />
                <span>Item level (minimum): {item.item.ilvl}</span>
              </label>
            </div>
          )}

          {item.item.implicitMods && item.item.implicitMods.length > 0 && (
            <div className="bg-gray-700 p-3 rounded-md">
              <h3 className="font-semibold text-blue-300 mb-1">
                Implicit Mods:
              </h3>
              <ul className="list-none text-sm text-left space-y-1">
                {item.item.implicitMods?.map((mod, index) => (
                  <li
                    key={index}
                    className={modifierColorClass(
                      getModifierDisplayKind(item, "implicit", index),
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isModifierSelected("implicit", index)}
                        onChange={(event) =>
                          updateModifierSelection(
                            "implicit",
                            index,
                            event.target.checked,
                          )
                        }
                        className="form-checkbox mt-1 text-blue-600"
                      />
                      <span>{formatItemMod(mod)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.item.enchantMods && item.item.enchantMods.length > 0 && (
            <div className="bg-gray-700 p-3 rounded-md">
              <h3 className="font-semibold text-purple-300 mb-1">
                Enchant Mods:
              </h3>
              <ul className="list-none text-sm text-left space-y-1">
                {item.item.enchantMods?.map((mod, index) => (
                  <li key={index} className="text-purple-200">
                    {formatItemMod(mod)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-gray-700 p-3 rounded-md">
            <h3 className="font-semibold text-gray-300 mb-1">Explicit Mods:</h3>
            <ul className="list-none text-sm text-left space-y-1">
              {item.item.explicitMods?.map((mod, index) => (
                <li
                  key={index}
                  className={modifierColorClass(
                    getModifierDisplayKind(item, "explicit", index),
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isModifierSelected("explicit", index)}
                      onChange={(event) =>
                        updateModifierSelection(
                          "explicit",
                          index,
                          event.target.checked,
                        )
                      }
                      className="form-checkbox mt-1 text-blue-600"
                    />
                    <span>{formatItemMod(mod)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {priceEstimate && (
          <details className="bg-gray-700 p-3 rounded-md mb-4 text-left">
            <summary className="cursor-pointer font-semibold text-orange-300">
              Suggested price uses {priceEstimate.comparables?.length || 0}{" "}
              listings
            </summary>
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
            </p>
            <ul className="text-sm text-gray-200 mt-2 space-y-1">
              {(priceEstimate.comparables || []).map((comparable, index) => (
                <li
                  key={`${comparable.itemId}-${index}`}
                  tabIndex={comparable.item ? 0 : undefined}
                  className="group relative rounded px-1 py-0.5 hover:bg-gray-600 focus:bg-gray-600"
                >
                  <span>
                    {comparable.listedAmount} {comparable.listedCurrency}
                    {comparable.currency !== comparable.listedCurrency && (
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
              ))}
            </ul>
            <p className="text-sm text-gray-300 mt-2">
              {hasGreatPrice
                ? "Already with a great price!"
                : `Suggested price: ${formatPriceAmount(priceEstimate.price.amount)} ${priceEstimate.price.currency} | Spread: ${formatPriceAmount(priceEstimate.stdDev.amount)} ${priceEstimate.stdDev.currency}`}
              {priceEstimate.checkedAt !== undefined &&
                ` | Checked at: ${formatDateTime(priceEstimate.checkedAt)}`}
            </p>
          </details>
        )}

        <p className="text-sm text-gray-400 mt-4">
          Stash: {item.listing.stash.name} (x: {item.listing.stash.x}, y:{" "}
          {item.listing.stash.y})
        </p>
      </div>
      <div className="flex flex-col sm:flex-col flex-shrink-0 mt-4 sm:mt-0 sm:ml-4 w-full sm:w-auto gap-4">
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

function modifierColorClass(kind: ModifierDisplayKind) {
  switch (kind) {
    case "implicit":
      return "text-blue-200";
    case "enchant":
      return "text-purple-200";
    case "prefix":
      return "text-cyan-200";
    case "suffix":
      return "text-fuchsia-200";
    default:
      return "text-gray-200";
  }
}
