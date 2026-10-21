import { AppConfig, ProfileListResponse, ProfileHealth } from "../types";
import { ApiError, apiFetch } from "./api";

// Share a single in-flight/settled promise so concurrent and repeat callers
// (e.g. per-navigation detail pages) reuse one request. It deliberately takes
// no AbortSignal: one caller aborting must not cancel the shared request.
let configPromise: Promise<AppConfig> | null = null;

export const getConfig = (): Promise<AppConfig> => {
  if (!configPromise) {
    configPromise = apiFetch<AppConfig>("/api/config/", {
      errorMessage: "Failed to fetch config",
    }).catch((error) => {
      // Do not cache failures; allow the next caller to retry.
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
};

const invalidateConfigCache = () => {
  configPromise = null;
};

export const saveConfig = async (
  config: AppConfig,
  acknowledgeMediaDirRemovals = false
): Promise<AppConfig> => {
  const saved = await apiFetch<AppConfig>("/api/config/", {
    method: "POST",
    body: {
      settings: config,
      acknowledge_media_dir_removals: acknowledgeMediaDirRemovals,
    },
    errorMessage: "Failed to save config",
  });
  invalidateConfigCache();
  return saved;
};

export const reloadConfig = async (): Promise<AppConfig> => {
  await apiFetch<void>("/api/config/reload", {
    method: "POST",
    errorMessage: "Failed to reload config",
  });

  // Fetch latest config from backend so we can sync frontend runtime flags
  invalidateConfigCache();
  const latest = await getConfig();

  // In production builds, config getters read from window.runtimeConfig.
  // Update these values so components referencing config.PRESENTATION_MODE (etc.)
  // see the new values without a full page refresh.
  if (!import.meta.env.DEV) {
    const ro = String(!!latest.general.presentation_mode);
    const people = String(!!latest.general.enable_people);
    const meme = String(!!latest.general.meme_mode);
    window.runtimeConfig = {
      ...(window.runtimeConfig ?? {}),
      VITE_API_PRESENTATION_MODE: ro,
      VITE_API_ENABLE_PEOPLE: people,
      VITE_API_MEME_MODE: meme,
      PERSON_RELATIONSHIP_MAX_NODES: String(
        latest.general.person_relationship_max_nodes ?? 100
      ),
      VIDEO_CONVERT_ON_THE_FLY: String(!!latest.video.convert_on_the_fly),
    } as RuntimeConfig;

    // Emit a lightweight event that components can listen to if they need
    // to react to config changes proactively (e.g., force a re-render).
    try {
      window.dispatchEvent(new Event("runtime-config-updated"));
    } catch {
      // no-op: dispatchEvent can fail in some test environments
    }
  }

  return latest;
};

export const pickDirectory = async (
  signal?: AbortSignal
): Promise<string | null> => {
  try {
    const data = await apiFetch<{ path?: string | null } | undefined>(
      "/api/config/pick-directory",
      { signal }
    );
    return (data?.path as string) || null;
  } catch (error) {
    // Return null so the caller can fall back to manual entry
    if (error instanceof ApiError) return null;
    throw error;
  }
};

export const listProfiles = async (
  signal?: AbortSignal
): Promise<ProfileListResponse> =>
  apiFetch<ProfileListResponse>("/api/config/profiles", {
    errorMessage: "Failed to list profiles",
    signal,
  });

export const switchProfile = async (path: string): Promise<void> =>
  apiFetch<void>("/api/config/profiles/switch", {
    method: "POST",
    body: { path },
    errorMessage: "Failed to switch profile",
  });

export const createProfile = async (
  path: string,
  name: string
): Promise<void> =>
  apiFetch<void>("/api/config/profiles/create", {
    method: "POST",
    body: { path, name },
    errorMessage: "Failed to create profile",
  });

export const removeProfile = async (path: string): Promise<void> =>
  apiFetch<void>("/api/config/profiles/remove", {
    method: "POST",
    body: { path },
    errorMessage: "Failed to remove profile",
  });

export const getProfileHealth = async (
  signal?: AbortSignal
): Promise<ProfileHealth> =>
  apiFetch<ProfileHealth>("/api/config/profile-health", {
    errorMessage: "Failed to fetch profile health",
    signal,
  });

export const addExistingProfile = async (
  path: string,
  name?: string
): Promise<void> =>
  apiFetch<void>("/api/config/profiles/add", {
    method: "POST",
    body: { path, name },
    errorMessage: "Failed to add profile",
  });
