import { useEffect, useMemo, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
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
import { Tag, Media, Person, PersonReadSimple } from "../types";
import { isAbortError } from "../services/api";
import { getTag } from "../services/tag";
import { getMediaList } from "../services/media";
import { usePagedList } from "../hooks/usePagedList";

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

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setTag(null);
    setTagError(null);
    getTag(id, controller.signal)
      .then(setTag)
      .catch((error) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setTagError(
          error instanceof Error ? error.message : "Failed to load tag"
        );
      });
    return () => controller.abort();
  }, [id, retryTick]);

  const tagName = tag?.name ?? null;
  const listKey = tagName ? `tag-media-${tagName}` : "";
  const {
    items: mediaItems,
    hasMore,
    isLoading,
    error: listError,
    loaderRef,
    reload,
  } = usePagedList<Media>(
    listKey,
    (cursor, signal) =>
      getMediaList(cursor, "newest", [tagName ?? ""], null, true, null, signal),
    { enabled: tagName !== null }
  );

  const filteredMediaItems = useMemo(() => {
    if (mediaFilter === "all") return mediaItems;
    if (mediaFilter === "video") {
      return mediaItems.filter((item) => typeof item.duration === "number");
    }
    return mediaItems.filter((item) => typeof item.duration !== "number");
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
                onClick={reload}
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
                <PersonCard person={p as PersonReadSimple} />
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Container>
  );
}
