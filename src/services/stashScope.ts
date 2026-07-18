import { Poe2Item } from "./types";

export const PUBLIC_LISTING_SCOPE_NOTICE =
  "Account sync includes publicly listed trade items only. Private and unlisted stash contents are not available through the supported Path of Exile 2 APIs.";

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
