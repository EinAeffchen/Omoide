import { BrokenMediaPage, BrokenResolvePayload } from "../types";
import { apiFetch } from "./api";

export const getBrokenMedia = async (
  params: {
    cursor?: string | null;
    limit?: number;
  },
  signal?: AbortSignal
): Promise<BrokenMediaPage> =>
  apiFetch<BrokenMediaPage>("/api/broken", {
    query: { cursor: params.cursor, limit: params.limit || undefined },
    errorMessage: "Failed to load broken media",
    signal,
  });

export const resolveBroken = async (
  payload: BrokenResolvePayload
): Promise<{ removed: number }> =>
  apiFetch<{ removed: number }>("/api/broken/resolve", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to resolve broken media",
  });

export const retryBroken = async (payload: {
  media_ids?: number[];
  select_all?: boolean;
}): Promise<{
  retried: number;
  cleared: number;
  still_broken: number;
  remaining?: number;
}> =>
  apiFetch("/api/broken/retry", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to retry broken media",
  });
