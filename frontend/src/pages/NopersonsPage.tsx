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
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import ReplayIcon from "@mui/icons-material/Replay";
import { RerunProcessorsDialog } from "../components/RerunProcessorsDialog";
import { useTaskCompletionVersion } from "../TaskEventsContext";

import { NoPersonsMediaItem } from "../types";
import { getNoPersonsMedia, resolveNoPersons } from "../services/nopersons";
import { useCursorList } from "../hooks/useCursorList";
import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "../components/BulkResolveToolbar";
import ReviewMediaGrid from "../components/ReviewMediaGrid";
import SelectableMediaTile from "../components/SelectableMediaTile";
import { formatBytes } from "../formatUtils";

const NopersonsPage: React.FC = () => {
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");
  const [scope, setScope] = useState<"processed" | "all">("processed");

  const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
  const [rerunIds, setRerunIds] = useState<number[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: FeedbackSeverity }>({
    open: false, message: "", severity: "success",
  });

  const refreshKey = useTaskCompletionVersion([
    "process_media",
    "cluster_persons",
    "run_processor_for_media",
  ]);

  const fetcher = useCallback(
    (cursor: string | null) =>
      getNoPersonsMedia({
        cursor: cursor ?? undefined,
        limit: 50,
        mediaType: mediaType || undefined,
        scope,
      }),
    [mediaType, scope]
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
  } = useCursorList<NoPersonsMediaItem>(fetcher, refreshKey);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) => setSnackbar({ open: true, message, severity }),
    []
  );

  const resolveSelection = useCallback(
    ({ action, mediaIds, selectAll }: { action: BulkResolveAction; mediaIds?: number[]; selectAll?: boolean }) =>
      selectAll
        ? resolveNoPersons({ action, select_all: true, media_type: mediaType || undefined, scope })
        : resolveNoPersons({ action, media_ids: mediaIds }),
    [mediaType, scope]
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
  const selectedCount = selectedIds.size;

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" gutterBottom>
        No Persons Detected
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Media where face detection was run but no persons were identified.
        Use this view to review and tidy up unrecognized content, or switch to{" "}
        <strong>All unlinked</strong> to see every item with no person association regardless of processing status.
        Click any thumbnail to open the full media view.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Scope</InputLabel>
            <Select
              label="Scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as "processed" | "all")}
            >
              <MenuItem value="processed">Processed — no persons found</MenuItem>
              <MenuItem value="all">All unlinked to any person</MenuItem>
            </Select>
          </FormControl>
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
        statsText={`${total.toLocaleString()} item${total !== 1 ? "s" : ""}`}
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
          <>
            <PersonOffIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
            <Typography color="text.secondary">
              {scope === "processed"
                ? "No processed media without persons. Run face detection to populate this view."
                : "All media is linked to at least one person."}
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
        <Alert onClose={() => setSnackbar((p) => ({ ...p, open: false }))} severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default NopersonsPage;
