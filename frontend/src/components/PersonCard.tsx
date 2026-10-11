import React, { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Checkbox,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { alpha } from "@mui/material/styles";
import type { PersonReadSimple } from "../types";
import config, { API } from "../config";
import { setPersonFavorite } from "../services/personActions";
import { encodeFilePath } from "../urlUtils";
import type { PersonThumbSize } from "./PersonThumbSize";

type PersonCardPerson = PersonReadSimple & { appearance_count?: number };

interface PersonCardProps {
  person: PersonCardPerson;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (personId: number) => void;
  size?: PersonThumbSize;
  onFavoriteChange?: (personId: number, isFavorite: boolean) => void;
}

const favoriteBadgeSx = {
  position: "absolute",
  top: 4,
  right: 4,
  zIndex: 2,
  p: 0.5,
  borderRadius: "50%",
  bgcolor: "rgba(0,0,0,0.45)",
} as const;

const getInitials = (name = "") => {
  const parts = name.split(" ");
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export default function PersonCard({
  person,
  selectable = false,
  selected = false,
  onToggleSelect,
  size = "medium",
  onFavoriteChange,
}: PersonCardProps) {
  const theme = useTheme();
  const [isFavorite, setIsFavorite] = useState(Boolean(person.is_favorite));

  useEffect(() => {
    setIsFavorite(Boolean(person.is_favorite));
  }, [person.id, person.is_favorite]);

  const handleToggleFavorite = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !isFavorite;
    setIsFavorite(next);
    setPersonFavorite(person.id, next)
      .then(() => onFavoriteChange?.(person.id, next))
      .catch(() => setIsFavorite(!next));
  };
  const isSelectable = Boolean(selectable);
  const isSelected = Boolean(selected);
  const fallbackName = person.name || "Unknown";

  const thumbUrl = person.profile_face?.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(
        person.profile_face.thumbnail_path
      )}`
    : undefined;

  const handleSelectionToggle = (
    event?: React.SyntheticEvent,
  ): void => {
    if (!isSelectable) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    onToggleSelect?.(person.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isSelectable) return;
    if (event.key === " " || event.key === "Enter") {
      handleSelectionToggle(event);
    }
  };

  const outlineStyle = isSelectable && isSelected
    ? `3px solid ${theme.palette.primary.light}`
    : "none";

  const hoverScale = isSelectable ? "scale(1.03)" : "scale(1.05)";

  const appearanceLabel =
    typeof person.appearance_count === "number" && person.appearance_count > 0
      ? `${person.appearance_count} media`
      : "";

  return (
    <Box
      component={RouterLink}
      to={`/person/${person.id}`}
      onClick={isSelectable ? handleSelectionToggle : undefined}
      onKeyDown={handleKeyDown}
      role={isSelectable ? "checkbox" : undefined}
      aria-checked={isSelectable ? isSelected : undefined}
      tabIndex={isSelectable ? 0 : undefined}
      sx={{
        aspectRatio: "3/4",
        position: "relative",
        display: "block",
        overflow: "hidden",
        borderRadius: 3,
        textDecoration: "none",
        color: (themeParam) => themeParam.palette.common.white,
        cursor: isSelectable ? "pointer" : "default",
        outline: outlineStyle,
        outlineOffset: isSelectable && isSelected ? 2 : 0,
        transition:
          "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out, outline 0.2s ease-in-out",
        background: thumbUrl
          ? `url("${thumbUrl}")`
          : (themeParam) =>
              `linear-gradient(135deg, ${themeParam.palette.primary.main}, ${themeParam.palette.primary.dark})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        "&:hover": {
          transform: hoverScale,
          boxShadow: theme.shadows[10],
          zIndex: 10,
        },
      }}
    >
      {isSelectable && (
        <Box
          sx={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 2,
            backgroundColor: (themeParam) =>
              alpha(themeParam.palette.background.paper, 0.9),
            borderRadius: "50%",
          }}
        >
          <Checkbox
            size="small"
            color="primary"
            checked={isSelected}
            onChange={handleSelectionToggle}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            inputProps={{ "aria-label": isSelected ? "Deselect person" : "Select person" }}
          />
        </Box>
      )}

      {!isSelectable && !config.PRESENTATION_MODE && (
        <Tooltip title={isFavorite ? "Remove from favorites" : "Add to favorites"}>
          <IconButton
            onClick={handleToggleFavorite}
            size="small"
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={isFavorite}
            sx={{
              ...favoriteBadgeSx,
              color: isFavorite ? "error.main" : "common.white",
              "&:hover": { bgcolor: "rgba(0,0,0,0.6)" },
            }}
          >
            {isFavorite ? (
              <FavoriteIcon fontSize="small" />
            ) : (
              <FavoriteBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      )}
      {!isSelectable && config.PRESENTATION_MODE && isFavorite && (
        <Box
          aria-label="Favorite"
          sx={{ ...favoriteBadgeSx, display: "flex", color: "error.main" }}
        >
          <FavoriteIcon fontSize="small" />
        </Box>
      )}

      {!thumbUrl && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
          }}
        >
          <Typography
            variant={size === "small" ? "h6" : size === "large" ? "h3" : "h4"}
            fontWeight="bold"
          >
            {getInitials(fallbackName)}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: (themeParam) =>
            `linear-gradient(to top, ${alpha(themeParam.palette.common.black, themeParam.palette.mode === "dark" ? 0.8 : 0.6)} 0%, ${alpha(themeParam.palette.common.black, 0)} 50%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          p: size === "small" ? 1 : 1.5,
        }}
      >
        <Typography
          variant={size === "small" ? "body2" : size === "large" ? "h6" : "subtitle1"}
          fontWeight="bold"
          lineHeight={1.2}
        >
          {fallbackName}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: (themeParam) =>
              alpha(
                themeParam.palette.common.white,
                themeParam.palette.mode === "dark" ? 0.7 : 0.85
              ),
            mt: 0.5,
          }}
        >
          {appearanceLabel}
        </Typography>
      </Box>
    </Box>
  );
}
