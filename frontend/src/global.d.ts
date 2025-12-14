interface RuntimeConfig {
  VITE_API_PRESENTATION_MODE: string;
  VITE_API_ENABLE_PEOPLE: string;
  VITE_API_MEME_MODE: string;
  PERSON_RELATIONSHIP_MAX_NODES?: string;
  APP_VERSION: string;
}

interface Window {
  runtimeConfig?: RuntimeConfig;
}
