/** Only local screens can be replayed after authentication. Never accept a URL origin. */
export function internalDestination(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/";
  const path = value.split("?")[0];
  if (
    /^\/(feature\/(receipt|shift|drafts|device|store)|edit\/(customers|invoices|quotes|books%2[fF]transactions|drive%2[fF](earnings|trips|vehicles|expenses)|books\/transactions|drive\/(earnings|trips|vehicles|expenses))\/(new|[0-9a-fA-F-]{36})|invite\/[A-Za-z0-9_-]+)$/.test(
      path,
    )
  )
    return value;
  if (
    ["/", "/profile", "/billing", "/search", "/assistant", "/legal", "/reports", "/tax"].includes(
      path,
    ) ||
    /^\/resource\/[A-Za-z0-9%/-]+$/.test(path)
  )
    return value;
  return "/";
}
