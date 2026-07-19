import {
  formatItemMod,
  getModifierDisplayKind,
  ModifierSelection,
  Poe2Item,
} from "../services/types";
import {
  getDefaultRequiredLevelRange,
  getItemRequiredLevel,
  isGemItem,
} from "../services/PriceEstimator";
import { completeModifierSelection } from "../services/modifierSelection";
import { formFieldClassName, modifierColorClass } from "./formStyles";

type ModifierKind = "implicit" | "explicit";

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
                  <span>{formatItemMod(mod)}</span>
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
              <li key={index} className="text-purple-200">
                {formatItemMod(mod)}
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
                <span>{formatItemMod(mod)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
