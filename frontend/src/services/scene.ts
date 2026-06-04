import { API } from "../config";
import { SceneRead } from "../types";

export const getScenes = async (mediaId: number): Promise<SceneRead[]> => {
  const response = await fetch(`${API}/api/media/${mediaId}/scenes`);
  if (!response.ok) throw new Error("Failed to fetch scenes");
  return response.json();
};

export const createScene = async (
  mediaId: number,
  data: { start_time: number; end_time: number; description?: string }
): Promise<SceneRead> => {
  const response = await fetch(`${API}/api/media/${mediaId}/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("Failed to create scene");
  return response.json();
};

export const deleteScene = async (
  mediaId: number,
  sceneId: number
): Promise<void> => {
  const response = await fetch(`${API}/api/media/${mediaId}/scenes/${sceneId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete scene");
};
