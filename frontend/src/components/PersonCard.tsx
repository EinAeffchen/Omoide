import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Checkbox, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { PersonReadSimple } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

type PersonCardPerson = PersonReadSimple & { appearance_count?: number };

interface PersonCardProps {
  person: PersonCardPerson;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (personId: number) => void;
}

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
}: PersonCardProps) {
  const theme = useTheme();
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

      {!thumbUrl && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
          }}
        >
          <Typography variant="h4" fontWeight="bold">
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
          p: 1.5,
        }}
      >
        <Typography variant="subtitle1" fontWeight="bold" lineHeight={1.2}>
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
