import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import LabelOffIcon from "@mui/icons-material/LabelOff";

import { UntaggedMediaItem } from "../types";
import { getUntaggedMedia, resolveUntagged } from "../services/untagged";
import { useCursorList } from "../hooks/useCursorList";
import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "../components/BulkResolveToolbar";
import ReviewMediaGrid from "../components/ReviewMediaGrid";
import SelectableMediaTile from "../components/SelectableMediaTile";
import { formatBytes } from "../formatUtils";

const UntaggedPage: React.FC = () => {
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: FeedbackSeverity }>({
    open: false, message: "", severity: "success",
  });

  const fetcher = useCallback(
    (cursor: string | null) =>
      getUntaggedMedia({
        cursor: cursor ?? undefined,
        limit: 50,
        mediaType: mediaType || undefined,
      }),
    [mediaType]
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
  } = useCursorList<UntaggedMediaItem>(fetcher);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) => setSnackbar({ open: true, message, severity }),
    []
  );

  const resolveSelection = useCallback(
    ({ action, mediaIds, selectAll }: { action: BulkResolveAction; mediaIds?: number[]; selectAll?: boolean }) =>
      selectAll
        ? resolveUntagged({ action, select_all: true, media_type: mediaType || undefined })
        : resolveUntagged({ action, media_ids: mediaIds, media_type: mediaType || undefined }),
    [mediaType]
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
      <BulkResolveToolbar
        statsText={`${total.toLocaleString()} untagged item${total !== 1 ? "s" : ""}`}
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
            <LabelOffIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary">
              All media has at least one tag assigned.
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
            badgeLabel={item.duration != null ? "video" : undefined}
            caption={formatBytes(item.size)}
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

export default UntaggedPage;
