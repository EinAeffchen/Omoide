const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

if (!API_BASE_URL && import.meta.env.DEV) {
  console.warn(
    "Warning: VITE_API_BASE_URL is not set in your .env file. API calls might fail."
  );
}

const getBooleanEnv = (envVar: string | undefined): boolean => {
  return envVar?.toLowerCase() === "true";
};

const getBooleanEnvDefaultTrue = (envVar: string | undefined): boolean => {
  return envVar?.toLowerCase() !== "false";
};

export const API = API_BASE_URL;

const config = {
  /**
   * Checks if the application is in read-only mode.
   * Accesses the correct source based on the environment (dev vs. prod).
   */
  get PRESENTATION_MODE(): boolean {
    if (import.meta.env.DEV) {
      return getBooleanEnv(import.meta.env.VITE_API_PRESENTATION_MODE);
    }
    return getBooleanEnv(window.runtimeConfig?.VITE_API_PRESENTATION_MODE);
  },

  /**
   * Checks if the people/faces feature is enabled.
   * Accesses the correct source based on the environment (dev vs. prod).
   */
  get ENABLE_PEOPLE(): boolean {
    if (import.meta.env.DEV) {
      return getBooleanEnv(import.meta.env.VITE_API_ENABLE_PEOPLE);
    }
    return getBooleanEnv(window.runtimeConfig?.VITE_API_ENABLE_PEOPLE);
  },

  /**
   * When enabled, replace GIF thumbnails with originals so they animate in grids.
   */
  get MEME_MODE(): boolean {
    if (import.meta.env.DEV) {
      return getBooleanEnv(import.meta.env.VITE_API_MEME_MODE);
    }
    return getBooleanEnv(window.runtimeConfig?.VITE_API_MEME_MODE);
  },
  get PERSON_RELATIONSHIP_MAX_NODES(): number {
    if (import.meta.env.DEV) {
      const raw = import.meta.env.VITE_PERSON_RELATIONSHIP_MAX_NODES;
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    }
    const raw = window.runtimeConfig?.PERSON_RELATIONSHIP_MAX_NODES;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  },
  get GROUP_FACES_BY_VIDEO(): boolean {
    if (import.meta.env.DEV) {
      return getBooleanEnvDefaultTrue(import.meta.env.VITE_GROUP_FACES_BY_VIDEO);
    }
    return getBooleanEnvDefaultTrue(window.runtimeConfig?.VITE_GROUP_FACES_BY_VIDEO);
  },

  get APP_VERSION(): string {
    if (import.meta.env.DEV) {
      return import.meta.env.VITE_APP_VERSION ?? "dev";
    }
    return window.runtimeConfig?.APP_VERSION ?? "dev";
  },
};

if (import.meta.env.DEV) {
  console.log("[App Config] API Base URL:", API);
  console.log("[App Config] Read-Only Mode:", config.PRESENTATION_MODE);
  console.log("[App Config] People tracking enabled:", config.ENABLE_PEOPLE);
  console.log("[App Config] Meme mode:", config.MEME_MODE);
  console.log("[App Config] Group faces by video:", config.GROUP_FACES_BY_VIDEO);
}
export default config;
