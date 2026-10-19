import {
  CursorPage,
  FaceRead,
  Person,
  PersonRelationshipGraph,
  SimilarPersonWithDetails,
  Task,
} from "../types";
import { apiFetch } from "./api";

export interface MergeResult {
  merged_ids: number[];
  skipped_ids: number[];
}

export interface DeletePersonsResult {
  deleted_ids: number[];
  skipped_ids: number[];
}

export interface AddMediaAppearanceResult {
  person_id: number;
  media_id: number;
  added: boolean;
}

/** Starts a background task; poll it via getTask for the outcome. */
export const exportPersonMedia = async (
  personId: number,
  destinationPath: string,
  mode: "copy" | "move"
): Promise<Task> =>
  apiFetch<Task>(`/api/person/${personId}/export-media`, {
    method: "POST",
    body: { destination_path: destinationPath, mode },
    errorMessage: `Failed to ${mode} media`,
  });

export const updatePerson = async (
  personId: number,
  data: { name?: string; profile_face_id?: number }
): Promise<Person> =>
  apiFetch<Person>(`/api/person/${personId}`, {
    method: "PATCH",
    body: data,
    errorMessage: "Failed to update person",
  });

export const setPersonFavorite = async (
  personId: number,
  isFavorite: boolean
): Promise<void> =>
  apiFetch<void>(`/api/person/${personId}/favorite`, {
    method: "PATCH",
    body: { is_favorite: isFavorite },
    errorMessage: "Failed to update favorite",
  });

export const deletePerson = async (personId: number) =>
  apiFetch<void>(`/api/person/${personId}`, {
    method: "DELETE",
    errorMessage: "Failed to delete person",
  });

export const deletePersonsBulk = async (
  personIds: number[],
): Promise<DeletePersonsResult> =>
  apiFetch<DeletePersonsResult>("/api/person/bulk-delete", {
    method: "POST",
    body: { person_ids: personIds },
    errorMessage: "Failed to delete selected people",
  });

export const mergePersons = async (sourceId: number, targetId: number) =>
  apiFetch<void>("/api/person/merge", {
    method: "POST",
    body: { source_id: sourceId, target_id: targetId },
    errorMessage: "Failed to merge persons",
  });

export const mergeMultiplePersons = async (
  targetId: number,
  sourceIds: number[]
): Promise<MergeResult> =>
  apiFetch<MergeResult>(`/api/person/${targetId}/merge-multiple`, {
    method: "POST",
    body: { source_ids: sourceIds },
    errorMessage: "Failed to merge selected persons",
  });

export const autoMergeSimilarPersons = async (
  personId: number
): Promise<MergeResult> =>
  apiFetch<MergeResult>(`/api/person/${personId}/merge-similar`, {
    method: "POST",
    errorMessage: "Failed to auto-merge similar persons",
  });

export const searchPersonsByName = async (
  name: string,
  signal?: AbortSignal
): Promise<Person[]> => {
  const data = await apiFetch<{ items: Person[] }>("/api/person/", {
    query: { name },
    errorMessage: "Failed to search persons",
    signal,
  });
  return data.items;
};

export const getSuggestedFaces = async (
  personId: number,
  limit: number = 100,
  signal?: AbortSignal
): Promise<FaceRead[]> =>
  apiFetch<FaceRead[]>(`/api/person/${personId}/suggest-faces`, {
    query: { limit },
    errorMessage: "Failed to fetch suggested faces",
    signal,
  });

export const getSimilarPersons = async (
  personId: number,
  signal?: AbortSignal
): Promise<SimilarPersonWithDetails[]> =>
  apiFetch<SimilarPersonWithDetails[]>(`/api/person/${personId}/similarities`, {
    errorMessage: "Failed to fetch similar persons",
    signal,
  });

export const getPersonRelationshipGraph = async (
  personId: number,
  depth: number,
  maxNodes = 100,
  signal?: AbortSignal
): Promise<PersonRelationshipGraph> =>
  apiFetch<PersonRelationshipGraph>(
    `/api/person/${personId}/relationships`,
    {
      query: { depth, max_nodes: maxNodes },
      errorMessage: "Failed to fetch person relationship graph",
      signal,
    }
  );

export const getPersonFaces = async (
  personId: number,
  cursor: string | null,
  limit: number,
  sortBy: string = "id_desc",
  mediaId?: number,
  signal?: AbortSignal
): Promise<CursorPage<FaceRead>> =>
  apiFetch<CursorPage<FaceRead>>(`/api/person/${personId}/faces`, {
    query: { limit, sort_by: sortBy, cursor, media_id: mediaId },
    errorMessage: "Failed to fetch person faces",
    signal,
  });

export const detachMediaFromPerson = async (
  personId: number,
  mediaId: number
): Promise<void> =>
  apiFetch<void>(`/api/person/${personId}/media/${mediaId}/detach`, {
    method: "POST",
    errorMessage: "Failed to detach media from person",
  });

export const setProfileFace = async (faceId: number, personId: number) => {
  return updatePerson(personId, { profile_face_id: faceId });
};

export const autoSelectProfileFace = async (personId: number): Promise<Person> =>
  apiFetch<Person>(`/api/person/${personId}/profile_face/auto`, {
    method: "POST",
    errorMessage: "Failed to auto-select profile image",
  });

export const addMediaAppearanceToPerson = async (
  personId: number,
  mediaId: number
): Promise<AddMediaAppearanceResult> =>
  apiFetch<AddMediaAppearanceResult>(`/api/person/${personId}/media`, {
    method: "POST",
    body: { media_id: mediaId },
    errorMessage: "Failed to add media appearance to person",
  });
