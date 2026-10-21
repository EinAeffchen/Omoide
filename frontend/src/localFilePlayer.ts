// A ReactPlayer that only ships the local-file player.
//
// `react-player/file` is that player too, but it accepts only URLs whose
// extension it recognises (mp4/mov/webm/ogg/m4v) and renders nothing for
// anything else (.mkv, .avi, .ts, ...). The full build falls back to the file
// player for unknown URLs; we rebuild that fallback here without pulling in
// the YouTube/Vimeo/... players. Omoide only ever plays its own files, so
// every URL goes to the file player and the browser decides what it can play.
import { createReactPlayer } from "react-player/lib/ReactPlayer";
import FilePlayer from "react-player/lib/players/FilePlayer";

const filePlayer = {
  key: "file",
  canPlay: () => true,
  lazyPlayer: FilePlayer,
};

const LocalFilePlayer = createReactPlayer([filePlayer], filePlayer);

export default LocalFilePlayer;
