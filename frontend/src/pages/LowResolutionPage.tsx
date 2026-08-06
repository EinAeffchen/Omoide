import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
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
import PhotoSizeSelectSmallIcon from "@mui/icons-material/PhotoSizeSelectSmall";

import { LowResMediaItem } from "../types";
import { getLowResMedia, resolveLowRes } from "../services/lowresolution";
import { useCursorList } from "../hooks/useCursorList";
import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "../components/BulkResolveToolbar";
import ReviewMediaGrid from "../components/ReviewMediaGrid";
import SelectableMediaTile from "../components/SelectableMediaTile";
import { formatBytes } from "../formatUtils";

const DEFAULT_MAX_MP = 1.0;
const MP_MARKS = [
  { value: 0.1, label: "0.1" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 5, label: "5 MP" },
];

const formatMp = (pixels: number) => {
  const mp = pixels / 1_000_000;
  return mp < 1 ? `${(mp * 1000).toFixed(0)} kP` : `${mp.toFixed(2)} MP`;
};

const LowResolutionPage: React.FC = () => {
  const [maxMp, setMaxMp] = useState(DEFAULT_MAX_MP);
  const [pendingMp, setPendingMp] = useState(DEFAULT_MAX_MP);
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: FeedbackSeverity }>({
    open: false, message: "", severity: "success",
  });

  const fetcher = useCallback(
    (cursor: string | null) =>
      getLowResMedia({
        maxPixels: Math.round(maxMp * 1_000_000),
        cursor: cursor ?? undefined,
        limit: 50,
        mediaType: mediaType || undefined,
      }),
    [maxMp, mediaType]
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
  } = useCursorList<LowResMediaItem>(fetcher);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) => setSnackbar({ open: true, message, severity }),
    []
  );

  const resolveSelection = useCallback(
    ({ action, mediaIds, selectAll }: { action: BulkResolveAction; mediaIds?: number[]; selectAll?: boolean }) =>
      selectAll
        ? resolveLowRes({
            action,
            select_all: true,
            max_pixels: Math.round(maxMp * 1_000_000),
            media_type: mediaType || undefined,
          })
        : resolveLowRes({
            action,
            media_ids: mediaIds,
            max_pixels: Math.round(maxMp * 1_000_000),
            media_type: mediaType || undefined,
          }),
    [maxMp, mediaType]
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
        Low Resolution
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Media whose pixel count (width × height) is below the threshold. Sorted lowest-resolution first.
        Useful for finding thumbnails, corrupt imports, and low-quality duplicates.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3} alignItems={{ sm: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Max resolution: <strong>{pendingMp.toFixed(pendingMp < 1 ? 2 : 1)} MP</strong>
              {" "}({Math.round(pendingMp * 1_000_000).toLocaleString()} px)
            </Typography>
            <Slider
              value={pendingMp}
              onChange={(_, v) => setPendingMp(v as number)}
              onChangeCommitted={(_, v) => setMaxMp(v as number)}
              min={0.1}
              max={5}
              step={0.1}
              marks={MP_MARKS}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v.toFixed(1)} MP`}
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
        </Stack>
      </Paper>

      {/* Stats + bulk actions */}
      <BulkResolveToolbar
        statsText={`${total.toLocaleString()} item${total !== 1 ? "s" : ""} under ${maxMp.toFixed(1)} MP`}
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
            <PhotoSizeSelectSmallIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary">
              No media below {maxMp.toFixed(1)} MP.
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
            badgeLabel={formatMp(item.pixel_count)}
            badgeColor="warning"
            caption={`${item.width}×${item.height}${item.duration != null ? " · video" : ""} · ${formatBytes(item.size)}`}
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

export default LowResolutionPage;
