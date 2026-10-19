import React, { useEffect, useRef } from "react";
import Masonry from "react-masonry-css";
import { Alert, Box, CircularProgress } from "@mui/material";
import MediaCard from "./MediaCard";
import { usePagedList } from "../hooks/usePagedList";
import { PageFetcher } from "../stores/useListStore";
import { Media } from "../types";

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 3,
  900: 3,
  600: 2,
};

interface Props {
  /** Cache key of the list; media cards use it for prev/next navigation. */
  listKey: string;
  fetcher: PageFetcher<Media>;
  empty?: React.ReactNode;
  /** Changing this value reloads the list from the first page. */
  refreshToken?: unknown;
}

/** Cursor-paginated masonry grid of media, backed by the list store. */
export function CursorMediaGrid({ listKey, fetcher, empty, refreshToken }: Props) {
  const { items, hasMore, isLoading, error, loaderRef, reload } =
    usePagedList<Media>(listKey, fetcher, { refetchOnMount: true });

  const seenToken = useRef(refreshToken);
  useEffect(() => {
    if (seenToken.current === refreshToken) return;
    seenToken.current = refreshToken;
    reload();
  }, [refreshToken, reload]);

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {items.length === 0 && !isLoading && !error && empty}
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
      {isLoading && (
        <Box textAlign="center" py={3}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !error && <Box ref={loaderRef} sx={{ height: 10 }} />}
    </>
  );
}
