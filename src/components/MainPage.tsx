import React from "react";
import { RefreshCw, Search, Sparkles } from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import { LiveMonitorAlert } from "./LiveMonitorButton";
import { JobQueue } from "./JobQueue";
import {
  formFieldClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./formStyles";
import {
  getPublicListingStashCounts,
  getPublicListingStashLabel,
} from "../services/stashScope";
import { TradeWorkspace } from "./TradeWorkspace";

const MainPage: React.FC = () => {
  const {
    items,
    selectedLeague,
    stashTabs,
    selectedStash,
    searchTerm,
    setSearchTerm,
    isLiveMonitoring,
    isLiveMonitorStarting,
    liveMonitorError,
    toggleLiveMonitoring,
    isPriceChecking,
    priceEstimates,
    modifierSelections,
    setModifierSelection,
    openMarketInspectorOnSelect,
    errorMessage,
    setErrorMessage,
    jobs,
    setJobs,
    filterByStash,
    priceCheckItem,
    priceCheckItems,
    refreshAllItems,
    priceCheckAllItems,
    filteredItems,
  } = useAppContext();
  const stashCounts = getPublicListingStashCounts(items);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  return (
    <div className="page-shell trade-dashboard-page">
      {items.length > 0 && (
        <section className="listing-command-bar" aria-label="Sales controls">
          <label className="command-field command-field--stash" htmlFor="stash-select">
            <span className="command-field__label">Stash tab</span>
            <span className="command-field__control">
              <select
                className={formFieldClassName}
                id="stash-select"
                value={selectedStash}
                onChange={(event) => filterByStash(event.target.value)}
              >
                {stashTabs.map((stash) => (
                  <option key={stash} value={stash}>
                    {getPublicListingStashLabel(stash, stashCounts)}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="command-field command-field--search" htmlFor="item-search">
            <span className="command-field__label">Search items</span>
            <span className="command-field__control command-search">
              <Search aria-hidden="true" />
              <input
                id="item-search"
                type="search"
                value={searchTerm}
                onChange={handleSearch}
                placeholder="Search items, bases, or modifiers"
                className={formFieldClassName}
              />
            </span>
          </label>
          <button
            type="button"
            onClick={refreshAllItems}
            className={`${secondaryButtonClassName} command-icon-button`}
            aria-label="Refresh your sales"
            title="Refresh your sales"
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={priceCheckAllItems}
            disabled={isPriceChecking}
            className={`${primaryButtonClassName} price-all-button`}
          >
            <Sparkles aria-hidden="true" />
            {isPriceChecking ? "Checking prices" : "Price all"}
          </button>
        </section>
      )}

      {liveMonitorError && (
        <LiveMonitorAlert
          error={liveMonitorError}
          canReconnect={!isLiveMonitoring}
          isReconnecting={isLiveMonitorStarting}
          onReconnect={toggleLiveMonitoring}
        />
      )}

      {errorMessage && (
        <div role="alert" className="feedback feedback--error">
          {errorMessage}
        </div>
      )}

      {items.length === 0 && jobs.length === 0 && !isLiveMonitoring ? (
        <section className="empty-ledger" aria-labelledby="empty-ledger-title">
          <p className="trade-kicker">Ledger ready</p>
          <h2 id="empty-ledger-title">Your sales will appear here</h2>
          <p>
            Sync your trade account to load your sales, pricing signals, and
            sale-age details.
          </p>
        </section>
      ) : (
        <TradeWorkspace
          items={filteredItems}
          allItems={items}
          stashTabs={stashTabs}
          selectedStash={selectedStash}
          priceEstimates={priceEstimates}
          modifierSelections={modifierSelections}
          league={selectedLeague}
          openMarketInspectorOnSelect={openMarketInspectorOnSelect}
          onStashSelect={filterByStash}
          onPriceCheck={priceCheckItem}
          onModifierSelectionChange={setModifierSelection}
          onStashPriceCheck={priceCheckItems}
          isPriceChecking={isPriceChecking}
        />
      )}

      {jobs.length > 0 && (
        <JobQueue
          jobs={jobs}
          setJobs={setJobs}
          setErrorMessage={setErrorMessage}
        />
      )}
    </div>
  );
};

export default MainPage;
