import { API } from "../config";
import { LowResPage } from "../types";

export type LowResResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface LowResQuery {
  maxPixels?: number;
  cursor?: string | null;
  limit?: number;
  mediaType?: "image" | "video" | null;
}

export const getLowResMedia = async (options: LowResQuery = {}): Promise<LowResPage> => {
  const params = new URLSearchParams();
  if (options.maxPixels !== undefined) params.append("max_pixels", options.maxPixels.toString());
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());
  if (options.mediaType) params.append("media_type", options.mediaType);

  const response = await fetch(`${API}/api/lowresolution?${params}`);
  if (!response.ok) throw new Error("Failed to fetch low-resolution media");
  return response.json();
};

export interface LowResResolvePayload {
  action: LowResResolveAction;
  media_ids?: number[];
  select_all?: boolean;
  max_pixels?: number;
  media_type?: "image" | "video";
}

export const resolveLowRes = async (
  payload: LowResResolvePayload
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/lowresolution/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to resolve media");
  }
  return response.json();
};
