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
  if (!response.ok) throw new Error("Failed to search media");
  return response.json();
};

export const searchTags = async (
  query: string,
  limit: number,
  cursor?: string
): Promise<CursorPage<Tag>> => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${API}/api/search/tags?${params}`);
  if (!response.ok) throw new Error("Failed to search tags");
  return response.json();
};

export const searchScenes = async (
  query: string,
  limit: number,
  cursor?: string
): Promise<CursorPage<SceneSearchResult>> => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${API}/api/search/scenes?${params}`);
  if (!response.ok) throw new Error("Failed to search scenes");
  return response.json();
};
