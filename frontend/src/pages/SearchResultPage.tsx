import { Box, CircularProgress, Container, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { useInView } from "react-intersection-observer";
import Masonry from "react-masonry-css";
import { useLocation, useSearchParams } from "react-router-dom";
import MediaCard from "../components/MediaCard";
import PersonCard from "../components/PersonCard";
import TagCard from "../components/TagCard";
import { defaultListState, useListStore } from "../stores/useListStore";
import { Media, MediaPreview, Person, Tag } from "../types";
import { searchMedia, searchPeople, searchTags } from "../services/search";
import { API } from "../config";

const ITEMS_PER_PAGE = 30;

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 5,
  900: 2,
  600: 2,
};

function isMedia(item: MediaPreview | Person | Tag): item is MediaPreview {
  return item && "thumbnail_path" in item;
}
function isPerson(item: MediaPreview | Person | Tag): item is Person {
  return item && "profile_face" in item;
}
function isTag(item: MediaPreview | Person | Tag): item is Tag {
  return (
    item && !("tags" in item) && "name" in item && !("profile_face" in item)
  );
}

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const category =
    (searchParams.get("category") as "media" | "person" | "tag") || "media";
  const query = searchParams.get("query") || "";
  const location = useLocation();

  const listKey = useMemo(() => {
    if (!query || !category) return "";
    const params = new URLSearchParams({ query });
    return `${API}/api/search/${category}?${params.toString()}`;
  }, [category, query]);

  const listState = useListStore((state) => state.lists[listKey]);
  const items = listState?.items || [];
  const hasMore = listState?.hasMore || defaultListState.hasMore;
  const isLoading = listState?.isLoading || defaultListState.isLoading;
  const { fetchInitial, loadMore, removeItem } = useListStore();
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      const fetcherMap = {
        media: (cursor?: string) => searchMedia(query, ITEMS_PER_PAGE, cursor),
        person: (cursor?: string) =>
          searchPeople(query, ITEMS_PER_PAGE, cursor),
        tag: (cursor?: string) => searchTags(query, ITEMS_PER_PAGE, cursor),
      };
      const fetcher = fetcherMap[category];
      if (fetcher) {
        loadMore(listKey, fetcher);
      }
    }
  }, [inView, hasMore, isLoading, listKey, category, query, loadMore]);

  useEffect(() => {
    if (!listKey) return;

    const fetcherMap = {
      media: () => searchMedia(query, ITEMS_PER_PAGE),
      person: () => searchPeople(query, ITEMS_PER_PAGE),
      tag: () => searchTags(query, ITEMS_PER_PAGE),
    };

    const fetcher = fetcherMap[category];
    if (fetcher) {
      // We depend on location.key to ensure that navigating triggers a re-evaluation
      // of this effect, which in turn calls fetchInitial. The store's internal logic
      // will then decide whether to actually make a network request.
      fetchInitial(listKey, fetcher);
    }
  }, [listKey, category, query, fetchInitial, location.key]);

  const preloadedState = location.state as {
    items: MediaPreview[] | Person[] | Tag[];
    searchType: "image";
  } | null;
  const displayItems = preloadedState?.items || items;

  const renderItem = (item: Media | Person | Tag) => {
    const itemKey = `${category}-${item.id}`;

    if (isMedia(item)) {
      return (
        <div key={itemKey}>
          <MediaCard media={item} mediaListKey={listKey} />
        </div>
      );
    }
    if (isPerson(item)) {
      return (
        <div key={itemKey}>
          <PersonCard person={item} />
        </div>
      );
    }
    if (isTag(item)) {
      return (
        <div key={itemKey}>
          <TagCard onTagDeleted={handleTagDeleted} tag={item} />
        </div>
      );
    }
    return null;
  };

  const title =
    preloadedState?.searchType === "image"
      ? "Similar Image Results"
      : `Search Results for "${query}"`;

  const handleTagDeleted = (tagId: number) => {
    removeItem(listKey, tagId);
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Typography variant="h4" gutterBottom>
        {title}
      </Typography>

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {displayItems.map(renderItem)}
      </Masonry>

      {isLoading && (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !isLoading && <Box ref={loaderRef} sx={{ height: "1px" }} />}
      {!isLoading && displayItems.length === 0 && (
        <Typography sx={{ mt: 4 }}>No results found.</Typography>
      )}
    </Container>
  );
}
