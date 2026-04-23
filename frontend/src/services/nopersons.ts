import { API } from "../config";
import { NoPersonsPage } from "../types";

export type NoPersonsResolveAction = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export interface NoPersonsQuery {
  cursor?: string | null;
  limit?: number;
  mediaType?: "image" | "video" | null;
  scope?: "processed" | "all";
}

export const getNoPersonsMedia = async (options: NoPersonsQuery = {}): Promise<NoPersonsPage> => {
  const params = new URLSearchParams();
  if (options.cursor) params.append("cursor", options.cursor);
  if (options.limit !== undefined) params.append("limit", options.limit.toString());
  if (options.mediaType) params.append("media_type", options.mediaType);
  if (options.scope) params.append("scope", options.scope);

  const response = await fetch(`${API}/api/nopersons?${params}`);
  if (!response.ok) throw new Error("Failed to fetch media without persons");
  return response.json();
};

export const resolveNoPersons = async (
  mediaIds: number[],
  action: NoPersonsResolveAction
): Promise<{ removed: number }> => {
  const response = await fetch(`${API}/api/nopersons/resolve`, {
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
