import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container,
  Box,
  Typography,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import MediaCard from "../components/MediaCard";
import PersonCard from "../components/PersonCard";
import { Tag, Media, Person } from "../types";
import { getTag } from "../services/tag";
import { useListStore, defaultListState } from "../stores/useListStore";

const BG_SECTION = "background.default";
const TEXT_PRIMARY = "text.primary";
const ACCENT = "accent.main";

type MediaFilter = "all" | "image" | "video";

export default function TagDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tag, setTag] = useState<Tag | null>(null);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");

  const listKey = useMemo(() => `tag-${id}-media`, [id]);
  const { items: mediaItems } = useListStore(
    (state) => state.lists[listKey] || defaultListState
  );
  const { fetchInitial, clearList } = useListStore();

  useEffect(() => {
    if (!id) return;
    clearList(listKey);
    fetchInitial(listKey, async () => {
      const tagData = await getTag(id);
      setTag(tagData);
      return { items: tagData.media ?? [], next_cursor: null };
    });
  }, [id, listKey, fetchInitial, clearList]);

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

  if (!tag) {
    return (
      <Box p={4} textAlign="center">
        <Typography color="text.secondary">Loading…</Typography>
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
        <Grid container spacing={2}>
          {filteredMediaItems.map((m: Media) => (
            <Grid key={m.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <MediaCard media={m} mediaListKey={listKey} navigationContext={{ ids: mediaIds }} />
            </Grid>
          ))}
        </Grid>
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
