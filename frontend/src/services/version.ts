import { VersionUpdateInfo } from "../types";
import { apiFetch } from "./api";

export const getVersionUpdateInfo = async (
  signal?: AbortSignal
): Promise<VersionUpdateInfo> =>
  apiFetch<VersionUpdateInfo>("/api/version/update", {
    errorMessage: "Failed to fetch update information",
    signal,
  });
