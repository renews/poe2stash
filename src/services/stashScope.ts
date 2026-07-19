import { Poe2Item } from "./types";

const stashTabNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortStashTabNames(names: string[]) {
  return [...names].sort(stashTabNameCollator.compare);
}

export type StashItemGroup = {
  stashName: string;
  items: Poe2Item[];
};

export function groupItemsByStash(items: Poe2Item[]): StashItemGroup[] {
  const groupedItems = items.reduce<Map<string, Poe2Item[]>>(
    (groups, item) => {
      const stashName = item.listing?.stash?.name?.trim() || "Unassigned";
      const stashItems = groups.get(stashName) || [];
      stashItems.push(item);
      groups.set(stashName, stashItems);
      return groups;
    },
    new Map(),
  );

  return sortStashTabNames([...groupedItems.keys()]).map((stashName) => ({
    stashName,
    items: groupedItems.get(stashName) || [],
  }));
}

export function getPublicListingStashCounts(items: Poe2Item[]) {
  return items.reduce<Record<string, number>>(
    (counts, item) => {
      counts.All += 1;
      const stashName = item.listing?.stash?.name;
      if (stashName) {
        counts[stashName] = (counts[stashName] || 0) + 1;
      }
      return counts;
    },
    { All: 0 },
  );
}

export function getPublicListingStashLabel(
  stashName: string,
  counts: Record<string, number>,
) {
  const count = counts[stashName] || 0;
  return stashName === "All"
    ? `All publicly listed items (${count})`
    : `${stashName} (${count})`;
}
