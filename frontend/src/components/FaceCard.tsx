// components/FaceCard.tsx

import React from "react";
import { Avatar, Box, Card, IconButton, Tooltip, Checkbox, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useNavigate, useLocation } from "react-router-dom";
import StarIcon from "@mui/icons-material/Star";
import { API } from "../config";
import { Face } from "../types";

interface FaceCardProps {
  face: Face;
  isProfile: boolean;
  onSetProfile?: (faceId: number) => void;
  selected?: boolean;
  onToggleSelect?: (faceId: number) => void;
}

export default function FaceCard({
  face,
  isProfile,
  onSetProfile,
  selected = false,
  onToggleSelect,
}: FaceCardProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const thumbUrl = `${API}/thumbnails/${face.thumbnail_path}`;

  const handleCardClick = () => {
    navigate(`/medium/${face.media_id}`, {
      state: { backgroundLocation: location },
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
    </Card>
  );
}
