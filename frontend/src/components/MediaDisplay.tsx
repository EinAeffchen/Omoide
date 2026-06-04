import { useState } from "react";
import { Box, Paper } from "@mui/material";
import { VideoWithPreview } from "./VideoPlayer";
import { ImageLightbox } from "./ImageLightbox";
import { Media } from "../types";
import { API } from "../config";

interface MediaDisplayProps {
  media: Media;
  initialTime?: number | null;
  autoplay?: boolean;
  seekRequest?: { time: number; seq: number } | null;
  onProgress?: (playedSeconds: number) => void;
}

export function MediaDisplay({ media, initialTime, autoplay, seekRequest, onProgress }: MediaDisplayProps) {
  const mediaUrl = media ? `${API}/originals/${media.path}` : `${API}/static/brand/404.png`;
  const filename = media ? media.filename : "404 Not found";
  const isVideo = typeof media?.duration === "number";
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
            autoplay={autoplay}
            seekRequest={seekRequest}
            onProgress={onProgress}
          />
        ) : (
          <Box
            component="img"
            src={mediaUrl}
            alt={filename}
            onClick={() => setLightboxOpen(true)}
            sx={{
              width: "100%",
              height: "auto",
              maxHeight: { xs: "100vh", sm: "80vh" },
              objectFit: "contain",
              display: "block",
              cursor: "zoom-in",
            }}
          />
        )}
      </Paper>

      {!isVideo && (
        <ImageLightbox
          open={lightboxOpen}
          src={mediaUrl}
          alt={filename}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </Box>
  );
}
