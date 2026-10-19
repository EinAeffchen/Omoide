import { Person } from "../types";
import { apiFetch } from "./api";

export const assignFace = async (faceIds: number[], personId: number) =>
  apiFetch<void>("/api/faces/assign", {
    method: "POST",
    body: { face_ids: faceIds, person_id: personId },
    errorMessage: "Assign failed",
  });

export const createPersonFromFaces = async (
  faceIds: number[],
  name?: string
): Promise<Person> => {
  // The backend returns the person directly; a `{ person }` wrapper is also
  // accepted (preserves the previous unwrapping behaviour).
  const json = await apiFetch<Person | { person?: Person | null }>(
    "/api/faces/create_person",
    {
      method: "POST",
      body: { face_ids: faceIds, name: name },
      errorMessage: "Create person failed",
    }
  );
  return (json as { person?: Person | null }).person ?? (json as Person);
};

export const deleteFace = async (faceIds: number[]) =>
  apiFetch<void>("/api/faces/", {
    method: "DELETE",
    query: { face_ids: faceIds },
    errorMessage: "Delete failed",
  });

export const detachFace = async (faceIds: number[]) =>
  apiFetch<void>("/api/faces/detach", {
    method: "POST",
    body: { face_ids: faceIds },
    errorMessage: "Detach failed",
  });
