import { Media } from "../types";
import { apiFetch } from "./api";

export const searchByImage = async (file: File): Promise<Media[]> => {
  const formData = new FormData();
  formData.append("file", file);

  // FormData is sent as-is (multipart, no JSON Content-Type).
  return apiFetch<Media[]>("/api/search/by-image", {
    method: "POST",
    body: formData,
    errorMessage: "Image search failed",
  });
};
