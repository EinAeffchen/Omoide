import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { useEffect, useMemo, useState } from "react";
import Masonry from "react-masonry-css";
import {
  useLocation,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import MediaCard from "../components/MediaCard";
import PersonCard from "../components/PersonCard";
import {
  PERSON_GRID_SIZES,
  PersonThumbSizeToggle,
  usePersonThumbSize,
} from "../components/PersonThumbSize";
import TagCard from "../components/TagCard";
import { useListStore } from "../stores/useListStore";
import { usePagedList } from "../hooks/usePagedList";
import {
  MediaPreview,
  Person,
  PersonReadSimple,
  SceneSearchResult,
  Tag,
} from "../types";
import {
  searchCombined,
  searchPersons,
  searchScenes,
  searchTags,
} from "../services/search";
import SceneResultCard from "../components/SceneResultCard";
import { API } from "../config";
import { useLocalStoragePreference } from "../hooks/useLocalStoragePreference";

const ITEMS_PER_PAGE = 30;

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 3,
  900: 2,
  600: 2,
};

type MediaFilter = "all" | "image" | "video";
type ListCategory = "person" | "tag" | "scene";

type ResultItem = MediaPreview | Person | Tag | SceneSearchResult;

function isMedia(item: ResultItem): item is MediaPreview {
  return item && "thumbnail_path" in item;
}
function isTag(item: ResultItem): item is Tag {
  return (
    item && !("tags" in item) && "name" in item && !("profile_face" in item)
  );
}
function isVideoMedia(item: MediaPreview): boolean {
  return typeof item.duration === "number";
}

type SearchItem = MediaPreview | PersonReadSimple | Tag | SceneSearchResult;

// Persons matched by name come only with the first page of a combined media
// search. Kept per list key so a cached (back-navigated) list still shows them.
const firstPagePersons = new Map<string, PersonReadSimple[]>();

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const rawCategory = searchParams.get("category");
  const category: "media" | ListCategory =
    rawCategory === "person" || rawCategory === "tag" || rawCategory === "scene"
      ? rawCategory
      : "media";
  const query = searchParams.get("query") || "";
  const location = useLocation();
  const navigationType = useNavigationType();

  // Declare before any effects so closures always see the initialized value
  const preloadedState = location.state as {
    items: ResultItem[];
    searchType: "image";
  } | null;
  const isImageSearch = preloadedState?.searchType === "image";

  const [orderBy, setOrderBy] = useLocalStoragePreference(
    "searchOrderBy",
    ["relevance", "date"] as const,
    "relevance"
  );

  // One cached list per category/query (and sort order for media). Image
  // searches arrive preloaded via location state and fetch nothing.
  const listKey = useMemo(() => {
    if (!query) return "";
    if (category === "media") {
      if (isImageSearch) return "";
      const params = new URLSearchParams({ query, order_by: orderBy });
      return `${API}/api/search/combined?${params.toString()}`;
    }
    const params = new URLSearchParams({ query });
    return `${API}/api/search/${category}?${params.toString()}`;
  }, [category, query, isImageSearch, orderBy]);

  const {
    items: listItems,
    hasMore: listHasMore,
    isLoading: listIsLoading,
    error: listError,
    loaderRef,
    reload,
    removeItems,
  } = usePagedList<SearchItem>(
    listKey,
    async (cursor, signal) => {
      const pageCursor = cursor ?? undefined;
      switch (category) {
        case "media": {
          const result = await searchCombined(
            query,
            ITEMS_PER_PAGE,
            pageCursor,
            orderBy,
            signal
          );
          if (cursor === null && !signal.aborted) {
            firstPagePersons.set(listKey, result.persons ?? []);
          }
          return { items: result.media ?? [], next_cursor: result.next_cursor };
        }
        case "person":
          return searchPersons(query, ITEMS_PER_PAGE, pageCursor, signal);
        case "tag":
          return searchTags(query, ITEMS_PER_PAGE, pageCursor, signal);
        case "scene":
          return searchScenes(query, ITEMS_PER_PAGE, pageCursor, signal);
      }
    },
    { enabled: listKey !== "" }
  );

  // A new media search (not a history back/forward) always re-runs the query
  // instead of showing a previously cached result.
  const isFreshNavigation = navigationType !== "POP";
  useEffect(() => {
    if (category !== "media" || !listKey || !isFreshNavigation) return;
    const cached = useListStore.getState().lists[listKey];
    if (cached && !cached.isLoading && cached.items.length > 0) reload();
    // Only on entering the page / a new navigation, not on sort changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // ---- derive visible items ----------------------------------------------
  const isLoading = listKey !== "" && listIsLoading;
  const hasMore = listKey !== "" && listHasMore;
  const persons =
    category === "media" && listKey ? firstPagePersons.get(listKey) ?? [] : [];

  const displayItems = (preloadedState?.items || listItems) as ResultItem[];

  const rawMediaItems = useMemo<MediaPreview[]>(
    () =>
      category === "media"
        ? isImageSearch
          ? (preloadedState?.items?.filter(isMedia) ?? [])
          : (listItems as MediaPreview[])
        : [],
    [category, isImageSearch, preloadedState, listItems]
  );

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [thumbSize, setThumbSize] = usePersonThumbSize();
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

  const visibleItems: ResultItem[] =
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

  const handleTagDeleted = (tagId: number) => removeItems([tagId]);

  const renderItem = (item: ResultItem) => {
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
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
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

          {!isImageSearch && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={orderBy}
              onChange={(_, next) => { if (next) setOrderBy(next); }}
            >
              <ToggleButton value="relevance">Relevance</ToggleButton>
              <ToggleButton value="date">Newest first</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
      )}

      {listError && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={reload}
            >
              Retry
            </Button>
          }
        >
          Search failed. Please try again.
        </Alert>
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
      {category === "media" && !isImageSearch && persons.length > 0 && (
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
            {persons.map((person) => (
              <Box key={person.id} sx={{ width: 130, flexShrink: 0 }}>
                <PersonCard person={person} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {category === "person" ? (
        <>
          {hasResults && (
            <Box sx={{ mb: 3 }}>
              <PersonThumbSizeToggle value={thumbSize} onChange={setThumbSize} />
            </Box>
          )}
          <Grid container spacing={3} alignItems="stretch">
            {(visibleItems as PersonReadSimple[]).map((person) => (
              <Grid key={`person-${person.id}`} size={PERSON_GRID_SIZES[thumbSize]}>
                <PersonCard person={person} size={thumbSize} />
              </Grid>
            ))}
          </Grid>
        </>
      ) : (
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {visibleItems.map(renderItem)}
        </Masonry>
      )}

      {isLoading && (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !isLoading && !listError && (
        <Box ref={loaderRef} sx={{ height: "1px" }} />
      )}
      {!isLoading &&
        visibleItems.length === 0 &&
        !listError && (
          <Typography sx={{ mt: 4 }}>No results found.</Typography>
        )}
    </Container>
  );
}
