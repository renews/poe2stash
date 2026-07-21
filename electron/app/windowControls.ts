export type WindowControlAction =
  | "minimize"
  | "toggle-maximize"
  | "close";

export interface WindowControlTarget {
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  close: () => void;
  isMaximized: () => boolean;
}

export function isWindowControlAction(
  value: unknown,
): value is WindowControlAction {
  return (
    value === "minimize" ||
    value === "toggle-maximize" ||
    value === "close"
  );
}

export function performWindowControl(
  target: WindowControlTarget,
  action: WindowControlAction,
) {
  switch (action) {
    case "minimize":
      target.minimize();
      break;
    case "toggle-maximize":
      if (target.isMaximized()) {
        target.unmaximize();
      } else {
        target.maximize();
      }
      break;
    case "close":
      target.close();
      break;
  }

  return action === "toggle-maximize" ? target.isMaximized() : false;
}
