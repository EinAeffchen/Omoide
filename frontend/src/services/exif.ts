import { ExifData } from "../types";
import { apiFetch } from "./api";

export const getExifData = async (
  mediaId: number,
  signal?: AbortSignal
): Promise<ExifData | null> =>
  apiFetch<ExifData | null>(`/api/media/${mediaId}/processors/exif`, {
    errorMessage: "Failed to fetch EXIF data",
    signal,
  });
