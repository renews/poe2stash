import React from "react";
import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import MainPage from "./components/MainPage";
import MessagesPage from "./components/MessagesPage";
import CurrencyRatesPage from "./components/CurrencyRatesPage";
import ConfigurationPage from "./components/ConfigurationPage";
import SaleHistoryPage from "./components/SaleHistoryPage";
import { PrimaryNavigation } from "./components/PrimaryNavigation";
import { WindowControls } from "./components/WindowControls";
import LiveMonitor from "./components/LiveMonitor";
import { type LiveMonitorStatus } from "./components/LiveMonitorButton";
import { AppContextProvider, useAppContext } from "./contexts/AppContext";
import {
  canViewSaleHistory,
  getAccountStatusLabel,
  hasConfiguredAccount,
  shouldOpenConfiguration,
} from "./appNavigation";
import "./App.css";

const AppContent: React.FC = () => {
  const {
    accountName,
    selectedLeague,
    liveSearchItems,
    priceEstimates,
    isLiveMonitoring,
    isLiveMonitorStarting,
    liveMonitorError,
    toggleLiveMonitoring,
  } = useAppContext();
  const hasAccount = hasConfiguredAccount(accountName);
  const accountStatusLabel = getAccountStatusLabel(accountName);
  const liveMonitorStatus: LiveMonitorStatus = !hasAccount
    ? "unavailable"
    : isLiveMonitorStarting
      ? "starting"
      : liveMonitorError
        ? "disconnected"
        : isLiveMonitoring
          ? "watching"
          : "paused";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <section className="app-workspace">
        <div className="app-status-bar window-drag-region">
          <div className="app-status-bar__session" aria-label="Current session">
            <span
              className="status-account"
              aria-label={
                hasAccount
                  ? `Account configured: ${accountName}`
                  : "Account not configured"
              }
              title={accountName || "No account configured"}
            >
              <span
                aria-hidden="true"
                className={`status-dot ${hasAccount ? "status-dot--ready" : ""}`}
              />
              {accountStatusLabel}
              <span className="status-separator" aria-hidden="true">
                •
              </span>
              <strong>{accountName || "Account not configured"}</strong>
            </span>
            <span className="status-divider" aria-hidden="true" />
            <span className="status-league">
              League: <strong>{selectedLeague}</strong>
            </span>
            <span className="status-divider" aria-hidden="true" />
            <span className="status-community">
              Unofficial free community tool
            </span>
          </div>
          <WindowControls />
        </div>
        <PrimaryNavigation accountName={accountName} />
        <main id="main-content" className="app-main" tabIndex={-1}>
          <Routes>
            <Route
              path="/"
              element={
                shouldOpenConfiguration("/", accountName) ? (
                  <Navigate to="/configuration" replace />
                ) : (
                  <MainPage />
                )
              }
            />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/currency-rates" element={<CurrencyRatesPage />} />
            <Route path="/configuration" element={<ConfigurationPage />} />
            <Route
              path="/sale-history"
              element={
                canViewSaleHistory(accountName) ? (
                  <SaleHistoryPage />
                ) : (
                  <Navigate to="/configuration" replace />
                )
              }
            />
          </Routes>
        </main>
        <LiveMonitor
          items={liveSearchItems}
          priceSuggestions={priceEstimates}
          league={selectedLeague}
          status={liveMonitorStatus}
          onToggle={toggleLiveMonitoring}
        />
      </section>
    </div>
  );
};

const App: React.FC = () => (
  <AppContextProvider>
    <Router>
      <AppContent />
    </Router>
  </AppContextProvider>
);

export default App;
