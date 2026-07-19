import React from "react";
import { useAppContext } from "../contexts/AppContext";
import { PoeListItem } from "./PoeListItem";
import { LiveMonitorButton } from "./LiveMonitorButton";
import LiveMonitor from "./LiveMonitor";
import { JobQueue } from "./JobQueue";
import { formFieldClassName, successButtonClassName } from "./formStyles";
import {
  getPublicListingStashCounts,
  getPublicListingStashLabel,
} from "../services/stashScope";
import {
  CompactItemList,
  ItemViewMode,
  ItemViewToggle,
} from "./CompactItemList";

const MainPage: React.FC = () => {
  const [itemView, setItemView] = React.useState<ItemViewMode>("compact");
  const {
    accountName,
    selectedLeague,
    items,
    liveSearchItems,
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
    errorMessage,
    setErrorMessage,
    jobs,
    setJobs,
    filterByStash,
    priceCheckItem,
    priceCheckItems,
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

      {accountName && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-gray-700 bg-gray-800 p-3">
          <LiveMonitorButton
            isLiveMonitoring={isLiveMonitoring}
            isStarting={isLiveMonitorStarting}
            error={liveMonitorError}
            onToggle={toggleLiveMonitoring}
          />
          <p className="text-sm text-gray-300">
            Watches for newly published listings and checks their prices in the
            background. Fairly priced items stay silent.
          </p>
        </div>
      )}

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
          <button onClick={refreshAllItems} className={successButtonClassName}>
            Refresh All
          </button>

          <button
            onClick={priceCheckAllItems}
            disabled={isPriceChecking}
            className={successButtonClassName}
          >
            {isPriceChecking ? "Checking Prices..." : "Price Check All"}
          </button>
          <ItemViewToggle value={itemView} onChange={setItemView} />
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
          league={selectedLeague}
        />
      )}

      {errorMessage && <div className="text-red-500 mb-4">{errorMessage}</div>}

      {itemView === "compact" ? (
        <CompactItemList
          items={filteredItems}
          priceEstimates={priceEstimates}
          modifierSelections={modifierSelections}
          onPriceCheck={priceCheckItem}
          onModifierSelectionChange={setModifierSelection}
          onStashPriceCheck={priceCheckItems}
          isPriceChecking={isPriceChecking}
        />
      ) : (
        filteredItems.map((item) => (
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
        ))
      )}
    </div>
  );
};

export default MainPage;
