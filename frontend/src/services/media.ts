import { API } from "../config";
import {
  CursorPage,
  Media,
  MediaDetail,
  MediaFolderListing,
  MediaLocation,
} from "../types";
export const getMedia = async (
  id: string,
  signal?: AbortSignal
): Promise<MediaDetail> => {
  const response = await fetch(`${API}/api/media/${id}`, { signal });
  if (!response.ok) throw new Error(`Failed to load media (${response.status})`);
  return response.json();
};

export const getImages = async (
  cursor: string | null,
  sortOrder: "newest" | "latest"
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  params.append("sort", sortOrder);
  const response = await fetch(`${API}/api/media/images?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch images");
  return response.json();
};

export const getVideos = async (
  cursor: string | null,
  sortOrder: "newest" | "latest"
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  params.append("sort", sortOrder);
  const response = await fetch(`${API}/api/media/videos?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch videos");
  return response.json();
};

export const getMapMedia = async (): Promise<MediaLocation[]> => {
  const response = await fetch(`${API}/api/media/map`);
  if (!response.ok) throw new Error("Failed to fetch map media");
  return response.json();
};

export const getMediaLocations = async (
  north: number,
  south: number,
  east: number,
  west: number
): Promise<MediaLocation[]> => {
  const response = await fetch(
    `${API}/api/media/locations?north=${north}&south=${south}&east=${east}&west=${west}`
  );
  if (!response.ok) throw new Error("Failed to fetch media locations");
  return response.json();
};

export const getMediaList = async (
  cursor: string | null,
  sortOrder: "newest" | "latest",
  tags: string[],
  folder?: string | null,
  recursive = true
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  params.append("sort", sortOrder);
  if (cursor) {
    params.append("cursor", cursor);
  }
  tags.forEach((tag) => params.append("tags", tag));
  if (folder !== undefined && folder !== null) {
    params.append("folder", folder);
  }
  if (!recursive) {
    params.append("recursive", "false");
  }
  const response = await fetch(`${API}/api/media/?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to fetch media list");
  }
  return response.json();
};

export const getMediaFolders = async (
  parent?: string | null,
  previewLimit = 4
): Promise<MediaFolderListing> => {
  const params = new URLSearchParams();
  if (parent !== undefined && parent !== null) {
    params.append("parent", parent);
  }
  if (previewLimit !== 4) {
    params.append("preview_limit", String(previewLimit));
  }
  const response = await fetch(
    `${API}/api/media/folders?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch media folders");
  }
  return response.json();
};

export const getSimilarMedia = async (
  mediaId: number,
  signal?: AbortSignal
): Promise<Media[]> => {
  const response = await fetch(`${API}/api/media/${mediaId}/get-similar`, {
    signal,
  });
  if (!response.ok) throw new Error("Failed to load similar media");
  return response.json();
};
