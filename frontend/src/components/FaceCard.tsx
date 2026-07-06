// components/FaceCard.tsx

import React from "react";
import {
  Avatar,
  Box,
  Card,
  IconButton,
  Tooltip,
  Checkbox,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useNavigate, useLocation } from "react-router-dom";
import StarIcon from "@mui/icons-material/Star";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { API } from "../config";
import { Face } from "../types";
import { encodeFilePath } from "../urlUtils";

interface FaceCardProps {
  face: Face;
  isProfile: boolean;
  onSetProfile?: (faceId: number) => void;
  selected?: boolean;
  onToggleSelect?: (faceId: number) => void;
}

function FaceCard({
  face,
  isProfile,
  onSetProfile,
  selected = false,
  onToggleSelect,
}: FaceCardProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const thumbUrl = `${API}/thumbnails/${encodeFilePath(face.thumbnail_path)}`;

  const handleCardClick = () => {
    navigate(`/medium/${face.media_id}`, {
      state: {
        backgroundLocation: location,
        ...(face.timestamp != null && {
          sceneStart: face.timestamp,
          autoplayVideo: true,
        }),
      },
    });
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(face.id);
  };

  return (
    <Card
      elevation={selected ? 8 : 2}
      sx={{
        width: 140,
        height: 140,
        bgcolor: "background.paper",
        position: "relative",
        transition: "box-shadow 0.2s ease-in-out",
        cursor: "pointer",
      }}
      onClick={handleCardClick}
    >
      <Avatar
        src={thumbUrl}
        variant="rounded"
        slotProps={{ img: { loading: "lazy" } }}
        sx={{
          width: "100%",
          height: "100%",
          border: isProfile
            ? `3px solid ${theme.palette.primary.main}`
            : "none",
        }}
      />

      <Checkbox
        checked={selected}
        onClick={handleCheckboxClick}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          color: (theme) => theme.palette.common.white,
          "&.Mui-checked": { color: (theme) => theme.palette.common.white },
          p: 0.5,
          backgroundColor: (theme) => alpha(theme.palette.common.black, 0.3),
          borderRadius: "20%",
        }}
      />
      <Box sx={{ position: "absolute", top: 4, right: 4 }}>
        {!isProfile && onSetProfile && (
          <Tooltip title="Set as profile">
            <IconButton
              size="small"
              sx={{
                bgcolor: (theme) => alpha(theme.palette.common.black, 0.4),
                "&:hover": {
                  bgcolor: (theme) => alpha(theme.palette.common.black, 0.6),
                },
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSetProfile(face.id);
              }}
            >
              <StarIcon fontSize="small" sx={{ color: "accent.main" }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {typeof face.similarity === "number" && (
        <Box
          sx={{
            position: "absolute",
            bottom: 4,
            left: 4,
            bgcolor: (theme) => alpha(theme.palette.common.black, 0.6),
            borderRadius: 1,
            px: 0.5,
            py: 0.25,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: (theme) => theme.palette.common.white, fontWeight: 600 }}
          >
            {`${face.similarity.toFixed(1)}%`}
          </Typography>
        </Box>
      )}
      {face.timestamp != null && (
        <Tooltip title={`Detected at ${Math.floor(face.timestamp / 60)}:${String(Math.floor(face.timestamp % 60)).padStart(2, "0")} — click to jump`}>
          <Box
            sx={{
              position: "absolute",
              bottom: 4,
              right: 4,
              bgcolor: (theme) => alpha(theme.palette.common.black, 0.6),
              borderRadius: "50%",
              p: 0.25,
              display: "flex",
            }}
          >
            <AccessTimeIcon sx={{ fontSize: 14, color: "common.white" }} />
          </Box>
        </Tooltip>
      )}
    </Card>
  );
}

export default React.memo(FaceCard);
