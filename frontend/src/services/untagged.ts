import { API } from "../config";
import { UntaggedPage } from "../types";

export type UntaggedResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface UntaggedQuery {
  cursor?: string | null;
  limit?: number;
  mediaType?: "image" | "video" | null;
}

export const getUntaggedMedia = async (options: UntaggedQuery = {}): Promise<UntaggedPage> => {
  const params = new URLSearchParams();
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());
  if (options.mediaType) params.append("media_type", options.mediaType);

  const response = await fetch(`${API}/api/untagged?${params}`);
  if (!response.ok) throw new Error("Failed to fetch untagged media");
  return response.json();
};

export const resolveUntagged = async (
  mediaIds: number[],
  action: UntaggedResolveAction
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/untagged/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_ids: mediaIds, action }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to resolve media");
  }
  return response.json();
};
