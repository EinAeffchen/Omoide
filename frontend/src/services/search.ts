import {
  CombinedMediaSearchResult,
  CursorPage,
  PersonReadSimple,
  SceneSearchResult,
  Tag,
} from "../types";
import { apiFetch } from "./api";

// Note: an empty `query` is omitted from the URL; the backend defaults it to
// "" so this is equivalent to sending it explicitly.

export const searchCombined = async (
  query: string,
  limit: number,
  cursor?: string,
  orderBy?: "relevance" | "date",
  signal?: AbortSignal
): Promise<CombinedMediaSearchResult> =>
  apiFetch<CombinedMediaSearchResult>("/api/search/combined", {
    query: {
      query,
      limit,
      cursor,
      order_by: orderBy && orderBy !== "relevance" ? orderBy : undefined,
    },
    errorMessage: "Failed to search media",
    signal,
  });

export const searchTags = async (
  query: string,
  limit: number,
  cursor?: string,
  signal?: AbortSignal
): Promise<CursorPage<Tag>> =>
  apiFetch<CursorPage<Tag>>("/api/search/tags", {
    query: { query, limit, cursor },
    errorMessage: "Failed to search tags",
    signal,
  });

export const searchPersons = async (
  query: string,
  limit: number,
  cursor?: string,
  signal?: AbortSignal
): Promise<CursorPage<PersonReadSimple>> =>
  apiFetch<CursorPage<PersonReadSimple>>("/api/search/person", {
    query: { query, limit, cursor },
    errorMessage: "Failed to search people",
    signal,
  });

export const searchScenes = async (
  query: string,
  limit: number,
  cursor?: string,
  signal?: AbortSignal
): Promise<CursorPage<SceneSearchResult>> =>
  apiFetch<CursorPage<SceneSearchResult>>("/api/search/scenes", {
    query: { query, limit, cursor },
    errorMessage: "Failed to search scenes",
    signal,
  });
