import React, { useEffect, useState } from "react";
import Masonry from "react-masonry-css";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import MediaCard from "../components/MediaCard";
import { EmptyState } from "../components/EmptyState";
import { getHighlights, getHighlightYears } from "../services/features";
import { HighlightYear, Media } from "../types";

const breakpointColumnsObj = {
  default: 5,
  1600: 4,
  1200: 3,
  900: 3,
  600: 2,
};

export default function HighlightsPage() {
  const [years, setYears] = useState<HighlightYear[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [items, setItems] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHighlightYears()
      .then((data) => {
        setYears(data);
        if (data.length > 0) setYear(data[0].year);
        else setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load years");
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (year === null) return;
    setIsLoading(true);
    setError(null);
    getHighlights(year)
      .then(setItems)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load highlights"
        )
      )
      .finally(() => setIsLoading(false));
  }, [year]);

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <StarIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Highlights
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        The best of each year, picked from favorites, faces, sharpness and
        views.
      </Typography>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
        {years.map((y) => (
          <Chip
            key={y.year}
            label={y.year}
            clickable
            color={y.year === year ? "primary" : "default"}
            onClick={() => setYear(y.year)}
          />
        ))}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box textAlign="center" py={6}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 && !error ? (
        <EmptyState
          icon={<StarIcon />}
          title="No highlights"
          description="Scan and process some media first."
        />
      ) : (
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {items.map((media) => (
            <div key={media.id}>
              <MediaCard media={media} mediaListKey={`highlights-${year}`} />
            </div>
          ))}
        </Masonry>
      )}
    </Container>
  );
}
