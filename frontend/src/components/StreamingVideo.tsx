import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import { API } from "../config";
import { Media } from "../types";

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

interface StreamingVideoProps {
  media: Media;
  /** Position (seconds) to start converting from. */
  startAt?: number;
  /** External seek requests, e.g. clicking a scene. */
  seekRequest?: { time: number; seq: number } | null;
  initialVolume: number;
  onVolumeChange: (volume: number) => void;
  onProgress?: (playedSeconds: number) => void;
}

/**
 * Plays a video the browser cannot decode by having the server convert it on
 * the fly. The converted stream has no seekable timeline, so this player
 * keeps its own: the slider covers the known duration, and seeking starts a
 * new stream at the chosen position (which takes a moment).
 */
export function StreamingVideo({
  media,
  startAt = 0,
  seekRequest,
  initialVolume,
  onVolumeChange,
  onProgress,
}: StreamingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const duration = media.duration ?? 0;
  const [offset, setOffset] = useState(startAt);
  const [position, setPosition] = useState(startAt);
  const [dragging, setDragging] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(initialVolume);
  const [muted, setMuted] = useState(false);

  const src = `${API}/api/media/${media.id}/stream?start=${offset.toFixed(2)}`;

  const seek = useCallback(
    (time: number) => {
      const target = Math.min(Math.max(0, time), Math.max(0, duration - 0.5));
      setOffset(target);
      setPosition(target);
      setBuffering(true);
      setPlaying(true);
    },
    [duration]
  );

  const seenSeek = useRef(seekRequest?.seq);
  useEffect(() => {
    if (!seekRequest || seekRequest.seq === seenSeek.current) return;
    seenSeek.current = seekRequest.seq;
    seek(seekRequest.time);
  }, [seekRequest, seek]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.volume = volume;
  }, [volume]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const shown = dragging ?? position;

  return (
    <Box
      ref={containerRef}
      sx={{ width: "100%", position: "relative", bgcolor: "common.black" }}
    >
      <Box sx={{ position: "relative", paddingTop: "56.25%" }}>
        <video
          key={src}
          ref={videoRef}
          src={src}
          autoPlay={playing}
          muted={muted}
          playsInline
          onClick={togglePlay}
          onPlaying={() => {
            setBuffering(false);
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onTimeUpdate={(e) => {
            const now = offset + e.currentTarget.currentTime;
            setPosition(now);
            onProgress?.(now);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
        {buffering && (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={1}
            sx={{ position: "absolute", inset: 0, color: "common.white", pointerEvents: "none" }}
          >
            <CircularProgress color="inherit" />
            <Typography variant="body2">Converting…</Typography>
          </Stack>
        )}
      </Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, color: "common.white" }}>
        <IconButton aria-label={playing ? "Pause" : "Play"} onClick={togglePlay} sx={{ color: "inherit" }}>
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Typography variant="caption" sx={{ minWidth: 88 }}>
          {formatTime(shown)} / {formatTime(duration)}
        </Typography>
        <Slider
          aria-label="Position"
          size="small"
          min={0}
          max={Math.max(duration, 1)}
          step={0.5}
          value={shown}
          onChange={(_, value) => setDragging(value as number)}
          onChangeCommitted={(_, value) => {
            setDragging(null);
            seek(value as number);
          }}
          valueLabelDisplay="auto"
          valueLabelFormat={formatTime}
          sx={{ color: "common.white", flex: 1 }}
        />
        <IconButton
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => setMuted((m) => !m)}
          sx={{ color: "inherit" }}
        >
          {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
        </IconButton>
        <Slider
          aria-label="Volume"
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(_, value) => {
            setMuted(false);
            setVolume(value as number);
            onVolumeChange(value as number);
          }}
          sx={{ color: "common.white", width: 80 }}
        />
        <IconButton
          aria-label="Fullscreen"
          onClick={() => void containerRef.current?.requestFullscreen?.()}
          sx={{ color: "inherit" }}
        >
          <FullscreenIcon />
        </IconButton>
      </Stack>
      <Tooltip title="Your browser cannot play this video's format, so it is converted while it plays.">
        <Typography variant="caption" sx={{ display: "block", px: 2, pb: 1, color: "grey.500" }}>
          Converted on the fly — jumping to another position restarts the conversion.
        </Typography>
      </Tooltip>
    </Box>
  );
}
