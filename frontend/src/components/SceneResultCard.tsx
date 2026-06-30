import { Box, Card, CardActionArea, Typography } from "@mui/material";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useLocation, useNavigate } from "react-router-dom";

import { API } from "../config";
import { SceneSearchResult } from "../types";
import { encodeFilePath } from "../urlUtils";

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

interface SceneResultCardProps {
  scene: SceneSearchResult;
  listKey?: string;
}

export function SceneResultCard({ scene, listKey }: SceneResultCardProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const sceneThumb = scene.scene_thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(scene.scene_thumbnail_path)}`
    : scene.media_thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(scene.media_thumbnail_path)}`
    : `${API}/thumbnails/${scene.media_id}.jpg`;

  const handleClick = () => {
    navigate(`/medium/${scene.media_id}`, {
      state: {
        backgroundLocation: location.state?.backgroundLocation || location,
        mediaListKey: listKey,
        sceneStart: scene.start_time,
      },
    });
  };

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <CardActionArea onClick={handleClick} sx={{ position: "relative" }}>
        <Box
          component="img"
          src={sceneThumb}
          alt={`Scene from ${scene.media_filename}`}
          sx={{
            width: "100%",
            display: "block",
            objectFit: "cover",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            p: 1.5,
            color: (theme) => theme.palette.common.white,
            background: (theme) =>
              `linear-gradient(to top, ${theme.palette.mode === "dark" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.75)"} 0%, rgba(0,0,0,0) 60%)`,
          }}
        >
          <Typography variant="subtitle2" noWrap>
            {scene.media_filename}
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mt: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <PlayCircleOutlineIcon sx={{ fontSize: "1.1rem" }} />
              <Typography variant="caption">
                {formatTimestamp(scene.start_time)}
              </Typography>
            </Box>
            {scene.end_time != null && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: "1.1rem" }} />
                <Typography variant="caption">
                  {formatTimestamp(scene.end_time)}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}

export default SceneResultCard;
