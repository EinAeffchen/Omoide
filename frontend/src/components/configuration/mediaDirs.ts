import { MediaDirectory } from "../../types";

export const normalizeMediaDirPath = (raw: string): string => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const unified = trimmed.replace(/[\\/]+/g, "/");
  return unified.replace(/\/+$/, "").toLowerCase();
};

export const normalizedMediaDirPaths = (dirs: MediaDirectory[] = []): string[] =>
  Array.from(
    new Set(
      dirs
        .map((dir) => normalizeMediaDirPath(dir?.path ?? ""))
        .filter((p) => p.length > 0)
    )
  );

/** Trim paths, coerce read_only and drop empty / duplicate entries before save. */
export const sanitizeMediaDirs = (dirs: MediaDirectory[] = []): MediaDirectory[] => {
  const normalizedMediaDirs = dirs.map((dir) => ({
    path: (dir?.path ?? "").trim(),
    read_only: Boolean(dir?.read_only),
  }));
  const mediaDirMap = normalizedMediaDirs.reduce((acc, entry) => {
    if (!entry.path || acc.has(entry.path)) {
      return acc;
    }
    acc.set(entry.path, entry);
    return acc;
  }, new Map<string, MediaDirectory>());
  return Array.from(mediaDirMap.values());
};
