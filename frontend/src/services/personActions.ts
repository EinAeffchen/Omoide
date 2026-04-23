import { API } from "../config";
import { Person, PersonRelationshipGraph } from "../types";

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

export const updatePerson = async (
  personId: number,
  data: { name?: string; profile_face_id?: number }
): Promise<Person> => {
  const res = await fetch(`${API}/api/person/${personId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update person");
  return res.json();
};

export const deletePerson = async (personId: number) => {
  const res = await fetch(`${API}/api/person/${personId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete person");
};

export const deletePersonsBulk = async (
  personIds: number[],
): Promise<DeletePersonsResult> => {
  const res = await fetch(`${API}/api/person/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_ids: personIds }),
  });
  if (!res.ok) throw new Error("Failed to delete selected people");
  return res.json();
};

export const mergePersons = async (sourceId: number, targetId: number) => {
  const res = await fetch(`${API}/api/person/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
  });
  if (!res.ok) throw new Error("Failed to merge persons");
};

export const mergeMultiplePersons = async (
  targetId: number,
  sourceIds: number[]
): Promise<MergeResult> => {
  const res = await fetch(`${API}/api/person/${targetId}/merge-multiple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_ids: sourceIds }),
  });
  if (!res.ok) throw new Error("Failed to merge selected persons");
  return res.json();
};

export const autoMergeSimilarPersons = async (
  personId: number
): Promise<MergeResult> => {
  const res = await fetch(`${API}/api/person/${personId}/merge-similar`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to auto-merge similar persons");
  return res.json();
};

export const searchPersonsByName = async (name: string): Promise<Person[]> => {
  const res = await fetch(
    `${API}/api/person/?name=${encodeURIComponent(name)}`
  );
  if (!res.ok) throw new Error("Failed to search persons");
  const data = await res.json();
  return data.items;
};

export const getSuggestedFaces = async (
  personId: number,
  limit: number = 100,
  signal?: AbortSignal
): Promise<any[]> => {
  const res = await fetch(
    `${API}/api/person/${personId}/suggest-faces?limit=${limit}`,
    { signal }
  );
  if (!res.ok) throw new Error("Failed to fetch suggested faces");
  return res.json();
};

export const getSimilarPersons = async (
  personId: number,
  signal?: AbortSignal
): Promise<any[]> => {
  const res = await fetch(`${API}/api/person/${personId}/similarities`, {
    signal,
  });
  if (!res.ok) throw new Error("Failed to fetch similar persons");
  return res.json();
};

export const getPersonRelationshipGraph = async (
  personId: number,
  depth: number,
  maxNodes = 100,
  signal?: AbortSignal
): Promise<PersonRelationshipGraph> => {
  const params = new URLSearchParams({
    depth: depth.toString(),
    max_nodes: maxNodes.toString(),
  });
  const res = await fetch(
    `${API}/api/person/${personId}/relationships?${params.toString()}`,
    { signal }
  );
  if (!res.ok) {
    throw new Error("Failed to fetch person relationship graph");
  }
  return res.json();
};

export const getPersonFaces = async (
  personId: number,
  cursor: string | null,
  limit: number
): Promise<any> => {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  if (cursor) {
    params.append("cursor", cursor);
  }
  const res = await fetch(
    `${API}/api/person/${personId}/faces?${params.toString()}`
  );
  if (!res.ok) throw new Error("Failed to fetch person faces");
  return res.json();
};

export const setProfileFace = async (faceId: number, personId: number) => {
  return updatePerson(personId, { profile_face_id: faceId });
};

export const autoSelectProfileFace = async (personId: number): Promise<Person> => {
  const res = await fetch(`${API}/api/person/${personId}/profile_face/auto`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error("Failed to auto-select profile image");
  }
  return res.json();
};

export const addMediaAppearanceToPerson = async (
  personId: number,
  mediaId: number
): Promise<AddMediaAppearanceResult> => {
  const res = await fetch(`${API}/api/person/${personId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });
  if (!res.ok) {
    throw new Error("Failed to add media appearance to person");
  }
  return res.json();
};
