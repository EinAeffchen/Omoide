import React from "react";
import { Box, Checkbox, Chip, Typography } from "@mui/material";
import { Link, useLocation } from "react-router-dom";

import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

export interface SelectableMediaTileProps {
  id: number;
  filename: string;
  thumbnailPath: string | null;
  caption: string;
  selected: boolean;
  badgeLabel?: string;
  badgeColor?: "default" | "primary" | "warning" | "error";
  onToggle: (id: number) => void;
}

const SelectableMediaTile: React.FC<SelectableMediaTileProps> = ({
  id,
  filename,
  thumbnailPath,
  caption,
  selected,
  badgeLabel,
  badgeColor = "default",
  onToggle,
}) => {
  const location = useLocation();
  const thumbUrl = `${API}/thumbnails/${thumbnailPath ? encodeFilePath(thumbnailPath) : `${id}.jpg`}`;

  return (
    <Box
      onClick={() => onToggle(id)}
      sx={{
        position: "relative",
        cursor: "pointer",
        borderRadius: 1,
        overflow: "hidden",
        border: selected ? "2px solid" : "2px solid transparent",
        borderColor: selected ? "primary.main" : "transparent",
        bgcolor: "action.hover",
        "&:hover": { borderColor: "primary.light" },
      }}
    >
      <Box
        component={Link}
        to={`/medium/${id}`}
        state={{ backgroundLocation: location }}
        onClick={(e) => e.stopPropagation()}
        sx={{ display: "block", lineHeight: 0 }}
      >
        <Box
          component="img"
          src={thumbUrl}
          alt={filename}
          loading="lazy"
          sx={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
          onError={(e) => { e.currentTarget.style.opacity = "0.3"; }}
        />
      </Box>
      <Box sx={{ position: "absolute", top: 4, left: 4 }}>
        <Checkbox
          checked={selected}
          size="small"
          sx={{
            p: 0.25,
            bgcolor: "rgba(0,0,0,0.4)",
            borderRadius: 1,
            color: "white",
            "&.Mui-checked": { color: "primary.light" },
          }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggle(id)}
        />
      </Box>
      {badgeLabel && (
        <Box sx={{ position: "absolute", top: 4, right: 4 }}>
          <Chip
            label={badgeLabel}
            size="small"
            color={badgeColor}
            sx={{ fontSize: "0.65rem", height: 20 }}
          />
        </Box>
      )}
      <Box sx={{ p: 0.75, bgcolor: "background.paper" }}>
        <Typography variant="caption" noWrap title={filename} sx={{ display: "block", fontSize: "0.7rem" }}>
          {filename}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
          {caption}
        </Typography>
      </Box>
    </Box>
  );
};

export default React.memo(SelectableMediaTile);
