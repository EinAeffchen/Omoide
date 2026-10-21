import { VideoConversionMode, Media, Task } from "../types";
import { apiFetch } from "./api";

/** Convert one video. The caller must pick whether the original is kept. */
export const convertMedia = async (
  mediaId: number,
  mode: Exclude<VideoConversionMode, "off">
): Promise<Task> =>
  apiFetch<Task>(`/api/media/${mediaId}/converter`, {
    method: "POST",
    body: { mode },
    errorMessage: "Failed to start conversion",
  });

export const deleteMediaRecord = async (mediaId: number) =>
  apiFetch<void>(`/api/media/${mediaId}`, {
    method: "DELETE",
    errorMessage: "Failed to delete media record",
  });

export const deleteMediaFile = async (mediaId: number) =>
  apiFetch<void>(`/api/media/${mediaId}/file`, {
    method: "DELETE",
    errorMessage: "Failed to delete media file",
  });

export const openMediaFolder = async (mediaId: number): Promise<void> =>
  apiFetch<void>(`/api/media/${mediaId}/open-folder`, {
    method: "POST",
    errorMessage: "Failed to open folder",
  });

export const openMediaFile = async (mediaId: number): Promise<void> =>
  apiFetch<void>(`/api/media/${mediaId}/open-file`, {
    method: "POST",
    errorMessage: "Failed to open file",
  });

export const setMediaFavorite = async (
  mediaId: number,
  isFavorite: boolean
): Promise<Media> =>
  apiFetch<Media>(`/api/media/${mediaId}/favorite`, {
    method: "PATCH",
    body: { is_favorite: isFavorite },
    errorMessage: "Failed to update favorite",
  });
