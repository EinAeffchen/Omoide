import React, { useMemo, useState } from "react";
import Masonry from "react-masonry-css";
import SortIcon from "@mui/icons-material/Sort";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Menu,
  MenuItem,
} from "@mui/material";

import MediaCard from "./MediaCard";
import { MediaSkeleton } from "./MediaSkeleton";
import { EmptyState } from "./EmptyState";
import { usePagedList } from "../hooks/usePagedList";
import { useListStore } from "../stores/useListStore";
import { useTaskCompletionVersion } from "../TaskEventsContext";
import { CursorPage, Media } from "../types";
import { useLocalStoragePreference } from "../hooks/useLocalStoragePreference";

export type MediaSortOrder = "newest" | "latest";

export const MEDIA_SORT_LABELS: Record<MediaSortOrder, string> = {
  newest: "Newest first",
  latest: "Recently added",
};

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 3,
  900: 3,
  600: 2,
};

interface MediaListPageProps {
  listKeyPrefix: string;
  fetcher: (
    cursor: string | null,
    sort: MediaSortOrder,
    signal?: AbortSignal
  ) => Promise<CursorPage<Media>>;
  emptyTitle: string;
  emptyDescription: string;
}

export default function MediaListPage({
  listKeyPrefix,
  fetcher,
  emptyTitle,
  emptyDescription,
}: MediaListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL wins (links stay shareable); otherwise use the last chosen order.
  const [savedSort, setSavedSort] = useLocalStoragePreference<MediaSortOrder>(
    "mediaSortOrder",
    ["newest", "latest"],
    "newest"
  );
  const urlSort = searchParams.get("sort");
  const sortOrder: MediaSortOrder =
    urlSort === "latest" || urlSort === "newest" ? urlSort : savedSort;
  const [sortMenuAnchorEl, setSortMenuAnchorEl] = useState<null | HTMLElement>(
    null
  );

  const listKey = useMemo(
    () => `${listKeyPrefix}-${sortOrder}`,
    [listKeyPrefix, sortOrder]
  );
  // Cached per key, so navigating back restores the list (and scroll
  // position) instantly.
  const { items, hasMore, isLoading, error, loaderRef, reload } =
    usePagedList<Media>(listKey, (cursor, signal) =>
      fetcher(cursor, sortOrder, signal)
    );
  const clearListsByPrefix = useListStore((state) => state.clearListsByPrefix);

  const refreshKey = useTaskCompletionVersion(["scan", "process_media"]);
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  const hasNewItems = refreshKey !== seenRefreshKey;

  const handleRefresh = () => {
    setSeenRefreshKey(refreshKey);
    // Drop the other sort order's cache too, then reload the visible one.
    clearListsByPrefix(`${listKeyPrefix}-`);
    reload();
  };

  const handleSortMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSortMenuAnchorEl(event.currentTarget);
  };
  const handleSortMenuClose = () => {
    setSortMenuAnchorEl(null);
  };
  const handleSortChange = (newSortOrder: MediaSortOrder) => {
    setSavedSort(newSortOrder);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("sort", newSortOrder);
      return next;
    });
    handleSortMenuClose();
  };

  return (
    <Container
      maxWidth="xl"
      sx={{
        bgcolor: "background.default",
        color: "text.primary",
        minHeight: "100vh",
        py: 2,
      }}
    >
      <Box
        display="flex"
        justifyContent="flex-end"
        alignItems="center"
        gap={1}
        mb={2}
      >
        {hasNewItems && (
          <Chip
            color="primary"
            variant="outlined"
            icon={<RefreshIcon />}
            label="New items — Refresh"
            onClick={handleRefresh}
          />
        )}
        <Button
          onClick={handleSortMenuOpen}
          color="inherit"
          startIcon={<SortIcon />}
          sx={{
            bgcolor: "action.hover",
            borderRadius: 2,
            px: 2,
            color: "text.primary",
          }}
        >
          Sort by: {MEDIA_SORT_LABELS[sortOrder]}
        </Button>
        <Menu
          anchorEl={sortMenuAnchorEl}
          open={Boolean(sortMenuAnchorEl)}
          onClose={handleSortMenuClose}
        >
          <MenuItem
            onClick={() => handleSortChange("newest")}
            selected={sortOrder === "newest"}
          >
            {MEDIA_SORT_LABELS.newest}
          </MenuItem>
          <MenuItem
            onClick={() => handleSortChange("latest")}
            selected={sortOrder === "latest"}
          >
            {MEDIA_SORT_LABELS.latest}
          </MenuItem>
        </Menu>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={reload}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Loading Skeletons */}
      {items.length === 0 && isLoading && (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(3, 1fr)",
              md: "repeat(4, 1fr)",
              lg: "repeat(5, 1fr)",
            },
          }}
        >
          {[...Array(15)].map((_, i) => (
            <Box key={i} sx={{ aspectRatio: "3/4" }}>
              <MediaSkeleton />
            </Box>
          ))}
        </Box>
      )}

      {/* Empty State */}
      {items.length === 0 && !isLoading && !error && (
        <EmptyState
          icon={<SearchOffIcon />}
          title={emptyTitle}
          description={emptyDescription}
        />
      )}

      {items.length > 0 && (
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {items.map((media) => (
            <div key={media.id}>
              <MediaCard media={media} mediaListKey={listKey} />
            </div>
          ))}
        </Masonry>
      )}

      {items.length > 0 && isLoading && (
        <Box textAlign="center" py={3}>
          <CircularProgress sx={{ color: "accent.main" }} />
        </Box>
      )}
      {hasMore && !error && <Box ref={loaderRef} sx={{ height: "10px" }} />}
    </Container>
  );
}
