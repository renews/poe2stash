import React, { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

export const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const controls = window.windowControls;
    if (!controls) {
      return;
    }

    void controls.isMaximized().then(setIsMaximized);
    return controls.onMaximizedChange(setIsMaximized);
  }, []);

  const runControl = async (
    action: "minimize" | "toggle-maximize" | "close",
  ) => {
    const controls = window.windowControls;
    if (!controls) {
      return;
    }

    const maximized = await controls.perform(action);
    if (action === "toggle-maximize") {
      setIsMaximized(maximized);
    }
  };

  return (
    <div
      className="window-controls"
      role="group"
      aria-label="Window controls"
      data-no-drag
    >
      <button
        type="button"
        className="window-control"
        aria-label="Minimize Poe Dash"
        onClick={() => void runControl("minimize")}
      >
        <Minus aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={isMaximized ? "Restore Poe Dash" : "Maximize Poe Dash"}
        onClick={() => void runControl("toggle-maximize")}
      >
        <Square aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        aria-label="Close Poe Dash"
        onClick={() => void runControl("close")}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
};
