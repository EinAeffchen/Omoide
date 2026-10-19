import {
  MissingBulkActionPayload,
  MissingConfirmResponse,
  MissingMediaPage,
  MissingResetResponse,
} from "../types";
import { apiFetch } from "./api";

export interface MissingQuery {
  cursor?: string | null;
  limit?: number;
  pathPrefix?: string;
  includeConfirmed?: boolean;
}

export const getMissingMedia = async (
  options: MissingQuery = {},
  signal?: AbortSignal
): Promise<MissingMediaPage> =>
  apiFetch<MissingMediaPage>("/api/missing/", {
    query: {
      cursor: options.cursor,
      limit: options.limit,
      path_prefix: options.pathPrefix,
      include_confirmed: options.includeConfirmed ? "true" : undefined,
    },
    errorMessage: "Failed to load missing media",
    signal,
  });

const postMissingAction = async <T>(
  endpoint: string,
  payload: MissingBulkActionPayload
): Promise<T> =>
  apiFetch<T>(`/api/missing/${endpoint}`, {
    method: "POST",
    body: payload,
    errorMessage: "Missing media action failed",
  });

export const confirmMissing = (payload: MissingBulkActionPayload) =>
  postMissingAction<MissingConfirmResponse>("confirm", payload);

export const resetMissingFlags = (payload: MissingBulkActionPayload) =>
  postMissingAction<MissingResetResponse>("reset", payload);
