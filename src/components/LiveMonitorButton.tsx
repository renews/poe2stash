import React from "react";
import { WifiOff } from "lucide-react";

export type LiveMonitorStatus =
  | "unavailable"
  | "starting"
  | "watching"
  | "paused"
  | "disconnected";

interface LiveMonitorButtonProps {
  status: LiveMonitorStatus;
  onToggle: () => void;
}

const liveMonitorStatusLabels: Record<LiveMonitorStatus, string> = {
  unavailable: "Setup required",
  starting: "Connecting",
  watching: "Watching",
  paused: "Paused",
  disconnected: "Disconnected",
};

function getLiveMonitorActionLabel(status: LiveMonitorStatus) {
  switch (status) {
    case "watching":
      return "Pause live monitor";
    case "disconnected":
      return "Reconnect live monitor";
    case "unavailable":
      return "Configure an account to use live monitor";
    case "starting":
      return "Connecting live monitor";
    default:
      return "Start live monitor";
  }
}

export const LiveMonitorButton: React.FC<LiveMonitorButtonProps> = ({
  status,
  onToggle,
}) => {
  const isWatching = status === "watching";
  const isStarting = status === "starting";
  const isUnavailable = status === "unavailable";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isStarting || isUnavailable}
      aria-label={getLiveMonitorActionLabel(status)}
      aria-pressed={isWatching}
      aria-busy={isStarting}
      className="live-monitor-button"
      data-monitor-status={status}
    >
      <span
        aria-hidden="true"
        className={`live-monitor-button__dot ${isWatching ? "live-monitor-button__dot--active" : ""} ${status === "disconnected" ? "live-monitor-button__dot--error" : ""}`}
      />
      <span>Live monitor</span>
      <strong>{liveMonitorStatusLabels[status]}</strong>
    </button>
  );
};

interface LiveMonitorAlertProps {
  error: string;
  canReconnect: boolean;
  isReconnecting: boolean;
  onReconnect: () => void;
}

export const LiveMonitorAlert: React.FC<LiveMonitorAlertProps> = ({
  error,
  canReconnect,
  isReconnecting,
  onReconnect,
}) => (
  <section
    role="alert"
    aria-labelledby="live-monitor-alert-title"
    className="live-monitor-alert"
  >
    <span className="live-monitor-alert__icon" aria-hidden="true">
      <WifiOff />
    </span>
    <div className="live-monitor-alert__copy">
      <h2 id="live-monitor-alert-title">
        {canReconnect
          ? "Live monitor disconnected"
          : "Live monitor needs attention"}
      </h2>
      <p>{error}</p>
    </div>
    {canReconnect && (
      <button
        type="button"
        onClick={onReconnect}
        disabled={isReconnecting}
        aria-busy={isReconnecting}
        className="app-button live-monitor-alert__action"
      >
        {isReconnecting ? "Reconnecting" : "Reconnect"}
      </button>
    )}
  </section>
);
