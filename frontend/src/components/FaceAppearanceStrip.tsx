import React from "react";
import { Avatar, Box, Chip, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { Face } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

interface Props {
  faces: Face[];
  onSeekRequest: (time: number) => void;
}

/** Faces detected in a video, with the moment they appear — click to jump. */
export function FaceAppearanceStrip({ faces, onSeekRequest }: Props) {
  const timed = (faces ?? [])
    .filter((f) => typeof f.timestamp === "number")
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  if (timed.length === 0) return null;

  return (
    <Box mb={3}>
      <Typography variant="h6" gutterBottom>
        Appearances
      </Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {timed.map((face) => (
          <Chip
            key={face.id}
            clickable
            onClick={() => onSeekRequest(face.timestamp ?? 0)}
            avatar={
              face.thumbnail_path ? (
                <Avatar
                  src={`${API}/thumbnails/${encodeFilePath(
                    face.thumbnail_path
                  )}`}
                />
              ) : undefined
            }
            icon={face.thumbnail_path ? undefined : <PlayArrowIcon />}
            label={formatTime(face.timestamp ?? 0)}
            variant="outlined"
          />
        ))}
      </Box>
    </Box>
  );
}
