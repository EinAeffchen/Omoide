import React, { useEffect, useState } from "react";
import { Box, Chip, IconButton, Typography } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link, useLocation } from "react-router-dom";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { getMemories } from "../services/features";
import { useLocalStorageBoolean } from "../hooks/useLocalStorageBoolean";
import { Media, MemoryGroup } from "../types";

const thumbUrl = (media: Media) =>
  media.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(media.thumbnail_path)}`
    : `${API}/thumbnails/${media.id}.jpg`;

/** "On this day" strip shown on the index page when past-year media exist. */
export function MemoriesRail() {
  const [groups, setGroups] = useState<MemoryGroup[]>([]);
  const [collapsed, setCollapsed] = useLocalStorageBoolean(
    "otd_collapsed",
    false
  );
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    getMemories()
      .then((data) => {
        if (alive) setGroups(data);
      })
      .catch((err) => console.warn("Failed to load memories:", err));
    return () => {
      alive = false;
    };
  }, []);

  if (groups.length === 0) return null;

  const currentYear = new Date().getFullYear();

  return (
    <Box
      sx={{
        mb: 4,
        p: 2,
        borderRadius: 3,
        bgcolor: "background.paper",
        boxShadow: (theme) => theme.shadows[1],
      }}
    >
      <Box display="flex" alignItems="center" gap={1} mb={collapsed ? 0 : 1.5}>
        <AutoAwesomeIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
          On this day
        </Typography>
        <IconButton
          size="small"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand" : "Minimize"}
        >
          {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
        </IconButton>
      </Box>
      {!collapsed && (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: 400,
          overflowY: "auto",
          pr: 0.5,
          "&::-webkit-scrollbar": { width: 6 },
        }}
      >
        {groups.map((group) => (
          <Box key={group.year}>
            <Chip
              size="small"
              label={`${group.year} · ${currentYear - group.year} year${
                currentYear - group.year === 1 ? "" : "s"
              } ago`}
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Box
              sx={{
                display: "flex",
                gap: 1,
                overflowX: "auto",
                pb: 0.5,
                "&::-webkit-scrollbar": { height: 6 },
              }}
            >
              {group.items.map((media) => (
                <Link
                  key={media.id}
                  to={`/medium/${media.id}`}
                  state={{ backgroundLocation: location }}
                >
                  <Box
                    component="img"
                    src={thumbUrl(media)}
                    alt={media.filename}
                    loading="lazy"
                    sx={{
                      height: 120,
                      width: "auto",
                      minWidth: 80,
                      objectFit: "cover",
                      borderRadius: 2,
                      display: "block",
                      flexShrink: 0,
                      transition: "transform 0.15s",
                      "&:hover": { transform: "scale(1.03)" },
                    }}
                  />
                </Link>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      )}
    </Box>
  );
}
