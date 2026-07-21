import React, { useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SearchX,
} from "lucide-react";
import { Estimate } from "../services/PriceEstimator";
import {
  formatItemMod,
  formatPriceAmount,
  formatSuggestedPriceLabel,
  ModifierSelection,
  Poe2Item,
} from "../services/types";
import { getPublicListingStashCounts } from "../services/stashScope";
import { resolveSelectedItem } from "../services/itemSelection";
import { median } from "../services/priceAnalysis";
import {
  createDefaultTradeSidebarVisibility,
  shouldOpenMarketInspectorForSelection,
  toggleTradeSidebar,
  type TradeSidebar,
} from "../services/tradeSidebarState";
import { ComparableItemHoverCard } from "./ComparableItemHoverCard";
import { CompactItemList } from "./CompactItemList";
import { useUpscaledPrices } from "../hooks/useUpscaledPrices";

interface TradeWorkspaceProps {
  items: Poe2Item[];
  allItems: Poe2Item[];
  stashTabs: string[];
  selectedStash: string;
  priceEstimates: Record<string, Estimate>;
  modifierSelections: Record<string, ModifierSelection>;
  league: string;
  openMarketInspectorOnSelect: boolean;
  isPriceChecking: boolean;
  onStashSelect: (stashName: string) => void;
  onPriceCheck: (
    item: Poe2Item,
    selection?: ModifierSelection,
  ) => void | Promise<void>;
  onModifierSelectionChange: (
    itemId: string,
    selection: ModifierSelection,
  ) => void;
  onStashPriceCheck: (items: Poe2Item[]) => void | Promise<void>;
}

function getItemName(item: Poe2Item) {
  return (
    item.item?.name || item.item?.typeLine || item.item?.baseType || "Item"
  );
}

function getComparableRange(estimate?: Estimate) {
  const comparables = (estimate?.comparables || []).filter((comparable) =>
    Number.isFinite(comparable.amount),
  );

  if (!comparables.length) {
    return undefined;
  }

  const currencies = new Set(
    comparables.map((comparable) => comparable.currency).filter(Boolean),
  );
  if (
    currencies.size !== 1 ||
    comparables.some((comparable) => !comparable.currency)
  ) {
    return { status: "mixed" as const };
  }

  const amounts = comparables
    .map((comparable) => comparable.amount)
    .sort((left, right) => left - right);

  return {
    status: "ready" as const,
    currency: [...currencies][0],
    minimum: amounts[0],
    maximum: amounts[amounts.length - 1],
    median: median(amounts),
  };
}

const MarketInspector: React.FC<{
  item?: Poe2Item;
  estimate?: Estimate;
  hidden: boolean;
  isPriceChecking: boolean;
  onPriceCheck: (item: Poe2Item) => void | Promise<void>;
  league: string;
}> = ({ item, estimate, hidden, isPriceChecking, onPriceCheck, league }) => {
  const range = useMemo(() => getComparableRange(estimate), [estimate]);
  const rangePrices =
    range?.status === "ready"
      ? [
          { amount: range.minimum, currency: range.currency },
          { amount: range.median, currency: range.currency },
          { amount: range.maximum, currency: range.currency },
        ]
      : [];
  const [minimumPrice, medianPrice, maximumPrice] = useUpscaledPrices(
    rangePrices,
    estimate?.search.league || league,
  );
  const comparables = estimate?.comparables || [];
  const usedExplicitHashes = estimate?.search.explicitHashes
    ? new Set(estimate.search.explicitHashes)
    : undefined;
  const usedImplicitHashes = estimate?.search.implicitHashes
    ? new Set(estimate.search.implicitHashes)
    : undefined;
  const modifiers = item
    ? [...(item.item.implicitMods || []), ...(item.item.explicitMods || [])]
    : [];

  return (
    <aside
      id="market-inspector"
      className="market-inspector trade-panel"
      aria-labelledby="market-inspector-title"
      data-rarity={item?.item?.rarity?.toLowerCase() || "unknown"}
      hidden={hidden}
    >
      <header className="trade-panel__header">
        <div>
          <p className="trade-kicker">Selected item</p>
          <h2 id="market-inspector-title">Market inspector</h2>
        </div>
        <BarChart3 aria-hidden="true" />
      </header>
      {!item ? (
        <div className="market-inspector__empty">
          <SearchX aria-hidden="true" />
          <p>Select an item to inspect its market signal.</p>
        </div>
      ) : (
        <div className="market-inspector__content">
          <div className="inspected-item">
            {item.item.icon && (
              <img
                src={item.item.icon}
                alt=""
                className="inspected-item__image"
              />
            )}
            <div>
              <span className="rarity-label">{item.item.rarity || "Item"}</span>
              <h3>{getItemName(item)}</h3>
              <p>{item.item.typeLine || item.item.baseType}</p>
            </div>
          </div>

          <dl className="market-summary">
            <div>
              <dt>Listed price</dt>
              <dd>
                {formatPriceAmount(item.listing.price.amount)}{" "}
                {item.listing.price.currency}
              </dd>
            </div>
            <div>
              <dt>Recommended price</dt>
              <dd>{formatSuggestedPriceLabel(estimate?.price)}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{estimate?.confidence || "Not checked"}</dd>
            </div>
            <div>
              <dt>Comparable listings</dt>
              <dd>{estimate?.comparables?.length || 0}</dd>
            </div>
          </dl>

          <section
            className="market-range"
            aria-label="Recent market range"
          >
            <div className="market-range__heading">
              <span>Recent market range</span>
              {range?.status !== "ready" && <Clock3 aria-hidden="true" />}
            </div>
            {range?.status === "ready" ? (
              <dl>
                <div>
                  <dt>Minimum</dt>
                  <dd>
                    {formatPriceAmount(minimumPrice.amount)}{" "}
                    {minimumPrice.currency}
                  </dd>
                </div>
                <div>
                  <dt>Median</dt>
                  <dd>
                    {formatPriceAmount(medianPrice.amount)} {medianPrice.currency}
                  </dd>
                </div>
                <div>
                  <dt>Maximum</dt>
                  <dd>
                    {formatPriceAmount(maximumPrice.amount)}{" "}
                    {maximumPrice.currency}
                  </dd>
                </div>
              </dl>
            ) : range?.status === "mixed" ? (
              <p>Mixed comparable currencies cannot be combined.</p>
            ) : (
              <p>Check this item to load comparable listings.</p>
            )}
          </section>

          {comparables.length > 0 && (
            <section
              className="market-comparables"
              aria-label="Comparable listings"
            >
              <h4>Comparable listings</h4>
              <ol>
                {comparables.map((comparable, index) => {
                  const comparableItem = comparable.item;
                  const comparableName = comparableItem
                    ? getItemName(comparableItem)
                    : `Comparable listing ${index + 1}`;
                  const listedAmount = Number.isFinite(
                    comparable.listedAmount,
                  )
                    ? comparable.listedAmount
                    : comparable.amount;
                  const listedCurrency =
                    comparable.listedCurrency || comparable.currency;
                  const rowContent = (
                    <>
                      <span className="market-comparable__name">
                        {comparableName}
                      </span>
                      <span className="market-comparable__price">
                        {formatPriceAmount(listedAmount)} {listedCurrency}
                      </span>
                    </>
                  );

                  return (
                    <li
                      key={`${comparable.itemId || "comparable"}-${index}`}
                      className="market-comparable"
                      data-rarity={
                        comparableItem?.item.rarity?.toLowerCase() || "unknown"
                      }
                    >
                      {comparableItem ? (
                        <ComparableItemHoverCard
                          item={comparableItem}
                          usedExplicitHashes={usedExplicitHashes}
                          usedImplicitHashes={usedImplicitHashes}
                          className="market-comparable__trigger"
                        >
                          {rowContent}
                        </ComparableItemHoverCard>
                      ) : (
                        <div className="market-comparable__trigger">
                          {rowContent}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {modifiers.length > 0 && (
            <section className="market-modifiers" aria-label="Item modifiers">
              <h4>Pricing modifiers</h4>
              <ul>
                {modifiers.slice(0, 5).map((modifier, index) => (
                  <li key={index}>{formatItemMod(modifier)}</li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            className="app-button app-button--primary market-inspector__action"
            aria-label={`Price check ${getItemName(item)}`}
            disabled={isPriceChecking}
            onClick={() => void onPriceCheck(item)}
          >
            <CheckCircle2 aria-hidden="true" />
            {isPriceChecking ? "Checking price" : "Check price"}
          </button>
        </div>
      )}
    </aside>
  );
};

export const TradeWorkspace: React.FC<TradeWorkspaceProps> = (props) => {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    props.items[0]?.id || null,
  );
  const [sidebarVisibility, setSidebarVisibility] = useState(
    createDefaultTradeSidebarVisibility,
  );
  const selectedItem = resolveSelectedItem(props.items, selectedItemId);
  const stashCounts = getPublicListingStashCounts(props.allItems);
  const stashToggleLabel = sidebarVisibility.stash
    ? "Hide stash tabs"
    : "Show stash tabs";
  const marketToggleLabel = sidebarVisibility.market
    ? "Hide market inspector"
    : "Show market inspector";
  const StashToggleIcon = sidebarVisibility.stash
    ? PanelLeftClose
    : PanelLeftOpen;
  const MarketToggleIcon = sidebarVisibility.market
    ? PanelRightClose
    : PanelRightOpen;

  const toggleSidebar = (sidebar: TradeSidebar) => {
    setSidebarVisibility((current) => toggleTradeSidebar(current, sidebar));
  };

  const selectItem = (itemId: string) => {
    if (
      shouldOpenMarketInspectorForSelection(
        selectedItem?.id,
        itemId,
        props.openMarketInspectorOnSelect,
      )
    ) {
      setSidebarVisibility((current) =>
        current.market ? current : { ...current, market: true },
      );
    }

    setSelectedItemId(itemId);
  };

  return (
    <div
      className="trade-workspace"
      data-stash-sidebar={sidebarVisibility.stash ? "open" : "closed"}
      data-market-sidebar={sidebarVisibility.market ? "open" : "closed"}
    >
      <nav
        id="sales-stash-tabs"
        className="stash-panel trade-panel"
        aria-label="Filter sales by stash tab"
        tabIndex={-1}
        hidden={!sidebarVisibility.stash}
      >
        <header className="trade-panel__header">
          <div>
            <p className="trade-kicker">Filter sales</p>
            <h2>Stash tabs</h2>
          </div>
        </header>
        <div className="stash-tabs">
          {props.stashTabs.map((stashName) => (
            <button
              key={stashName}
              type="button"
              className="stash-tab"
              aria-pressed={props.selectedStash === stashName}
              onClick={() => props.onStashSelect(stashName)}
            >
              <span>{stashName === "All" ? "All items" : stashName}</span>
              <strong>{stashCounts[stashName] || 0}</strong>
            </button>
          ))}
        </div>
        <div className="stash-panel__summary">
          <p className="trade-kicker">Market coverage</p>
          <dl>
            <div>
              <dt>Visible</dt>
              <dd>{props.items.length}</dd>
            </div>
            <div>
              <dt>Price checked</dt>
              <dd>
                {
                  props.items.filter((item) => props.priceEstimates[item.id])
                    .length
                }
              </dd>
            </div>
          </dl>
        </div>
      </nav>

      <section
        className="listing-ledger trade-panel"
        aria-labelledby="your-sales-title"
      >
        <header className="trade-panel__header listing-ledger__header">
          <div className="listing-ledger__identity">
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={stashToggleLabel}
              aria-controls="sales-stash-tabs"
              aria-expanded={sidebarVisibility.stash}
              title={stashToggleLabel}
              onClick={() => toggleSidebar("stash")}
            >
              <StashToggleIcon aria-hidden="true" />
              <span>Stash</span>
            </button>
            <div>
              <p className="trade-kicker">Trade account</p>
              <h1 id="your-sales-title">Your sales</h1>
            </div>
          </div>
          <div className="listing-ledger__actions">
            <span className="ledger-count" aria-live="polite">
              {props.items.length} {props.items.length === 1 ? "item" : "items"}
            </span>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={marketToggleLabel}
              aria-controls="market-inspector"
              aria-expanded={sidebarVisibility.market}
              title={marketToggleLabel}
              onClick={() => toggleSidebar("market")}
            >
              <span>Inspector</span>
              <MarketToggleIcon aria-hidden="true" />
            </button>
          </div>
        </header>
        <CompactItemList
          items={props.items}
          priceEstimates={props.priceEstimates}
          modifierSelections={props.modifierSelections}
          selectedItemId={selectedItem?.id}
          onSelectItem={selectItem}
          onPriceCheck={props.onPriceCheck}
          onModifierSelectionChange={props.onModifierSelectionChange}
          onStashPriceCheck={props.onStashPriceCheck}
          isPriceChecking={props.isPriceChecking}
        />
      </section>

      <MarketInspector
        item={selectedItem}
        estimate={
          selectedItem ? props.priceEstimates[selectedItem.id] : undefined
        }
        hidden={!sidebarVisibility.market}
        isPriceChecking={props.isPriceChecking}
        onPriceCheck={props.onPriceCheck}
        league={props.league}
      />
    </div>
  );
};
