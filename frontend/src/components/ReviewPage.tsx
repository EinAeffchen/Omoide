import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  SvgIconProps,
} from "@mui/material";
import ReplayIcon from "@mui/icons-material/Replay";

import BulkResolveToolbar, {
  BulkResolveAction,
  FeedbackSeverity,
} from "./BulkResolveToolbar";
import ReviewMediaGrid from "./ReviewMediaGrid";
import SelectableMediaTile from "./SelectableMediaTile";
import { RerunProcessorsDialog } from "./RerunProcessorsDialog";
import { usePagedList } from "../hooks/usePagedList";
import { useIdSelection } from "../hooks/useIdSelection";
import { Query } from "../services/api";
import {
  getReviewPage,
  resolveReview,
  ReviewEndpoint,
} from "../services/review";
import { useTaskCompletionVersion } from "../TaskEventsContext";
import { ReviewMediaItem, TaskType } from "../types";

type MediaTypeFilter = "" | "image" | "video";
type BadgeColor = React.ComponentProps<typeof SelectableMediaTile>["badgeColor"];

export interface ReviewPageProps<T extends ReviewMediaItem> {
  endpoint: ReviewEndpoint;
  title: string;
  description: React.ReactNode;
  /** Category-specific filters (backend query names), e.g. `{ threshold }`. */
  filters?: Query;
  /** Inputs for `filters`, rendered next to the media-type filter. */
  controls?: React.ReactNode;
  /** Offer the image/video filter (sent as `media_type`). */
  mediaTypeFilter?: boolean;
  /** Shown above the controls, e.g. progress of a related task. */
  banner?: React.ReactNode;
  /** Extra toolbar buttons next to the bulk actions. */
  actions?: React.ReactNode;
  /** Offer re-running processors on the selection (or everything shown). */
  rerunProcessors?: boolean;
  /** Reload when one of these tasks completes. */
  refreshOn?: TaskType[];
  statsText: (total: number) => string;
  emptyIcon: React.ReactElement<SvgIconProps>;
  emptyText: (total: number) => React.ReactNode;
  badge?: (item: T) => { label: string; color?: BadgeColor } | undefined;
  caption: (item: T) => string;
}

/** Shared layout for the maintenance review lists: filter, page through,
 * select, and bulk-resolve media in one category. */
export function ReviewPage<T extends ReviewMediaItem>({
  endpoint,
  title,
  description,
  filters,
  controls,
  mediaTypeFilter = true,
  banner,
  actions,
  rerunProcessors = false,
  refreshOn = [],
  statsText,
  emptyIcon,
  emptyText,
  badge,
  caption,
}: ReviewPageProps<T>) {
  const [mediaType, setMediaType] = useState<MediaTypeFilter>("");
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: FeedbackSeverity;
  }>({ open: false, message: "", severity: "success" });
  const [rerunIds, setRerunIds] = useState<number[] | null>(null);

  const query = useMemo<Query>(
    () => ({ ...filters, media_type: mediaType || undefined }),
    [filters, mediaType]
  );
  // With no task types the hook would count every task, so ignore it then.
  const taskVersion = useTaskCompletionVersion(refreshOn);
  const refreshKey = refreshOn.length > 0 ? taskVersion : 0;
  const listKey = `review:${endpoint}:${JSON.stringify(query)}`;

  const list = usePagedList<T>(listKey, (cursor, signal) =>
    getReviewPage<T>(endpoint, query, cursor, signal)
  );
  const { items, isLoading, hasMore, error, loaderRef, reload, removeItems } =
    list;
  const total = list.total ?? 0;
  const selection = useIdSelection<number>();

  // A changed filter starts a new list, so the old selection no longer applies.
  const { clear: clearSelection } = selection;
  useEffect(() => clearSelection(), [listKey, clearSelection]);

  // Task completions (new scores, new faces) change what belongs here.
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefreshKey) return;
    setSeenRefreshKey(refreshKey);
    reload();
  }, [refreshKey, seenRefreshKey, reload]);

  const showFeedback = useCallback(
    (message: string, severity: FeedbackSeverity) =>
      setSnackbar({ open: true, message, severity }),
    []
  );

  const resolve = useCallback(
    ({
      action,
      mediaIds,
      selectAll,
    }: {
      action: BulkResolveAction;
      mediaIds?: number[];
      selectAll?: boolean;
    }) =>
      resolveReview(
        endpoint,
        query,
        action,
        selectAll ? { selectAll: true } : { mediaIds: mediaIds ?? [] }
      ),
    [endpoint, query]
  );

  const handleResolved = useCallback(
    (removedIds: number[], removed: number, selectAll: boolean) => {
      if (selectAll) reload();
      else removeItems(removedIds, removed);
      selection.deselect(removedIds);
    },
    [reload, removeItems, selection]
  );

  const shownSize = items.reduce((sum, item) => sum + (item.size || 0), 0);
  const selectedCount = selection.selectedIds.size;

  return (
    <Box sx={{ p: 2, maxWidth: "1600px", mx: "auto" }}>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>

      {banner}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {(controls || mediaTypeFilter) && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={3}
            alignItems={{ md: "center" }}
          >
            {controls}
            {mediaTypeFilter && (
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id={`${endpoint}-media-type`}>Media type</InputLabel>
                <Select
                  labelId={`${endpoint}-media-type`}
                  label="Media type"
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value as MediaTypeFilter)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="image">Images</MenuItem>
                  <MenuItem value="video">Videos</MenuItem>
                </Select>
              </FormControl>
            )}
          </Stack>
        </Paper>
      )}

      <BulkResolveToolbar
        statsText={statsText(total)}
        shownCount={items.length}
        shownSize={shownSize}
        total={total}
        selectedIds={selection.selectedIds}
        onSelectVisible={() => selection.selectAll(items.map((item) => item.id))}
        onClearSelection={selection.clear}
        resolve={resolve}
        onResolved={handleResolved}
        onFeedback={showFeedback}
        extraActions={
          <>
            {actions}
            {rerunProcessors && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReplayIcon />}
                onClick={() =>
                  setRerunIds(
                    selectedCount > 0
                      ? Array.from(selection.selectedIds)
                      : items.map((item) => item.id)
                  )
                }
                disabled={items.length === 0}
              >
                {selectedCount > 0
                  ? `Rerun (${selectedCount} selected)`
                  : `Rerun all visible (${items.length})`}
              </Button>
            )}
          </>
        }
      />

      <ReviewMediaGrid
        itemCount={items.length}
        isLoading={isLoading}
        hasMore={hasMore}
        loaderRef={loaderRef}
        empty={
          <>
            {React.cloneElement(emptyIcon, {
              sx: { fontSize: 48, color: "text.disabled", mb: 1 },
            })}
            <Typography color="text.secondary">{emptyText(total)}</Typography>
          </>
        }
      >
        {items.map((item) => {
          const tileBadge = badge?.(item);
          return (
            <SelectableMediaTile
              key={item.id}
              id={item.id}
              filename={item.filename}
              thumbnailPath={item.thumbnail_path}
              selected={selection.selectedIds.has(item.id)}
              onToggle={selection.toggle}
              badgeLabel={tileBadge?.label}
              badgeColor={tileBadge?.color}
              caption={caption(item)}
            />
          );
        })}
      </ReviewMediaGrid>

      {rerunProcessors && (
        <RerunProcessorsDialog
          open={rerunIds !== null}
          mediaIds={rerunIds ?? []}
          onClose={() => setRerunIds(null)}
          onStarted={() => showFeedback("Processing started.", "success")}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
