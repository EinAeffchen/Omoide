import React, { useEffect, useState, useMemo } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { Media } from "../types";
import MediaCard from "./MediaCard";
import { getSimilarMedia } from "../services/media";

export default function SimilarContent({ mediaId }: { mediaId: number }) {
  const [similar, setSimilar] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const similarIds = useMemo(() => similar.map((item) => item.id), [similar]);

  useEffect(() => {
    if (!mediaId) return;
    const controller = new AbortController();
    const { signal } = controller;

    // Reset stale results from the previously shown media
    setSimilar([]);
    setIsLoading(true);
    getSimilarMedia(mediaId, signal)
      .then((items) => {
        if (!signal.aborted) setSimilar(items);
      })
      .catch((err) => {
        // When the fetch is aborted, it throws an error. We can safely ignore it.
        if (!signal.aborted && err.name !== "AbortError") {
          console.error(err);
        }
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [mediaId]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={3}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (similar.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No similar content found.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Similar Content
      </Typography>

      <Box
        sx={{
          columnCount: { xs: 2, sm: 2, md: 3 },
          columnGap: (theme) => theme.spacing(2),
        }}
      >
        {similar.map((item) => (
          <Box
            key={item.id}
            sx={{
              breakInside: "avoid",
              mb: 2,
            }}
          >
            <MediaCard media={item} navigationContext={{ ids: similarIds }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
