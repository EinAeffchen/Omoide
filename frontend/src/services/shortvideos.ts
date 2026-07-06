import { API } from "../config";
import { ShortVideoPage } from "../types";

export type ShortVideoResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface ShortVideoQuery {
  maxDuration?: number;
  cursor?: string | null;
  limit?: number;
}

export const getShortVideos = async (options: ShortVideoQuery = {}): Promise<ShortVideoPage> => {
  const params = new URLSearchParams();
  if (options.maxDuration !== undefined) params.append("max_duration", options.maxDuration.toString());
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());

  const response = await fetch(`${API}/api/shortvideos?${params}`);
  if (!response.ok) throw new Error("Failed to fetch short videos");
  return response.json();
};

export interface ShortVideoResolvePayload {
  action: ShortVideoResolveAction;
  media_ids?: number[];
  select_all?: boolean;
  max_duration?: number;
}

export const resolveShortVideos = async (
  payload: ShortVideoResolvePayload
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/shortvideos/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to resolve short videos");
  }
  return response.json();
};
