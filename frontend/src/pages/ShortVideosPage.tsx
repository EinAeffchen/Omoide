import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
  Paper,
  Slider,
  Snackbar,
  Typography,
} from "@mui/material";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";

import { ShortVideoItem } from "../types";
import { getShortVideos, resolveShortVideos } from "../services/shortvideos";
import { useCursorList } from "../hooks/useCursorList";
import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "../components/BulkResolveToolbar";
import ReviewMediaGrid from "../components/ReviewMediaGrid";
import SelectableMediaTile from "../components/SelectableMediaTile";
import { formatBytes } from "../formatUtils";

const DEFAULT_MAX_DURATION = 10;

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(0).padStart(2, "0");
  return `${m}:${s}`;
};

const ShortVideosPage: React.FC = () => {
  const [maxDuration, setMaxDuration] = useState(DEFAULT_MAX_DURATION);
  const [pendingDuration, setPendingDuration] = useState(DEFAULT_MAX_DURATION);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: FeedbackSeverity }>({
    open: false, message: "", severity: "success",
  });

  const fetcher = useCallback(
    (cursor: string | null) =>
      getShortVideos({
        maxDuration,
        cursor: cursor ?? undefined,
        limit: 50,
      }),
    [maxDuration]
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
  } = useCursorList<ShortVideoItem>(fetcher);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) => setSnackbar({ open: true, message, severity }),
    []
  );

  const resolveSelection = useCallback(
    ({ action, mediaIds, selectAll }: { action: BulkResolveAction; mediaIds?: number[]; selectAll?: boolean }) =>
      selectAll
        ? resolveShortVideos({ action, select_all: true, max_duration: maxDuration })
        : resolveShortVideos({ action, media_ids: mediaIds }),
    [maxDuration]
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

  const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        Short Videos
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Videos shorter than the threshold duration. Useful for finding accidental recordings, boomerangs,
        or animated clips that may not be worth keeping. Sorted shortest-first.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Max duration: <strong>{formatDuration(pendingDuration)}</strong>
        </Typography>
        <Slider
          value={pendingDuration}
          onChange={(_, v) => setPendingDuration(v as number)}
          onChangeCommitted={(_, v) => setMaxDuration(v as number)}
          min={1}
          max={120}
          step={1}
          marks={[
            { value: 5, label: "5s" },
            { value: 10, label: "10s" },
            { value: 30, label: "30s" },
            { value: 60, label: "1m" },
            { value: 120, label: "2m" },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => formatDuration(v)}
          sx={{ maxWidth: 480 }}
        />
      </Paper>

      {/* Stats + bulk actions */}
      <BulkResolveToolbar
        statsText={`${total.toLocaleString()} video${total !== 1 ? "s" : ""} under ${formatDuration(maxDuration)}`}
        shownCount={items.length}
        shownSize={totalSize}
        total={total}
        selectedIds={selectedIds}
        onSelectVisible={selectVisible}
        onClearSelection={clearSelection}
        resolve={resolveSelection}
        onResolved={handleResolved}
        onFeedback={showFeedback}
      />

      <ReviewMediaGrid
        itemCount={items.length}
        isLoading={isLoading}
        hasMore={hasMore}
        loaderRef={loaderRef}
        empty={
          <>
            <VideocamOffIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary">
              No videos shorter than {formatDuration(maxDuration)}.
            </Typography>
          </>
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
            badgeLabel={formatDuration(item.duration)}
            badgeColor="primary"
            caption={`${formatBytes(item.size)}${item.width && item.height ? ` · ${item.width}×${item.height}` : ""}`}
          />
        ))}
      </ReviewMediaGrid>

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

export default ShortVideosPage;
