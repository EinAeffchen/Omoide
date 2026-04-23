import { API } from "../config";
import { BlurPage, Task } from "../types";

export type BlurResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface BlurQuery {
  threshold?: number;
  cursor?: string | null;
  limit?: number;
  mediaType?: "image" | "video" | null;
}

export const getBlurryMedia = async (options: BlurQuery = {}): Promise<BlurPage> => {
  const params = new URLSearchParams();
  if (options.threshold !== undefined) params.append("threshold", options.threshold.toString());
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());
  if (options.mediaType) params.append("media_type", options.mediaType);

  const response = await fetch(`${API}/api/blur?${params}`);
  if (!response.ok) throw new Error("Failed to fetch blurry media");
  return response.json();
};

export const resolveBlurry = async (
  mediaIds: number[],
  action: BlurResolveAction
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/blur/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_ids: mediaIds, action }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to resolve blurry media");
  }
  return response.json();
};

export const startBlurScoring = async (): Promise<Task> => {
  const response = await fetch(`${API}/api/tasks/compute_blur_scores`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to start blur scoring");
  return response.json();
};
