import { ModifierDisplayKind } from "../services/types";

export const formFieldClassName = "form-field";

export const formLabelClassName = "form-label";

export const primaryButtonClassName = "app-button app-button--primary";

export const secondaryButtonClassName = "app-button app-button--secondary";

export function modifierColorClass(kind: ModifierDisplayKind) {
  switch (kind) {
    case "implicit":
      return "text-blue-200";
    case "enchant":
      return "text-purple-200";
    case "prefix":
      return "text-cyan-200";
    case "suffix":
      return "text-fuchsia-200";
    default:
      return "text-gray-200";
  }
}
