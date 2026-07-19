import { formatDateTime } from "./types";

export function getListingSinceDateTime(indexed?: string) {
  const timestamp = Date.parse(indexed || "");
  return Number.isFinite(timestamp) ? formatDateTime(timestamp) : undefined;
}

export function getListingSinceLabel(indexed?: string) {
  const dateTime = getListingSinceDateTime(indexed);
  return dateTime ? `On sale since: ${dateTime}` : undefined;
}
