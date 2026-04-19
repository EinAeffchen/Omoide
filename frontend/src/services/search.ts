import { API } from "../config";
import {
  CombinedMediaSearchResult,
  CursorPage,
  SceneSearchResult,
  Tag,
} from "../types";

export const searchCombined = async (
  query: string,
  limit: number,
  cursor?: string,
  orderBy?: "relevance" | "date"
): Promise<CombinedMediaSearchResult> => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (orderBy && orderBy !== "relevance") params.set("order_by", orderBy);
  const response = await fetch(`${API}/api/search/combined?${params}`);
  return response.json();
};

export const searchTags = async (
  query: string,
  limit: number,
  cursor?: string
): Promise<CursorPage<Tag>> => {
  const response = await fetch(
    `${API}/api/search/tags?query=${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`
  );
  return response.json();
};

export const searchScenes = async (
  query: string,
  limit: number,
  cursor?: string
): Promise<CursorPage<SceneSearchResult>> => {
  const response = await fetch(
    `${API}/api/search/scenes?query=${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`
  );
  return response.json();
};
