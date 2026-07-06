import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import { useInView } from "react-intersection-observer";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Typography,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import MediaCard from "../components/MediaCard";
import PersonCard from "../components/PersonCard";
import { Tag, Media, Person } from "../types";
import { getTag } from "../services/tag";
import { getMediaList } from "../services/media";
import { useListStore, defaultListState } from "../stores/useListStore";

const BG_SECTION = "background.default";
const TEXT_PRIMARY = "text.primary";
const ACCENT = "accent.main";

type MediaFilter = "all" | "image" | "video";

export default function TagDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tag, setTag] = useState<Tag | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setTag(null);
    setTagError(null);
    getTag(id)
      .then((tagData) => {
        if (!cancelled) setTag(tagData);
      })
      .catch((error) => {
        if (!cancelled) {
          setTagError(
            error instanceof Error ? error.message : "Failed to load tag"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, retryTick]);

  const tagName = tag?.name ?? null;
  const listKey = tagName ? `tag-media-${tagName}` : "";
  const listState = useListStore((state) =>
    listKey ? state.lists[listKey] : undefined
  );
  const mediaItems = listState?.items ?? defaultListState.items;
  const hasMore = listState?.hasMore ?? defaultListState.hasMore;
  const isLoading = listState?.isLoading ?? defaultListState.isLoading;
  const listError = listState?.error ?? defaultListState.error;
  const { fetchInitial, loadMore, clearList } = useListStore();

  useEffect(() => {
    if (!tagName || !listKey) return;
    fetchInitial(listKey, () => getMediaList(null, "newest", [tagName]));
  }, [tagName, listKey, fetchInitial]);

  useEffect(() => {
    if (!tagName || !listKey) return;
    if (inView && hasMore && !isLoading && !listError) {
      loadMore(listKey, (cursor) =>
        getMediaList(cursor ?? null, "newest", [tagName])
      );
    }
  }, [inView, hasMore, isLoading, listError, listKey, loadMore, tagName]);

  const filteredMediaItems = useMemo(() => {
    const items = mediaItems as Media[];
    if (mediaFilter === "all") return items;
    if (mediaFilter === "video") {
      return items.filter((item) => typeof item.duration === "number");
    }
    return items.filter((item) => typeof item.duration !== "number");
  }, [mediaFilter, mediaItems]);
  const mediaIds = useMemo(
    () => filteredMediaItems.map((m) => m.id),
    [filteredMediaItems]
  );

  if (tagError) {
    return (
      <Box
        p={4}
        display="flex"
        flexDirection="column"
        alignItems="center"
        gap={2}
      >
        <Alert severity="error">{tagError}</Alert>
        <Button variant="contained" onClick={() => setRetryTick((t) => t + 1)}>
          Retry
        </Button>
      </Box>
    );
  }

  if (!tag) {
    return (
      <Box p={4} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container
      maxWidth="lg"
      sx={{ pt: 4, pb: 6, bgcolor: BG_SECTION, minHeight: "100vh" }}
    >
      <Typography variant="h4" gutterBottom sx={{ color: ACCENT }}>
        Tag: #{tag.name}
      </Typography>

      {/* Media Section */}
      <Box mb={6}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 2,
            mb: 2,
          }}
        >
          <Typography variant="h5" sx={{ color: TEXT_PRIMARY }}>
            Media
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mediaFilter}
            onChange={(_, next) => {
              if (next) setMediaFilter(next);
            }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="image">Images</ToggleButton>
            <ToggleButton value="video">Videos</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {listError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  clearList(listKey);
                  fetchInitial(listKey, () =>
                    getMediaList(null, "newest", [tag.name])
                  );
                }}
              >
                Retry
              </Button>
            }
          >
            {listError}
          </Alert>
        )}
        <Grid container spacing={2}>
          {filteredMediaItems.map((m: Media) => (
            <Grid key={m.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <MediaCard media={m} mediaListKey={listKey} navigationContext={{ ids: mediaIds }} />
            </Grid>
          ))}
        </Grid>
        {isLoading && (
          <Box textAlign="center" py={3}>
            <CircularProgress />
          </Box>
        )}
        {!isLoading && !listError && filteredMediaItems.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No media with this tag.
          </Typography>
        )}
        {hasMore && !listError && (
          <Box ref={loaderRef} sx={{ height: "10px" }} />
        )}
      </Box>

      {/* People Section */}
      <Box>
        <Typography variant="h5" gutterBottom sx={{ color: TEXT_PRIMARY }}>
          People
        </Typography>
        <Grid container spacing={2}>
          {(tag.persons ?? []).map((p: Person) => (
            <Grid key={p.id} size={{ xs: 6, sm: 4, md: 3, lg: 2.4 }}>
              <Box
                component={RouterLink}
                to={`/person/${p.id}`}
                sx={{ textDecoration: "none" }}
              >
                <PersonCard person={p} />
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Container>
  );
}
