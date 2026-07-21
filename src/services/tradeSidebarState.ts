export type TradeSidebar = "stash" | "market";

export interface TradeSidebarVisibility {
  stash: boolean;
  market: boolean;
}

export function createDefaultTradeSidebarVisibility(): TradeSidebarVisibility {
  return { stash: true, market: false };
}

export function toggleTradeSidebar(
  visibility: TradeSidebarVisibility,
  sidebar: TradeSidebar,
): TradeSidebarVisibility {
  return {
    ...visibility,
    [sidebar]: !visibility[sidebar],
  };
}

export function shouldOpenMarketInspectorForSelection(
  currentItemId: string | undefined,
  nextItemId: string,
  openOnSelect: boolean,
) {
  return openOnSelect && currentItemId !== nextItemId;
}
