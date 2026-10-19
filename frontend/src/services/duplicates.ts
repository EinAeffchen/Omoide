import { DuplicatePage, DuplicateStats } from "../types";
import { apiFetch } from "./api";

export const getDuplicates = async (
  cursor: string | null = null,
  sortBy: "count" | "size" = "count",
  mediaType?: "image" | "video",
  limit: number = 10,
  minCount: number = 2,
  signal?: AbortSignal
): Promise<DuplicatePage> =>
  apiFetch<DuplicatePage>("/api/duplicates", {
    query: {
      cursor,
      limit,
      sort_by: sortBy !== "count" ? sortBy : undefined,
      media_type: mediaType,
      min_count: minCount > 2 ? minCount : undefined,
    },
    errorMessage: "Failed to fetch duplicates",
    signal,
  });

export const getDuplicateStats = async (
  signal?: AbortSignal
): Promise<DuplicateStats> =>
  apiFetch<DuplicateStats>("/api/duplicates/stats", {
    errorMessage: "Failed to fetch duplicate statistics",
    signal,
  });

export type ResolveAction =
  | "DELETE_FILES"
  | "DELETE_RECORDS"
  | "BLACKLIST_RECORDS"
  | "MARK_NOT_DUPLICATE";

/** Response of `POST /api/duplicates/resolve`. */
export interface ResolveDuplicatesResult {
  message: string;
  skipped_read_only: number;
}

export const resolveDuplicates = async (
  groupId: number,
  action: ResolveAction,
  masterMediaId?: number
) => {
  const payload = {
    group_id: groupId,
    master_media_id: masterMediaId ?? null,
    action: action,
  };

  return apiFetch<ResolveDuplicatesResult>("/api/duplicates/resolve", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to resolve duplicate group.",
  });
};
