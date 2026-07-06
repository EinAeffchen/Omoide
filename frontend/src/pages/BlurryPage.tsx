import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import ReplayIcon from "@mui/icons-material/Replay";

import { BlurMediaItem } from "../types";
import { getBlurryMedia, resolveBlurry, startBlurScoring } from "../services/blur";
import { useTaskCompletionVersion, useTaskEvents } from "../TaskEventsContext";
import { RerunProcessorsDialog } from "../components/RerunProcessorsDialog";
import { useCursorList } from "../hooks/useCursorList";
import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "../components/BulkResolveToolbar";
import ReviewMediaGrid from "../components/ReviewMediaGrid";
import SelectableMediaTile from "../components/SelectableMediaTile";
import { formatBytes } from "../formatUtils";

const scoreColor = (score: number) => {
  if (score < 30) return "error";
  if (score < 80) return "warning";
  return "default";
};

const DEFAULT_THRESHOLD = 100;

const BlurryPage: React.FC = () => {
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [pendingThreshold, setPendingThreshold] = useState(DEFAULT_THRESHOLD);
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");

  const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
  const [rerunIds, setRerunIds] = useState<number[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: FeedbackSeverity }>({
    open: false, message: "", severity: "success",
  });

  const refreshKey = useTaskCompletionVersion(["compute_blur_scores"]);
  const { activeTasks } = useTaskEvents();
  const blurTask = activeTasks.find((t) => t.task_type === "compute_blur_scores");

  const fetcher = useCallback(
    (cursor: string | null) =>
      getBlurryMedia({
        threshold,
        cursor: cursor ?? undefined,
        limit: 50,
        mediaType: mediaType || undefined,
      }),
    [threshold, mediaType]
  );

  const {
    items,
    total,
    hasMore,
    isLoading,
    error,
    loaderRef,
    selectedIds,
    toggleSelected,
    selectVisible,
    clearSelection,
    removeItems,
    refetch,
  } = useCursorList<BlurMediaItem>(fetcher, refreshKey);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) => setSnackbar({ open: true, message, severity }),
    []
  );

  const resolveSelection = useCallback(
    ({ action, mediaIds, selectAll }: { action: BulkResolveAction; mediaIds?: number[]; selectAll?: boolean }) =>
      selectAll
        ? resolveBlurry({ action, select_all: true, threshold, media_type: mediaType || undefined })
        : resolveBlurry({ action, media_ids: mediaIds }),
    [threshold, mediaType]
  );

  const handleResolved = useCallback(
    (removedIds: number[], removed: number, selectAll: boolean) => {
      if (selectAll) {
        refetch();
      } else {
        removeItems(removedIds, removed);
      }
    },
    [refetch, removeItems]
  );

  const applyThreshold = () => {
    setThreshold(pendingThreshold);
  };

  const handleStartScoring = async () => {
    try {
      await startBlurScoring();
      showFeedback("Blur scoring started", "success");
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : "Failed to start scoring", "error");
    }
  };

  const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);
  const selectedCount = selectedIds.size;

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
      <BulkResolveToolbar
        statsText={`${total.toLocaleString()} blurry items (threshold < ${threshold})`}
        shownCount={items.length}
        shownSize={totalSize}
        total={total}
        selectedIds={selectedIds}
        onSelectVisible={selectVisible}
        onClearSelection={clearSelection}
        resolve={resolveSelection}
        onResolved={handleResolved}
        onFeedback={showFeedback}
        extraActions={
          <Button
            size="small"
            variant="outlined"
            startIcon={<ReplayIcon />}
            onClick={() => {
              const ids = selectedCount > 0 ? Array.from(selectedIds) : items.map((i) => i.id);
              setRerunIds(ids);
              setRerunDialogOpen(true);
            }}
            disabled={items.length === 0}
          >
            {selectedCount > 0 ? `Rerun (${selectedCount} selected)` : `Rerun all visible (${items.length})`}
          </Button>
        }
      />

      <ReviewMediaGrid
        itemCount={items.length}
        isLoading={isLoading}
        hasMore={hasMore}
        loaderRef={loaderRef}
        empty={
          <Typography color="text.secondary">
            No scored media below the current threshold.
            {total === 0 && " Run \"Score unscored media\" to compute blur scores."}
          </Typography>
        }
      >
        {items.map((item) => (
          <SelectableMediaTile
            key={item.id}
            id={item.id}
            filename={item.filename}
            thumbnailPath={item.thumbnail_path}
            selected={selectedIds.has(item.id)}
            onToggle={toggleSelected}
            badgeLabel={item.laplacian_score.toFixed(1)}
            badgeColor={scoreColor(item.laplacian_score)}
            caption={`${formatBytes(item.size)}${item.duration != null ? " · video" : ""}`}
          />
        ))}
      </ReviewMediaGrid>

      <RerunProcessorsDialog
        open={rerunDialogOpen}
        mediaIds={rerunIds}
        onClose={() => setRerunDialogOpen(false)}
        onStarted={() => showFeedback("Processing started.", "success")}
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
