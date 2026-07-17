import {
  formatItemMod,
  formatPriceAmount,
  Poe2Item,
} from "../services/types";
import { useState } from "react";
import { Estimate, PriceChecker } from "../services/PriceEstimator";

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

export function PoeListItem(props: {
  item: Poe2Item;
  league: string;
  priceSuggestion?: { amount: number; currency: string };
  priceEstimate?: Estimate;
  onPriceClick?: (item: Poe2Item) => void;
  onRefreshClick?: (item: Poe2Item) => void;
}) {
  const { item } = props;
  const [searchId, setSearchId] = useState<string | null>(null);
  const [isPriceChecking, setIsPriceChecking] = useState(false);
  const [priceCheckError, setPriceCheckError] = useState<string | null>(null);

  const copyNameToClipboard = () => {
    navigator.clipboard.writeText(item.item.name || item.item.typeLine);
  };

  const openSearchInNewWindow = async () => {
    const itemLeague = item.item?.league || props.league;

    if (!searchId) {
      const matchingItem = await PriceChecker.findMatchingItem(item, itemLeague);
      if (matchingItem && matchingItem.id) {
        setSearchId(matchingItem.id);
        window.open(
          `https://www.pathofexile.com/trade2/search/poe2/${itemLeague}/${matchingItem.id}`,
          "_blank",
        );
      }
    } else {
      window.open(
        `https://www.pathofexile.com/trade2/search/poe2/${itemLeague}/${searchId}`,
        "_blank",
      );
    }
  };

  const handlePriceClick = async () => {
    if (!props.onPriceClick || isPriceChecking) return;

    setIsPriceChecking(true);
    setPriceCheckError(null);

    try {
      await props.onPriceClick(item);
    } catch (error) {
      setPriceCheckError(
        error instanceof Error ? error.message : "Price check failed.",
      );
    } finally {
      setIsPriceChecking(false);
    }
  };

  const itemLeague = item.item?.league || props.league;

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
                <p className="font-semibold text-orange-600">
                  estimate: ~{formatPriceAmount(props.priceSuggestion.amount)}{" "}
                  {props.priceSuggestion.currency}
                </p>
              )}
            </div>
          </div>
        </div>

        {item.item.corrupted && (
          <p className="text-red-500 font-semibold mb-2">Corrupted</p>
        )}

        <div className="space-y-4">
          {item.item.implicitMods && item.item.implicitMods.length > 0 && (
            <div className="bg-gray-700 p-3 rounded-md">
              <h3 className="font-semibold text-blue-300 mb-1">
                Implicit Mods:
              </h3>
              <ul className="list-none text-sm text-left space-y-1">
                {item.item.implicitMods?.map((mod, index) => (
                  <li key={index} className="text-blue-200">
                    {formatItemMod(mod)}
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
                <li key={index} className="text-gray-200">
                  {formatItemMod(mod)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {props.priceEstimate && (
          <details open className="bg-gray-700 p-3 rounded-md mb-4 text-left">
            <summary className="cursor-pointer font-semibold text-orange-300">
              Price check used {props.priceEstimate.comparables?.length || 0} listings
            </summary>
            <p className="text-sm text-gray-300 mt-2">
              Search: {props.priceEstimate.search?.name || props.priceEstimate.search?.baseType || "item"}
              {props.priceEstimate.search?.rarity
                ? ` (${props.priceEstimate.search.rarity})`
                : ""}
              {props.priceEstimate.search?.league
                ? ` in ${props.priceEstimate.search.league}`
                : ""}
            </p>
            <ul className="text-sm text-gray-200 mt-2 space-y-1">
              {(props.priceEstimate.comparables || []).map((comparable, index) => (
                <li key={`${comparable.itemId}-${index}`}>
                  {comparable.listedAmount} {comparable.listedCurrency}
                  {comparable.currency !== comparable.listedCurrency && (
                    <span className="text-gray-400">
                      {` (~${formatPriceAmount(comparable.amount)} ${comparable.currency})`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-300 mt-2">
              Average: {formatPriceAmount(props.priceEstimate.price.amount)} {props.priceEstimate.price.currency}
              {` | Spread: ${formatPriceAmount(props.priceEstimate.stdDev.amount)} ${props.priceEstimate.stdDev.currency}`}
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
        <button onClick={openSearchInNewWindow} className={buttonStyle}>
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
      </div>
    </div>
  );
}
