import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Slider,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import DeleteIcon from "@mui/icons-material/Delete";
import BlockIcon from "@mui/icons-material/Block";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import ReplayIcon from "@mui/icons-material/Replay";
import { useInView } from "react-intersection-observer";

import { BlurMediaItem } from "../types";
import { API } from "../config";
import {
  BlurResolveAction,
  getBlurryMedia,
  resolveBlurry,
  startBlurScoring,
} from "../services/blur";
import { useTaskCompletionVersion, useTaskEvents } from "../TaskEventsContext";
import { RerunProcessorsDialog } from "../components/RerunProcessorsDialog";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
};

const scoreColor = (score: number) => {
  if (score < 30) return "error";
  if (score < 80) return "warning";
  return "default";
};

const DEFAULT_THRESHOLD = 100;

const BlurryPage: React.FC = () => {
  const [items, setItems] = useState<BlurMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [pendingThreshold, setPendingThreshold] = useState(DEFAULT_THRESHOLD);
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });

  const refreshKey = useTaskCompletionVersion(["compute_blur_scores"]);
  const { activeTasks } = useTaskEvents();
  const blurTask = activeTasks.find((t) => t.task_type === "compute_blur_scores");

  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  const fetchBlurry = useCallback(
    async (cursor: string | null, append: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await getBlurryMedia({
          threshold,
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
        setError(e instanceof Error ? e.message : "Failed to load blurry media");
      } finally {
        setIsLoading(false);
      }
    },
    [threshold, mediaType]
  );

  useEffect(() => {
    fetchBlurry(null, false);
  }, [fetchBlurry, refreshKey]);

  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      fetchBlurry(nextCursor, true);
    }
  }, [inView, hasMore, isLoading, fetchBlurry, nextCursor]);

  const applyThreshold = () => {
    setThreshold(pendingThreshold);
  };

  const toggleItem = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleAction = async (action: BlurResolveAction) => {
    if (selectedIds.size === 0) return;
    setIsActionLoading(true);
    try {
      const { removed } = await resolveBlurry(Array.from(selectedIds), action);
      setSnackbar({ open: true, message: `${removed} item(s) processed`, severity: "success" });
      await fetchBlurry(null, false);
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Action failed", severity: "error" });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStartScoring = async () => {
    try {
      await startBlurScoring();
      setSnackbar({ open: true, message: "Blur scoring started", severity: "success" });
    } catch (e) {
      setSnackbar({ open: true, message: e instanceof Error ? e.message : "Failed to start scoring", severity: "error" });
    }
  };

  const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);
  const selectedCount = selectedIds.size;

  const thumbUrl = (item: BlurMediaItem) => {
    const thumb = item.thumbnail_path ? encodeURIComponent(item.thumbnail_path) : `${item.id}.jpg`;
    return `${API}/thumbnails/${thumb}`;
  };

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Blurry Images
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Shows media with a Laplacian variance score below the threshold. Lower scores mean blurrier images.
        Scores are computed during media processing or via the button below.
      </Typography>

      {blurTask && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Scoring in progress… {blurTask.processed}/{blurTask.total}
          {blurTask.current_step ? ` (${blurTask.current_step})` : ""}
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems={{ md: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Blur threshold: <strong>{pendingThreshold}</strong>
            </Typography>
            <Slider
              value={pendingThreshold}
              onChange={(_, v) => setPendingThreshold(v as number)}
              onChangeCommitted={applyThreshold}
              min={0}
              max={500}
              step={5}
              marks={[
                { value: 30, label: "30" },
                { value: 100, label: "100" },
                { value: 200, label: "200" },
                { value: 500, label: "500" },
              ]}
              valueLabelDisplay="auto"
              sx={{ maxWidth: 480 }}
            />
          </Box>
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
          <Button
            variant="outlined"
            startIcon={<BlurOnIcon />}
            onClick={handleStartScoring}
            disabled={Boolean(blurTask)}
          >
            Score unscored media
          </Button>
        </Stack>
      </Paper>

      {/* Stats + bulk actions */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          sx={{ p: 2 }}
        >
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1">
              {total.toLocaleString()} blurry items (threshold &lt; {threshold})
            </Typography>
            <Typography variant="body2" color="text.secondary">
              shown: {items.length} · {formatBytes(totalSize)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              selected: {selectedCount}
            </Typography>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              size="small"
              startIcon={<SelectAllIcon />}
              onClick={selectAll}
              disabled={items.length === 0}
            >
              Select visible
            </Button>
            <Button
              size="small"
              startIcon={<ClearAllIcon />}
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={() => setRerunDialogOpen(true)}
              disabled={selectedCount === 0}
            >
              Rerun Processors
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
            <Typography color="text.secondary">
              No scored media below the current threshold.
              {total === 0 && " Run \"Score unscored media\" to compute blur scores."}
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
                  onClick={() => toggleItem(item.id)}
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
                  {/* Thumbnail */}
                  <Box
                    component="img"
                    src={thumbUrl(item)}
                    alt={item.filename}
                    sx={{
                      width: "100%",
                      aspectRatio: "4/3",
                      objectFit: "cover",
                      display: "block",
                    }}
                    onError={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                  />
                  {/* Checkbox */}
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
                  {/* Score badge */}
                  <Box sx={{ position: "absolute", top: 4, right: 4 }}>
                    <Chip
                      label={item.laplacian_score.toFixed(1)}
                      size="small"
                      color={scoreColor(item.laplacian_score)}
                      sx={{ fontSize: "0.65rem", height: 20 }}
                    />
                  </Box>
                  {/* Filename */}
                  <Box sx={{ p: 0.75, bgcolor: "background.paper" }}>
                    <Typography
                      variant="caption"
                      noWrap
                      title={item.filename}
                      sx={{ display: "block", fontSize: "0.7rem" }}
                    >
                      {item.filename}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                      {formatBytes(item.size)}
                      {item.duration != null && ` · video`}
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

      <RerunProcessorsDialog
        open={rerunDialogOpen}
        mediaIds={Array.from(selectedIds)}
        onClose={() => setRerunDialogOpen(false)}
        onStarted={() => setSnackbar({ open: true, message: "Processing started.", severity: "success" })}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BlurryPage;
