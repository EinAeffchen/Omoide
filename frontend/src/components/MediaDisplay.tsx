import React from "react";
import { Box, Paper } from "@mui/material";
import { VideoWithPreview } from "./VideoPlayer";
import { Media } from "../types";
import { API } from "../config";
interface MediaDisplayProps {
  media: Media;
  initialTime?: number | null;
}

export function MediaDisplay({ media, initialTime }: MediaDisplayProps) {
  const mediaUrl = (media) ? `${API}/originals/${media.path}` : `${API}/static/brand/404.png`;
  const filename = (media) ? media.filename : "404 Not found";
  const isVideo = typeof media?.duration === "number";
  
  return (
    <Box display="flex" justifyContent="center" mb={2} sx={{ width: "100%" }}>
      <Paper
        elevation={4}
        sx={{
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
          borderRadius: { xs: 0, sm: 2 },
          bgcolor: "background.paper",
          boxShadow: { xs: "none", sm: 4 },
        }}
      >
        {media && isVideo ? (
          <VideoWithPreview
            key={media.id}
            media={media}
            initialTime={initialTime ?? undefined}
          />
        ) : (
          <Box
            component="img"
            src={mediaUrl}
            alt={filename}
            sx={{
              width: "100%",
              height: "auto",
              maxHeight: { xs: "100vh", sm: "80vh" },
              objectFit: "contain",
              display: "block",
            }}
          />
        )}
      </Paper>
    </Box>
  );
}
