import { API } from "../config";
import { Person } from "../types";

export const assignFace = async (faceIds: number[], personId: number) => {
  const res = await fetch(`${API}/api/faces/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ face_ids: faceIds, person_id: personId }),
  });
  if (!res.ok) throw new Error(`Assign failed: ${res.status}`);
};

export const createPersonFromFaces = async (
  faceIds: number[],
  name?: string
): Promise<Person> => {
  const res = await fetch(`${API}/api/faces/create_person`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ face_ids: faceIds, name: name }),
  });
  if (!res.ok) throw new Error(`Create person failed: ${res.status}`);
  const json = await res.json();
  return (json as any).person ?? (json as any);
};

export const deleteFace = async (faceIds: number[]) => {
  const params = new URLSearchParams();
  faceIds.forEach((id) => params.append("face_ids", id.toString()));
  const res = await fetch(`${API}/api/faces/?${params.toString()}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
};

export const detachFace = async (faceIds: number[]) => {
  const res = await fetch(`${API}/api/faces/detach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ face_ids: faceIds }),
  });
  if (!res.ok) throw new Error(`Detach failed: ${res.status}`);
};
