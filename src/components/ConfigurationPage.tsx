import React from "react";
import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../contexts/AppContext";
import { canStartAccountSync } from "../appNavigation";
import { League, Leagues } from "../data/leagues";
import {
  MAX_MODIFIER_RANGE_PERCENT,
  MIN_MODIFIER_RANGE_PERCENT,
} from "../services/PriceEstimator";
import {
  formFieldClassName,
  formLabelClassName,
  primaryButtonClassName,
} from "./formStyles";

const ConfigurationPage: React.FC = () => {
  const {
    accountName,
    setAccountName,
    selectedLeague,
    setSelectedLeague,
    priceCheckCooldownMinutes,
    setPriceCheckCooldownMinutes,
    modifierRangePercent,
    setModifierRangePercent,
    isSyncing,
    getItems,
  } = useAppContext();
  const navigate = useNavigate();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canStartAccountSync(accountName, isSyncing)) {
      return;
    }

    localStorage.setItem("accountName", accountName);
    void getItems(accountName);
    navigate("/", { replace: true });
  };

  return (
    <div className="w-full p-4 pt-16">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-8 w-8 text-blue-300" />
        <div>
          <h1 className="text-2xl font-bold">Configuration</h1>
          <p className="text-sm text-gray-400">
            Set the account, league, and price check behavior used by the app.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-lg bg-gray-800 p-6 shadow-lg sm:grid-cols-2"
      >
        <label className={formLabelClassName}>
          Account name
          <input
            type="text"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="Enter your account name"
            className={`${formFieldClassName} w-full`}
          />
        </label>

        <label className={formLabelClassName}>
          League
          <select
            value={selectedLeague}
            onChange={(event) => setSelectedLeague(event.target.value as League)}
            className={`${formFieldClassName} w-full`}
          >
            {Leagues.map((league) => (
              <option key={league} value={league}>
                {league}
              </option>
            ))}
          </select>
        </label>

        <label className={formLabelClassName}>
          Recheck after (minutes)
          <input
            type="number"
            min="0"
            step="1"
            value={priceCheckCooldownMinutes}
            onChange={(event) =>
              setPriceCheckCooldownMinutes(
                Math.max(0, Number(event.target.value) || 0),
              )
            }
            title="Minutes to reuse a recent whole-tab price check. Set to 0 to always recheck."
            className={`${formFieldClassName} w-full`}
          />
        </label>

        <label className={formLabelClassName}>
          Modifier comparison range: {modifierRangePercent}%
          <input
            type="range"
            min={MIN_MODIFIER_RANGE_PERCENT}
            max={MAX_MODIFIER_RANGE_PERCENT}
            step="1"
            value={modifierRangePercent}
            onChange={(event) =>
              setModifierRangePercent(Number(event.target.value))
            }
            title="Compare modifier values within this percentage above or below the item value."
            className="w-full accent-blue-500"
          />
          <span className="flex justify-between text-xs text-gray-400">
            <span>{MIN_MODIFIER_RANGE_PERCENT}%</span>
            <span>{MAX_MODIFIER_RANGE_PERCENT}%</span>
          </span>
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={!canStartAccountSync(accountName, isSyncing)}
            className={primaryButtonClassName}
          >
            {isSyncing
              ? "Syncing public listings..."
              : "Sync publicly listed items"}
          </button>
        </div>

      </form>
    </div>
  );
};

export default ConfigurationPage;
