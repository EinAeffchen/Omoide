import { API } from "../config";
import { Tag } from "../types";
import { CursorPage } from "../types";

export const getTags = async (
  cursor: string | null
): Promise<CursorPage<Tag>> => {
  const params = new URLSearchParams();
  if (cursor) {
    params.append("cursor", cursor);
  }
  const response = await fetch(`${API}/api/tags/?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch tags");
  return response.json();
};

export const getTag = async (id: string): Promise<Tag> => {
  const response = await fetch(`${API}/api/tags/${id}`);
  if (!response.ok) throw new Error(`Failed to load tag (${response.status})`);
  return response.json();
};
