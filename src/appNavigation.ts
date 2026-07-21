export function hasConfiguredAccount(accountName: string) {
  return Boolean(accountName.trim());
}

export function getAccountStatusLabel(accountName: string) {
  return hasConfiguredAccount(accountName) ? "Account ready" : "Setup required";
}

export function shouldOpenConfiguration(pathname: string, accountName: string) {
  return pathname === "/" && !hasConfiguredAccount(accountName);
}

export function canStartAccountSync(accountName: string, isSyncing: boolean) {
  return hasConfiguredAccount(accountName) && !isSyncing;
}

export function canViewSaleHistory(accountName: string) {
  return hasConfiguredAccount(accountName);
}
