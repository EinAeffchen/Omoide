import {
  Box,
  CircularProgress,
  Container,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";
import Masonry from "react-masonry-css";
import { useLocation, useSearchParams } from "react-router-dom";
import MediaCard from "../components/MediaCard";
import PersonCard from "../components/PersonCard";
import TagCard from "../components/TagCard";
import { defaultListState, useListStore } from "../stores/useListStore";
import {
  MediaPreview,
  Person,
  PersonReadSimple,
  SceneSearchResult,
  Tag,
} from "../types";
import { searchCombined, searchScenes, searchTags } from "../services/search";
import SceneResultCard from "../components/SceneResultCard";
import { API } from "../config";

const ITEMS_PER_PAGE = 30;

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 5,
  900: 2,
  600: 2,
};

type MediaFilter = "all" | "image" | "video";

function isMedia(item: MediaPreview | Person | Tag): item is MediaPreview {
  return item && "thumbnail_path" in item;
}
function isTag(item: MediaPreview | Person | Tag): item is Tag {
  return (
    item && !("tags" in item) && "name" in item && !("profile_face" in item)
  );
}
function isVideoMedia(item: MediaPreview): boolean {
  return typeof item.duration === "number";
}

// ---------------------------------------------------------------------------
// Local state shape for the media/combined category
// ---------------------------------------------------------------------------
interface MediaSearchState {
  persons: PersonReadSimple[];
  media: MediaPreview[];
  nextCursor: string | null;
  isLoading: boolean;
  hasMore: boolean;
}

const emptyMediaState: MediaSearchState = {
  persons: [],
  media: [],
  nextCursor: null,
  isLoading: false,
  hasMore: false,
};

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const rawCategory = searchParams.get("category");
  const category: "media" | "tag" | "scene" =
    rawCategory === "tag" || rawCategory === "scene" ? rawCategory : "media";
  const query = searchParams.get("query") || "";
  const location = useLocation();

  // Declare before any effects so closures always see the initialized value
  const preloadedState = location.state as {
    items: (MediaPreview | Person | Tag | SceneSearchResult)[];
    searchType: "image";
  } | null;
  const isImageSearch = preloadedState?.searchType === "image";

  // ---- list-store state (tag + scene categories) -------------------------
  const listKey = useMemo(() => {
    if (category === "media" || !query) return "";
    const params = new URLSearchParams({ query });
    return `${API}/api/search/${category}?${params.toString()}`;
  }, [category, query]);

  const listState = useListStore((state) => state.lists[listKey]);
  const listItems = listState?.items || [];
  const listHasMore = listState?.hasMore ?? defaultListState.hasMore;
  const listIsLoading = listState?.isLoading ?? defaultListState.isLoading;
  const { fetchInitial, loadMore, removeItem } = useListStore();

  // ---- local state for the media/combined category -----------------------
  const [mediaState, setMediaState] = useState<MediaSearchState>(emptyMediaState);
  const activeQueryRef = useRef<string>("");

  // Initial load for the combined (media) category
  useEffect(() => {
    if (category !== "media" || isImageSearch) return;
    if (!query) {
      setMediaState(emptyMediaState);
      return;
    }
    activeQueryRef.current = query;
    setMediaState({ ...emptyMediaState, isLoading: true });
    searchCombined(query, ITEMS_PER_PAGE)
      .then((result) => {
        if (activeQueryRef.current !== query) return;
        setMediaState({
          persons: result.persons ?? [],
          media: result.media ?? [],
          nextCursor: result.next_cursor,
          isLoading: false,
          hasMore: result.next_cursor !== null,
        });
      })
      .catch(() => {
        if (activeQueryRef.current !== query) return;
        setMediaState({ ...emptyMediaState });
      });
  }, [category, query, location.key, isImageSearch]);

  const loadMoreMedia = useCallback(() => {
    if (!mediaState.hasMore || mediaState.isLoading || !mediaState.nextCursor) return;
    const cursor = mediaState.nextCursor;
    setMediaState((prev) => ({ ...prev, isLoading: true }));
    searchCombined(query, ITEMS_PER_PAGE, cursor).then((result) => {
      setMediaState((prev) => ({
        ...prev,
        media: [...prev.media, ...(result.media ?? [])],
        nextCursor: result.next_cursor,
        isLoading: false,
        hasMore: result.next_cursor !== null,
      }));
    });
  }, [mediaState.hasMore, mediaState.isLoading, mediaState.nextCursor, query]);

  // ---- list-store fetch for tag / scene ----------------------------------
  useEffect(() => {
    if (!listKey) return;
    const fetcherMap = {
      tag: () => searchTags(query, ITEMS_PER_PAGE),
      scene: () => searchScenes(query, ITEMS_PER_PAGE),
    } as const;
    const fetcher = fetcherMap[category as "tag" | "scene"];
    if (fetcher) fetchInitial(listKey, fetcher);
  }, [listKey, category, query, fetchInitial, location.key]);

  // ---- infinite scroll ---------------------------------------------------
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  useEffect(() => {
    if (!inView) return;
    if (category === "media") {
      loadMoreMedia();
    } else if (listHasMore && !listIsLoading) {
      const fetcherMap = {
        tag: (cursor?: string) => searchTags(query, ITEMS_PER_PAGE, cursor),
        scene: (cursor?: string) => searchScenes(query, ITEMS_PER_PAGE, cursor),
      } as const;
      const fetcher = fetcherMap[category as "tag" | "scene"];
      if (fetcher) loadMore(listKey, fetcher);
    }
  }, [inView, category, listHasMore, listIsLoading, listKey, query, loadMore, loadMoreMedia]);

  // ---- derive visible items ----------------------------------------------
  const isLoading = category === "media" ? mediaState.isLoading : listIsLoading;
  const hasMore = category === "media" ? mediaState.hasMore : listHasMore;

  const displayItems = (preloadedState?.items || listItems) as (
    | MediaPreview
    | Person
    | Tag
    | SceneSearchResult
  )[];

  const rawMediaItems: MediaPreview[] =
    category === "media"
      ? isImageSearch
        ? (preloadedState?.items?.filter(isMedia) ?? [])
        : mediaState.media
      : [];

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const filteredMediaItems = useMemo(() => {
    if (mediaFilter === "all") return rawMediaItems;
    if (mediaFilter === "video") return rawMediaItems.filter(isVideoMedia);
    return rawMediaItems.filter((i) => !isVideoMedia(i));
  }, [mediaFilter, rawMediaItems]);

  const navigationContext = useMemo(
    () =>
      category === "media"
        ? { ids: filteredMediaItems.map((i) => i.id) }
        : undefined,
    [category, filteredMediaItems]
  );

  const visibleItems: (MediaPreview | Person | Tag | SceneSearchResult)[] =
    category === "media" ? filteredMediaItems : displayItems;

  const hasResults = visibleItems.length > 0;
  const shouldShowWarmup =
    !hasResults && isLoading && (category === "media" || category === "scene");

  const [showModelWarmup, setShowModelWarmup] = useState(false);
  useEffect(() => {
    setShowModelWarmup(false);
    if (!shouldShowWarmup) return;
    const timer = window.setTimeout(() => setShowModelWarmup(true), 700);
    return () => window.clearTimeout(timer);
  }, [shouldShowWarmup, listKey, query]);

  // ---- render ------------------------------------------------------------
  const title = isImageSearch
    ? "Similar Image Results"
    : `Search Results for "${query}"`;

  const handleTagDeleted = (tagId: number) => removeItem(listKey, tagId);

  const renderItem = (
    item: MediaPreview | Person | Tag | SceneSearchResult
  ) => {
    const itemKey =
      category === "scene"
        ? `scene-${(item as SceneSearchResult).scene_id}`
        : `${category}-${(item as MediaPreview | Person | Tag).id}`;

    if (isMedia(item)) {
      return (
        <div key={itemKey}>
          <MediaCard
            media={item}
            mediaListKey={listKey}
            navigationContext={navigationContext}
          />
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
    if (category === "scene") {
      return (
        <div key={itemKey}>
          <SceneResultCard scene={item as SceneSearchResult} listKey={listKey} />
        </div>
      );
    }
    return null;
  };

  return (
    <Container maxWidth="xl" sx={{ pt: 4, pb: 6 }}>
      <Typography variant="h4" gutterBottom>
        {title}
      </Typography>

      {category === "media" && (
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mediaFilter}
            onChange={(_, next) => { if (next) setMediaFilter(next); }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="image">Images</ToggleButton>
            <ToggleButton value="video">Videos</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {showModelWarmup && (
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2, color: "text.secondary" }}>
          <CircularProgress size={20} />
          <Typography>
            Warming up AI models for search. The first search can take a minute.
          </Typography>
        </Box>
      )}

      {/* Person strip — shown on first page of media searches when names are detected */}
      {category === "media" && !isImageSearch && mediaState.persons.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", mb: 1, fontWeight: 700 }}
          >
            People
          </Typography>
          <Box
            sx={{
              display: "flex",
              gap: 2,
              overflowX: "auto",
              pb: 1,
              "&::-webkit-scrollbar": { height: 4 },
              "&::-webkit-scrollbar-thumb": { borderRadius: 2, bgcolor: "divider" },
            }}
          >
            {mediaState.persons.map((person) => (
              <Box key={person.id} sx={{ width: 130, flexShrink: 0 }}>
                <PersonCard person={person} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {visibleItems.map(renderItem)}
      </Masonry>

      {isLoading && (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !isLoading && <Box ref={loaderRef} sx={{ height: "1px" }} />}
      {!isLoading && visibleItems.length === 0 && (
        <Typography sx={{ mt: 4 }}>No results found.</Typography>
      )}
    </Container>
  );
}
