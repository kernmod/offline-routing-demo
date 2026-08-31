export function fixtureStyleUrl(
  basePath: string = import.meta.env.BASE_URL,
  origin: string = window.location.origin
): string {
  return new URL("style.json", new URL(basePath, origin)).toString();
}
