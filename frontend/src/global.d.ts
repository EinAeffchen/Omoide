interface RuntimeConfig {
  VITE_API_PRESENTATION_MODE: string;
  VITE_API_ENABLE_PEOPLE: string;
  VITE_API_MEME_MODE: string;
  VITE_API_EVENTS_ENABLED?: string;
  VITE_GROUP_FACES_BY_VIDEO?: string;
  VIDEO_CONVERT_ON_THE_FLY?: string;
  PERSON_RELATIONSHIP_MAX_NODES?: string;
  APP_VERSION: string;
}

interface Window {
  runtimeConfig?: RuntimeConfig;
}

// Untyped react-player internals used by localFilePlayer.ts. The resulting
// component has the same API as the `react-player/file` build.
declare module "react-player/lib/ReactPlayer" {
  export function createReactPlayer(
    players: unknown[],
    fallback?: unknown
  ): typeof import("react-player/file").default;
}
declare module "react-player/lib/players/FilePlayer" {
  const FilePlayer: unknown;
  export default FilePlayer;
}
