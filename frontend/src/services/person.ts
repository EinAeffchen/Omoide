import {
  CursorPage,
  Media,
  Person,
  PersonReadSimple,
} from "../types";
import { apiFetch } from "./api";

export type PersonSort =
  | "appearances_desc"
  | "appearances_asc"
  | "name_asc"
  | "name_desc"
  | "views_desc"
  | "favorites"
  | "newest"
  | "oldest";

export const getPeople = async (
  cursor?: string,
  name?: string,
  sort?: PersonSort,
  signal?: AbortSignal
): Promise<{ items: PersonReadSimple[]; next_cursor: string | null }> => {
  const data = await apiFetch<CursorPage<PersonReadSimple>>("/api/person/", {
    query: { cursor, name: name?.trim(), sort },
    errorMessage: "Failed to fetch people",
    signal,
  });
  return { items: data.items, next_cursor: data.next_cursor };
};

export const getPerson = async (
  id: string,
  signal?: AbortSignal
): Promise<Person> =>
  apiFetch<Person>(`/api/person/${id}`, {
    errorMessage: "Failed to load person",
    signal,
  });

export const getPersonMediaAppearances = async (
  personId: number,
  cursor?: string,
  withPersonIds: number[] = [],
  tags: string[] = [],
  signal?: AbortSignal
): Promise<CursorPage<Media>> =>
  apiFetch<CursorPage<Media>>(`/api/person/${personId}/media-appearances`, {
    query: { cursor, with_person_ids: withPersonIds, tags },
    errorMessage: "Failed to fetch media appearances",
    signal,
  });
