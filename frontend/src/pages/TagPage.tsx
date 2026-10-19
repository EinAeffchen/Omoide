import { Container, Typography, Box, CircularProgress } from "@mui/material";
import Grid from "@mui/material/Grid";

import TagCard from "../components/TagCard";
import { usePagedList } from "../hooks/usePagedList";
import { getTags } from "../services/tag";
import { Tag } from "../types";

export default function TagsPage() {
  const listKey = "tags-all";

  const { items, hasMore, isLoading, error, loaderRef, removeItems } =
    usePagedList<Tag>(listKey, (cursor, signal) => getTags(cursor, signal));

  const handleTagDeleted = (deletedTagId: number) => {
    removeItems([deletedTagId]);
  };
  return (
    <Container maxWidth="lg" sx={{ pt: 4, pb: 6 }}>
      <Typography variant="h4" gutterBottom>
        Tags
      </Typography>

      <Grid container spacing={4}>
        {items.map((tag) => (
          <Grid key={tag.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            {/* 1,2,3,4 per row */}
            <TagCard tag={tag} onTagDeleted={handleTagDeleted} />
          </Grid>
        ))}
      </Grid>

      {isLoading && (
        <Box textAlign="center" py={4}>
          <CircularProgress color="secondary" />
        </Box>
      )}

      {!isLoading && hasMore && !error && (
        <Box
          ref={loaderRef}
          textAlign="center"
          py={2}
          sx={{ color: "text.secondary" }}
        >
          Scroll to load more…
        </Box>
      )}
    </Container>
  );
}
