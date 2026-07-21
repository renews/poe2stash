import { Poe2Item } from "./types";

export function resolveSelectedItem(
  items: Poe2Item[],
  selectedItemId: string | null,
) {
  return items.find((item) => item.id === selectedItemId) || items[0];
}
