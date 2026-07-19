import { ModifierDisplayKind } from "../services/types";

export const formFieldClassName =
  "rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-gray-100 shadow-sm transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40";

export const formLabelClassName = "flex flex-col gap-1 text-sm text-gray-300";

export const primaryButtonClassName =
  "rounded-md bg-blue-500 px-4 py-2 font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-500 disabled:opacity-60";

export const secondaryButtonClassName =
  "rounded-md border border-gray-600 bg-gray-700 px-4 py-2 font-semibold text-gray-100 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-60";

export const successButtonClassName =
  "rounded-md bg-green-500 px-4 py-2 font-semibold text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-60";

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
