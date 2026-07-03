import { API } from "../config";
import {
  CursorPage,
  Media,
  Person,
  PersonReadSimple,
  SimilarPersonWithDetails,
} from "../types";

export const getPeople = async (
  cursor?: string
): Promise<{ items: PersonReadSimple[]; next_cursor: string | null }> => {
  const params = new URLSearchParams();
  if (cursor) {
    params.append("cursor", cursor);
  }
  const response = await fetch(`${API}/api/person/?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to fetch people");
  const data = await response.json();
  return { items: data.items, next_cursor: data.next_cursor };
};

export const getPerson = async (
  id: string,
  signal?: AbortSignal
): Promise<Person> => {
  const response = await fetch(`${API}/api/person/${id}`, { signal });
  if (!response.ok) throw new Error(`Failed to load person (${response.status})`);
  return response.json();
};

export const getSimilarPeople = async (
  id: string
): Promise<SimilarPersonWithDetails[]> => {
  const response = await fetch(`${API}/api/person/similar/${id}`);
  if (!response.ok) throw new Error("Failed to fetch similar people");
  return response.json();
};

export const getPersonMediaAppearances = async (
  personId: number,
  cursor?: string,
  withPersonIds: number[] = [],
  tags: string[] = []
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  withPersonIds.forEach((id) =>
    params.append("with_person_ids", id.toString())
  );
  tags.forEach((tag) => params.append("tags", tag));
  const response = await fetch(
    `${API}/api/person/${personId}/media-appearances?${params.toString()}`
  );
  if (!response.ok) throw new Error("Failed to fetch media appearances");
  return response.json();
};
