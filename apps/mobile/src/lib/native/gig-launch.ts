const blockedSchemes = new Set([
  "http",
  "javascript",
  "data",
  "file",
  "content",
  "intent",
  "tel",
  "sms",
  "smsto",
  "mailto",
  "geo",
  "about",
  "blob",
  "resource",
  "android-app",
  "app-settings",
  "app-prefs",
  "prefs",
  "settings",
  "itms-services",
  "itms-apps",
  "market",
]);
/** Links are an operator-verified build setting; no provider schemes are assumed or tracking data appended. */
export function gigAppLink(
  platform: string,
  configuration = process.env.EXPO_PUBLIC_GIG_APP_LINKS_JSON ?? "{}",
): string | null {
  try {
    const configured: unknown = JSON.parse(configuration);
    if (
      !configured ||
      typeof configured !== "object" ||
      Array.isArray(configured) ||
      !Object.prototype.hasOwnProperty.call(configured, platform)
    )
      return null;
    const raw = (configured as Record<string, unknown>)[platform];
    if (
      typeof raw !== "string" ||
      raw.length > 2048 ||
      raw !== raw.trim() ||
      /[\\\\\u0000-\u0020]/.test(raw) ||
      /%0[0-9a-f]|%1[0-9a-f]/i.test(raw)
    )
      return null;
    const url = new URL(raw),
      scheme = url.protocol.slice(0, -1).toLowerCase();
    if (
      !/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
      blockedSchemes.has(scheme) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (scheme === "https") return url.hostname ? raw : null;
    return raw.startsWith(`${scheme}://`) ? raw : null;
  } catch {
    return null;
  }
}
export function gigAppLabel(platform: string) {
  return (
    (
      {
        uber: "Uber",
        uber_eats: "Uber Eats",
        doordash: "DoorDash",
        airtasker: "Airtasker",
        menulog: "Menulog",
        lyft: "Lyft",
        instacart: "Instacart",
        other: "gig",
      } as Record<string, string>
    )[platform] ?? "gig"
  );
}
