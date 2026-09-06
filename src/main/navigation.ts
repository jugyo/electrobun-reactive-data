/** Privileged windows may navigate only to their application's local view. */
export function navigationRulesFor(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "views:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    /[*?]/.test(parsed.hostname)
  ) {
    throw new Error("Reactive data windows require a local views:// URL");
  }
  return JSON.stringify([`views://${parsed.hostname}/*`]);
}
