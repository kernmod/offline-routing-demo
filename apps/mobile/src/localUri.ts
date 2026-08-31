/** Converts Expo's local `file://` URI into the native bridge's path-only input. */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) throw new Error("local_file_uri_required");
  const path = decodeURIComponent(uri.slice("file://".length));
  if (!path.startsWith("/")) throw new Error("local_file_uri_required");
  return path;
}
