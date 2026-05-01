import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import LabelOffIcon from "@mui/icons-material/LabelOff";
import DeleteIcon from "@mui/icons-material/Delete";
import BlockIcon from "@mui/icons-material/Block";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import { useInView } from "react-intersection-observer";
import { Link, useLocation } from "react-router-dom";

import { UntaggedMediaItem } from "../types";
import { API } from "../config";
import {
  UntaggedResolveAction,
  getUntaggedMedia,
  resolveUntagged,
} from "../services/untagged";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
};

const UntaggedPage: React.FC = () => {
  const location = useLocation();
  const [items, setItems] = useState<UntaggedMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });

  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  const fetchItems = useCallback(
    async (cursor: string | null, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await getUntaggedMedia({
          cursor: cursor ?? undefined,
          limit: 50,
          mediaType: mediaType || undefined,
        });
        setItems((prev) => append ? [...prev, ...page.items] : page.items);
        setTotal(page.total);
        setNextCursor(page.next_cursor);
        setHasMore(Boolean(page.next_cursor));
        if (!append) setSelectedIds(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load media");
      } finally {
        setIsLoading(false);
      }
    },
    [mediaType]
  );

  useEffect(() => {
    fetchItems(null, false);
  }, [fetchItems]);

  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      fetchItems(nextCursor, true);
    }
  }, [inView, hasMore, isLoading, fetchItems, nextCursor]);

  const toggleItem = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleAction = async (action: UntaggedResolveAction) => {
    if (selectedIds.size === 0) return;
    setIsActionLoading(true);
    try {
      const { removed } = await resolveUntagged(Array.from(selectedIds), action);
      setSnackbar({ open: true, message: `${removed} item(s) processed`, severity: "success" });
      await fetchItems(null, false);
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Action failed", severity: "error" });
    } finally {
      setIsActionLoading(false);
    }
  };

  const thumbUrl = (item: UntaggedMediaItem) => {
    const thumb = item.thumbnail_path ? encodeURIComponent(item.thumbnail_path) : `${item.id}.jpg`;
    return `${API}/thumbnails/${thumb}`;
  };

  const selectedCount = selectedIds.size;
  const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Untagged Media
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Media that has no tags assigned. Use this view to identify items that still need to be categorized.
        Click any thumbnail to open the full media view and add tags.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Media type</InputLabel>
            <Select
              label="Media type"
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as "" | "image" | "video")}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="image">Images</MenuItem>
              <MenuItem value="video">Videos</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {/* Stats + bulk actions */}
      <Paper variant="outlined" sx={{ mb: 3, position: "sticky", top: 64, zIndex: 10 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          sx={{ p: 2 }}
        >
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1">
              {total.toLocaleString()} untagged item{total !== 1 ? "s" : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              shown: {items.length} · {formatBytes(totalSize)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              selected: {selectedCount}
            </Typography>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button size="small" startIcon={<SelectAllIcon />} onClick={selectAll} disabled={items.length === 0}>
              Select visible
            </Button>
            <Button size="small" startIcon={<ClearAllIcon />} onClick={clearSelection} disabled={selectedCount === 0}>
              Clear
            </Button>
            <Divider flexItem orientation="vertical" sx={{ display: { xs: "none", sm: "block" } }} />
            <Tooltip title="Delete files from disk">
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() => handleAction("DELETE_FILES")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Delete files
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Remove records from library (keep files)">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => handleAction("DELETE_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Remove records
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Blacklist and remove from library">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<BlockIcon />}
                  onClick={() => handleAction("BLACKLIST_RECORDS")}
                  disabled={selectedCount === 0 || isActionLoading}
                >
                  Blacklist
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
        <Divider />

        {isLoading && items.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <LabelOffIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary">
              All media has at least one tag assigned.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 1.5,
              p: 2,
            }}
          >
            {items.map((item) => {
              const selected = selectedIds.has(item.id);
              return (
                <Box
                  key={item.id}
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
                  onClick={() => toggleItem(item.id)}
                >
                  <Box
                    component={Link}
                    to={`/medium/${item.id}`}
                    state={{ backgroundLocation: location }}
                    onClick={(e) => e.stopPropagation()}
                    sx={{ display: "block", lineHeight: 0 }}
                  >
                    <Box
                      component="img"
                      src={thumbUrl(item)}
                      alt={item.filename}
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
                      onChange={() => toggleItem(item.id)}
                    />
                  </Box>
                  {item.duration != null && (
                    <Box sx={{ position: "absolute", top: 4, right: 4 }}>
                      <Chip label="video" size="small" sx={{ fontSize: "0.65rem", height: 20 }} />
                    </Box>
                  )}
                  <Box sx={{ p: 0.75, bgcolor: "background.paper" }}>
                    <Typography variant="caption" noWrap title={item.filename} sx={{ display: "block", fontSize: "0.7rem" }}>
                      {item.filename}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                      {formatBytes(item.size)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {hasMore && <Box ref={loaderRef} sx={{ height: 1 }} />}
        {isLoading && items.length > 0 && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setSnackbar((p) => ({ ...p, open: false }))} severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UntaggedPage;
