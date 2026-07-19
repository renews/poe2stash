import {
  getDefaultRequiredLevelRange,
  getItemRequiredLevel,
  isGemItem,
} from "./PriceEstimator";
import { ModifierSelection, Poe2Item } from "./types";

export function completeModifierSelection(
  item: Poe2Item,
  selection?: ModifierSelection,
  overrides: Partial<ModifierSelection> = {},
): ModifierSelection {
  const defaultRequiredLevelRange = isGemItem(item)
    ? undefined
    : getDefaultRequiredLevelRange(getItemRequiredLevel(item));

  return {
    implicit:
      selection?.implicit ?? (item.item.implicitMods || []).map(() => true),
    explicit:
      selection?.explicit ?? (item.item.explicitMods || []).map(() => true),
    itemLevel: selection?.itemLevel === true,
    requiredLevel: selection?.requiredLevel === true,
    ...(defaultRequiredLevelRange
      ? {
          requiredLevelMin:
            selection?.requiredLevelMin ?? defaultRequiredLevelRange.min,
          requiredLevelMax:
            selection?.requiredLevelMax ?? defaultRequiredLevelRange.max,
        }
      : {}),
    ...overrides,
  };
}
