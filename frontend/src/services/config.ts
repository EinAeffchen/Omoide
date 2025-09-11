import { API } from "../config";
import { AppConfig, ProfileListResponse, ProfileHealth } from "../types";

export const getConfig = async (): Promise<AppConfig> => {
  const response = await fetch(`${API}/api/config/`);
  console.log(response)
  if (!response.ok) {
    throw new Error("Failed to fetch config");
  }
  return response.json();
};

export const saveConfig = async (config: AppConfig): Promise<AppConfig> => {
  const response = await fetch(`${API}/api/config/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error("Failed to save config");
  }
  return response.json();
};

export const reloadConfig = async (): Promise<AppConfig> => {
  const response = await fetch(`${API}/api/config/reload`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to reload config");
  }

  // Fetch latest config from backend so we can sync frontend runtime flags
  const latest = await getConfig();

  // In production builds, config getters read from window.runtimeConfig.
  // Update these values so components referencing config.READ_ONLY (etc.)
  // see the new values without a full page refresh.
  if (!import.meta.env.DEV) {
    const ro = String(!!latest.general.read_only);
    const people = String(!!latest.general.enable_people);
    window.runtimeConfig = {
      ...(window.runtimeConfig ?? {}),
      VITE_API_READ_ONLY: ro,
      VITE_API_ENABLE_PEOPLE: people,
    } as any;

    // Emit a lightweight event that components can listen to if they need
    // to react to config changes proactively (e.g., force a re-render).
    try {
      window.dispatchEvent(new Event("runtime-config-updated"));
    } catch (_) {
      // no-op: dispatchEvent can fail in some test environments
    }
  }

  return latest;
};

export const pickDirectory = async (): Promise<string | null> => {
  const response = await fetch(`${API}/api/config/pick-directory`);
  if (!response.ok) {
    // Return null so the caller can fall back to manual entry
    return null;
  }
  const data = await response.json();
  return (data?.path as string) || null;
};

export const listProfiles = async (): Promise<ProfileListResponse> => {
  const res = await fetch(`${API}/api/config/profiles`);
  if (!res.ok) {
    throw new Error("Failed to list profiles");
  }
  return res.json();
};

export const switchProfile = async (path: string): Promise<void> => {
  const res = await fetch(`${API}/api/config/profiles/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to switch profile");
  }
};

export const createProfile = async (
  path: string,
  name: string
): Promise<void> => {
  const res = await fetch(`${API}/api/config/profiles/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create profile");
  }
};

export const removeProfile = async (path: string): Promise<void> => {
  const res = await fetch(`${API}/api/config/profiles/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to remove profile");
  }
};

export const moveData = async (destPath: string): Promise<void> => {
  const res = await fetch(`${API}/api/config/move-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dest_path: destPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to move data directory");
  }
};

export const getProfileHealth = async (): Promise<ProfileHealth> => {
  const res = await fetch(`${API}/api/config/profile-health`);
  if (!res.ok) throw new Error("Failed to fetch profile health");
  return res.json();
};

export const addExistingProfile = async (
  path: string,
  name?: string
): Promise<void> => {
  const res = await fetch(`${API}/api/config/profiles/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to add profile");
  }
};
