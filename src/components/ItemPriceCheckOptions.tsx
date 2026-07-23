import {
  formatItemMod,
  getItemModifierTierLabels,
  getModifierDisplayKind,
  ModifierSelection,
  Poe2Item,
} from "../services/types";
import {
  getDefaultRequiredLevelRange,
  getItemRuneSocketCount,
  getItemRequiredLevel,
  isGemItem,
} from "../services/PriceEstimator";
import { completeModifierSelection } from "../services/modifierSelection";
import { formFieldClassName, modifierColorClass } from "./formStyles";
import { ModifierTierBadges } from "./ModifierTierBadges";

type ModifierKind = "implicit" | "explicit" | "enchant";

export function ItemPriceCheckOptions(props: {
  item: Poe2Item;
  modifierSelection?: ModifierSelection;
  onModifierSelectionChange?: (selection: ModifierSelection) => void;
  className?: string;
}) {
  const { item } = props;
  const gemItem = isGemItem(item);
  const defaultRequiredLevelRange = gemItem
    ? undefined
    : getDefaultRequiredLevelRange(getItemRequiredLevel(item));
  const itemRuneSocketCount = gemItem
    ? undefined
    : getItemRuneSocketCount(item);
  const runeSocketsSelected =
    props.modifierSelection?.runeSockets ??
    (itemRuneSocketCount !== undefined && itemRuneSocketCount > 0);
  const itemName =
    item.item.name || item.item.typeLine || item.item.baseType || "Item";

  const getCompleteSelection = (overrides: Partial<ModifierSelection> = {}) =>
    completeModifierSelection(item, props.modifierSelection, overrides);

  const isModifierSelected = (kind: ModifierKind, index: number) =>
    props.modifierSelection?.[kind]?.[index] !== false;

  const updateModifierSelection = (
    kind: ModifierKind,
    index: number,
    checked: boolean,
  ) => {
    const modifiers =
      kind === "implicit"
        ? item.item.implicitMods || []
        : kind === "enchant"
          ? item.item.enchantMods || []
          : item.item.explicitMods || [];
    const current = props.modifierSelection?.[kind] || [];
    const values = modifiers.map(
      (_modifier, modifierIndex) => current[modifierIndex] !== false,
    );
    values[index] = checked;

    props.onModifierSelectionChange?.(getCompleteSelection({ [kind]: values }));
  };

  return (
    <div
      aria-label={`Price check options for ${itemName}`}
      className={props.className || "space-y-4"}
    >
      {!gemItem && (
        <div className="bg-gray-700 p-3 rounded-md">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={props.modifierSelection?.itemLevel === true}
              onChange={(event) =>
                props.onModifierSelectionChange?.(
                  getCompleteSelection({ itemLevel: event.target.checked }),
                )
              }
              className="form-checkbox text-blue-600"
            />
            <span>Item level (minimum): {item.item.ilvl}</span>
          </label>
        </div>
      )}

      {defaultRequiredLevelRange && (
        <div className="bg-gray-700 p-3 rounded-md">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={props.modifierSelection?.requiredLevel === true}
              onChange={(event) =>
                props.onModifierSelectionChange?.(
                  getCompleteSelection({
                    requiredLevel: event.target.checked,
                  }),
                )
              }
              className="form-checkbox text-blue-600"
            />
            <span>Required level</span>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-300">
              Minimum
              <input
                type="number"
                min="0"
                step="1"
                disabled={props.modifierSelection?.requiredLevel !== true}
                value={
                  props.modifierSelection?.requiredLevelMin ??
                  defaultRequiredLevelRange.min
                }
                onChange={(event) =>
                  props.onModifierSelectionChange?.(
                    getCompleteSelection({
                      requiredLevelMin: Math.max(
                        0,
                        Math.round(Number(event.target.value)),
                      ),
                    }),
                  )
                }
                className={`${formFieldClassName} mt-1 w-full disabled:cursor-not-allowed disabled:opacity-50`}
              />
            </label>
            <label className="text-xs text-gray-300">
              Maximum
              <input
                type="number"
                min="0"
                step="1"
                disabled={props.modifierSelection?.requiredLevel !== true}
                value={
                  props.modifierSelection?.requiredLevelMax ??
                  defaultRequiredLevelRange.max
                }
                onChange={(event) =>
                  props.onModifierSelectionChange?.(
                    getCompleteSelection({
                      requiredLevelMax: Math.max(
                        0,
                        Math.round(Number(event.target.value)),
                      ),
                    }),
                  )
                }
                className={`${formFieldClassName} mt-1 w-full disabled:cursor-not-allowed disabled:opacity-50`}
              />
            </label>
          </div>
        </div>
      )}

      {itemRuneSocketCount !== undefined && (
        <div className="bg-gray-700 p-3 rounded-md">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={runeSocketsSelected}
              onChange={(event) =>
                props.onModifierSelectionChange?.(
                  getCompleteSelection({
                    runeSockets: event.target.checked,
                  }),
                )
              }
              className="form-checkbox text-blue-600"
            />
            <span>Rune sockets (minimum)</span>
          </label>
          <input
            aria-label="Minimum rune sockets"
            type="number"
            min="0"
            step="1"
            disabled={!runeSocketsSelected}
            value={
              props.modifierSelection?.runeSocketCount ?? itemRuneSocketCount
            }
            onChange={(event) =>
              props.onModifierSelectionChange?.(
                getCompleteSelection({
                  runeSocketCount: Math.max(
                    0,
                    Math.round(Number(event.target.value)),
                  ),
                }),
              )
            }
            className={`${formFieldClassName} mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50`}
          />
        </div>
      )}

      {item.item.implicitMods && item.item.implicitMods.length > 0 && (
        <div className="bg-gray-700 p-3 rounded-md">
          <h3 className="font-semibold text-blue-300 mb-1">Implicit Mods:</h3>
          <ul className="list-none text-sm text-left space-y-1">
            {item.item.implicitMods.map((mod, index) => (
              <li
                key={index}
                className={modifierColorClass(
                  getModifierDisplayKind(item, "implicit", index),
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isModifierSelected("implicit", index)}
                    onChange={(event) =>
                      updateModifierSelection(
                        "implicit",
                        index,
                        event.target.checked,
                      )
                    }
                    className="form-checkbox mt-1 text-blue-600"
                  />
                  <span className="modifier-line">
                    <span>{formatItemMod(mod)}</span>
                    <ModifierTierBadges
                      tiers={getItemModifierTierLabels(
                        item,
                        "implicit",
                        index,
                        mod,
                      )}
                    />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.item.enchantMods && item.item.enchantMods.length > 0 && (
        <div className="bg-gray-700 p-3 rounded-md">
          <h3 className="font-semibold text-purple-300 mb-1">Enchant Mods:</h3>
          <ul className="list-none text-sm text-left space-y-1">
            {item.item.enchantMods.map((mod, index) => (
              <li
                key={index}
                className={modifierColorClass(
                  getModifierDisplayKind(item, "enchant", index),
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Include enchant modifier: ${formatItemMod(mod)}`}
                    checked={isModifierSelected("enchant", index)}
                    onChange={(event) =>
                      updateModifierSelection(
                        "enchant",
                        index,
                        event.target.checked,
                      )
                    }
                    className="form-checkbox mt-1 text-purple-600"
                  />
                  <span className="modifier-line">
                    <span>{formatItemMod(mod)}</span>
                    <ModifierTierBadges
                      tiers={getItemModifierTierLabels(
                        item,
                        "enchant",
                        index,
                        mod,
                      )}
                    />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-gray-700 p-3 rounded-md">
        <h3 className="font-semibold text-gray-300 mb-1">Explicit Mods:</h3>
        <ul className="list-none text-sm text-left space-y-1">
          {item.item.explicitMods?.map((mod, index) => (
            <li
              key={index}
              className={modifierColorClass(
                getModifierDisplayKind(item, "explicit", index),
              )}
            >
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={isModifierSelected("explicit", index)}
                  onChange={(event) =>
                    updateModifierSelection(
                      "explicit",
                      index,
                      event.target.checked,
                    )
                  }
                  className="form-checkbox mt-1 text-blue-600"
                />
                <span className="modifier-line">
                  <span>{formatItemMod(mod)}</span>
                  <ModifierTierBadges
                    tiers={getItemModifierTierLabels(
                      item,
                      "explicit",
                      index,
                      mod,
                    )}
                  />
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
