import React from "react";
import { useAppContext } from "../contexts/AppContext";
import { PoeListItem } from "./PoeListItem";
import { LiveMonitorButton } from "./LiveMonitorButton";
import LiveMonitor from "./LiveMonitor";
import { JobQueue } from "./JobQueue";
import {
  formFieldClassName,
  successButtonClassName,
} from "./formStyles";
import {
  getPublicListingStashCounts,
  getPublicListingStashLabel,
  PUBLIC_LISTING_SCOPE_NOTICE,
} from "../services/stashScope";

const MainPage: React.FC = () => {
  const {
    accountName,
    selectedLeague,
    items,
    setItems,
    liveSearchItems,
    setLiveSearchItems,
    stashTabs,
    selectedStash,
    searchTerm,
    setSearchTerm,
    isLiveMonitoring,
    setIsLiveMonitoring,
    isPriceChecking,
    priceCheckProgress,
    priceEstimates,
    modifierSelections,
    setModifierSelection,
    errorMessage,
    setErrorMessage,
    jobs,
    setJobs,
    filterByStash,
    priceCheckItem,
    modifierRangePercent,
    refreshItem,
    refreshAllItems,
    priceCheckAllItems,
    filteredItems,
  } = useAppContext();
  const stashCounts = getPublicListingStashCounts(items);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  return (
    <div className="w-full p-4 pt-16">
      <h1 className="text-2xl font-bold mb-4 mt-8">Welcome to Poe2Stash</h1>

      <div className="mb-4 rounded-md border border-blue-700 bg-blue-950/40 p-3 text-sm text-blue-100">
        <p className="font-semibold">Public listing sync</p>
        <p className="mt-1 text-blue-200">{PUBLIC_LISTING_SCOPE_NOTICE}</p>
      </div>

      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <label htmlFor="stash-select" className="mr-2">
            Public listing stash tab:
          </label>
          <select
            className={`${formFieldClassName} min-w-48`}
            id="stash-select"
            value={selectedStash}
            onChange={(e) => filterByStash(e.target.value)}
          >
            {stashTabs.map((stash) => (
              <option key={stash} value={stash} className="bg-gray-600">
                {getPublicListingStashLabel(stash, stashCounts)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearch}
            placeholder="Search items..."
            className={`${formFieldClassName} min-w-48`}
          />
          <button
            onClick={refreshAllItems}
            className={successButtonClassName}
          >
            Refresh All
          </button>

          <button
            onClick={priceCheckAllItems}
            disabled={isPriceChecking}
            className={successButtonClassName}
          >
            {isPriceChecking ? "Checking Prices..." : "Price Check All"}
          </button>
          <LiveMonitorButton
            accountName={accountName}
            league={selectedLeague}
            items={items}
            liveSearchItems={liveSearchItems}
            isLiveMonitoring={isLiveMonitoring}
            setIsLiveMonitoring={setIsLiveMonitoring}
            setLiveSearchItems={setLiveSearchItems}
            setItems={setItems}
            onPriceCheck={priceCheckItem}
          />
          <div className="flex-grow text-right">
            {filteredItems.length} items found
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <JobQueue
          jobs={jobs}
          setJobs={setJobs}
          setErrorMessage={setErrorMessage}
        />
      )}

      {isLiveMonitoring && (
        <LiveMonitor
          items={liveSearchItems}
          priceSuggestions={priceEstimates}
        />
      )}

      {isPriceChecking && (
        <div className="text-blue-500 mb-4">
          Price checking in progress... Please wait.
          {priceCheckProgress && (
            <div className="text-sm mt-1">{priceCheckProgress}</div>
          )}
        </div>
      )}

      {errorMessage && <div className="text-red-500 mb-4">{errorMessage}</div>}

      {filteredItems.map((item) => (
        <PoeListItem
          key={item.id}
          item={item}
          league={selectedLeague}
          onPriceClick={priceCheckItem}
          modifierRangePercent={modifierRangePercent}
          onRefreshClick={refreshItem}
          modifierSelection={modifierSelections[item.id]}
          onModifierSelectionChange={(selection) =>
            setModifierSelection(item.id, selection)
          }
          priceSuggestion={priceEstimates[item.id]?.price}
          priceEstimate={priceEstimates[item.id]}
        />
      ))}
    </div>
  );
};

export default MainPage;
