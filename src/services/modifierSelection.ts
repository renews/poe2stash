import {
  getDefaultRequiredLevelRange,
  getItemRuneSocketCount,
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
  const runeSocketCount = isGemItem(item)
    ? undefined
    : getItemRuneSocketCount(item);

  return {
    implicit:
      selection?.implicit ?? (item.item.implicitMods || []).map(() => true),
    explicit:
      selection?.explicit ?? (item.item.explicitMods || []).map(() => true),
    enchant:
      selection?.enchant ?? (item.item.enchantMods || []).map(() => true),
    itemLevel: selection?.itemLevel === true,
    requiredLevel: selection?.requiredLevel === true,
    ...(runeSocketCount !== undefined
      ? {
          runeSockets: selection?.runeSockets ?? runeSocketCount > 0,
          runeSocketCount: selection?.runeSocketCount ?? runeSocketCount,
        }
      : {}),
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
