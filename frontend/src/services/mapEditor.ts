import { CursorPage, MediaPreview } from "../types";
import { apiFetch } from "./api";

export const getMissingGeoMedia = async (
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<MediaPreview>> =>
  apiFetch<CursorPage<MediaPreview>>("/api/media/missing-geo", {
    query: { cursor },
    errorMessage: "Failed to fetch media without geolocation",
    signal,
  });

export const updateMediaGeolocation = async (
  mediaId: number,
  latitude: number,
  longitude: number
) =>
  apiFetch<void>(`/api/media/${mediaId}/geolocation`, {
    method: "PATCH",
    body: {
      latitude: latitude,
      longitude: longitude,
    },
    errorMessage: "Failed to update media geolocation",
  });
