/**
 * Encodes a filesystem path for use in a URL, preserving path separators
 * while encoding fragment (#), query (?), spaces, and other special characters
 * that would otherwise confuse URL parsing.
 *
 * Use this for every /thumbnails/ and /originals/ URL to handle filenames
 * that contain # or other reserved URL characters.
 */
export function encodeFilePath(path: string): string {
  return path.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
}
