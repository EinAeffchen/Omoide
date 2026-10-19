import { apiFetch, Query } from "./api";
import { PageResponse } from "../stores/useListStore";

/** Endpoints of the maintenance review lists (each also has `/resolve`). */
export type ReviewEndpoint =
  | "/api/blur"
  | "/api/lowresolution"
  | "/api/noexifdate"
  | "/api/nopersons"
  | "/api/shortvideos"
  | "/api/untagged";

export type ReviewResolveAction =
  | "DELETE_FILES"
  | "DELETE_RECORDS"
  | "BLACKLIST_RECORDS";

/** List one page of a review category. `filters` use the backend's query
 * names and are sent unchanged to `/resolve`, so a bulk action applies to
 * exactly the filtered set. */
export const getReviewPage = <T>(
  endpoint: ReviewEndpoint,
  filters: Query,
  cursor: string | null,
  signal?: AbortSignal
) =>
  apiFetch<PageResponse<T>>(endpoint, {
    query: { ...filters, cursor, limit: 50 },
    signal,
    errorMessage: "Failed to load media",
  });

export const resolveReview = (
  endpoint: ReviewEndpoint,
  filters: Query,
  action: ReviewResolveAction,
  target: { mediaIds: number[] } | { selectAll: true }
) =>
  apiFetch<{ removed: number }>(`${endpoint}/resolve`, {
    method: "POST",
    body: {
      ...filters,
      action,
      ...("selectAll" in target
        ? { select_all: true }
        : { media_ids: target.mediaIds }),
    },
    errorMessage: "Failed to resolve media",
  });
