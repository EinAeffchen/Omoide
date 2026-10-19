import { Tag } from "../types";
import { CursorPage } from "../types";
import { apiFetch } from "./api";

export const getTags = async (
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<Tag>> =>
  apiFetch<CursorPage<Tag>>("/api/tags/", {
    query: { cursor },
    errorMessage: "Failed to fetch tags",
    signal,
  });

export const getTag = async (
  id: string,
  signal?: AbortSignal
): Promise<Tag> =>
  apiFetch<Tag>(`/api/tags/${id}`, {
    errorMessage: "Failed to load tag",
    signal,
  });
