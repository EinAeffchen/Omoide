import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Checkbox, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { SimilarPerson } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

const getInitials = (name = "") => {
  const parts = name.split(" ");
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

interface SimilarPersonCardProps extends SimilarPerson {
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export default function SimilarPersonCard({
  id,
  name,
  similarity,
  thumbnail,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SimilarPersonCardProps) {
  const theme = useTheme();

  const thumbUrl = thumbnail
    ? `${API}/thumbnails/${encodeFilePath(thumbnail)}`
    : undefined;

  const handleToggle = () => {
    if (selectable && onToggleSelect) {
      onToggleSelect();
    }
  };

  const cardProps: Record<string, unknown> = selectable
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: handleToggle,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggle();
          }
        },
      }
    : {
        component: RouterLink,
        to: `/person/${id}`,
      };

  return (
    <Box
      {...cardProps}
      sx={{
        aspectRatio: "3/4",
        position: "relative",
        display: "block",
        overflow: "hidden",
        borderRadius: 3,
        textDecoration: "none",
        color: (theme) => theme.palette.common.white,
        transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
        cursor: selectable ? "pointer" : "pointer",
        background: thumbUrl
          ? `url(${thumbUrl})`
          : (theme) =>
              `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: selectable
          ? `2px solid ${selected ? theme.palette.primary.main : "transparent"}`
          : "none",
        boxShadow: selected ? theme.shadows[10] : theme.shadows[4],

        "&:hover": {
          transform: "scale(1.05)",
          boxShadow: theme.shadows[10],
          zIndex: 10,
        },
      }}
    >
      {selectable && (
        <>
          <Checkbox
            checked={selected}
            onChange={handleToggle}
            onClick={(event) => {
              event.stopPropagation();
            }}
            sx={{
              position: "absolute",
              top: 8,
              left: 8,
              zIndex: 10,
              color: theme.palette.common.white,
              "&.Mui-checked": {
                color: theme.palette.primary.main,
              },
            }}
          />
          <Button
            component={RouterLink}
            to={`/person/${id}`}
            size="small"
            variant="outlined"
            onClick={(event) => event.stopPropagation()}
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 2,
              backdropFilter: "blur(6px)",
              color: theme.palette.common.white,
              borderColor: alpha(theme.palette.common.white, 0.6),
              "&:hover": {
                borderColor: theme.palette.primary.main,
              },
            }}
          >
            View
          </Button>
        </>
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
            {getInitials(name || "Unknown")}
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
          background: (theme) =>
            `linear-gradient(to top, ${alpha(theme.palette.common.black, 0.8)} 0%, ${alpha(theme.palette.common.black, 0)} 50%)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          p: 1.5,
        }}
      >
        <Typography variant="subtitle1" fontWeight="bold" lineHeight={1.2}>
          {name || "Unknown"}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: (theme) => alpha(theme.palette.common.white, 0.7),
            mt: 0.5,
          }}
        >
          {similarity != null ? `${similarity.toFixed(1)}% match` : ""}
        </Typography>
      </Box>
    </Box>
  );
}
