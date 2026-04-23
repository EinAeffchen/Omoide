import { API } from "../config";
import { NoExifDatePage } from "../types";

export type NoExifDateResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface NoExifDateQuery {
  cursor?: string | null;
  limit?: number;
  mediaType?: "image" | "video" | null;
}

export const getNoExifDateMedia = async (options: NoExifDateQuery = {}): Promise<NoExifDatePage> => {
  const params = new URLSearchParams();
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());
  if (options.mediaType) params.append("media_type", options.mediaType);

  const response = await fetch(`${API}/api/noexifdate?${params}`);
  if (!response.ok) throw new Error("Failed to fetch media without EXIF date");
  return response.json();
};

export const resolveNoExifDate = async (
  mediaIds: number[],
  action: NoExifDateResolveAction
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/noexifdate/resolve`, {
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
