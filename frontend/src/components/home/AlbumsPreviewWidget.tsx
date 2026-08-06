import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import { Link } from "react-router-dom";
import { API } from "../../config";
import { encodeFilePath } from "../../urlUtils";
import { getAlbums } from "../../services/features";
import { Album } from "../../types";
import { HomeWidgetCard } from "./HomeWidgetCard";

/** Homepage widget: a quick jump-off row of album covers. */
export function AlbumsPreviewWidget() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getAlbums()
      .then((data) => {
        if (alive) setAlbums(data);
      })
      .catch((err) => console.warn("Failed to load albums:", err))
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && albums.length === 0) return null;

  return (
    <HomeWidgetCard
      icon={<PhotoAlbumIcon color="primary" fontSize="small" />}
      title="Albums"
      viewAllTo="/albums"
    >
      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 0.5,
          "&::-webkit-scrollbar": { height: 6 },
        }}
      >
        {albums.map((album) => (
          <Link
            key={album.id}
            to={`/album/${album.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <Box sx={{ width: 140, flexShrink: 0 }}>
              <Box
                sx={{
                  aspectRatio: "4/3",
                  bgcolor: "action.hover",
                  borderRadius: 2,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {album.cover_thumbnail ? (
                  <Box
                    component="img"
                    src={`${API}/thumbnails/${encodeFilePath(
                      album.cover_thumbnail
                    )}`}
                    alt={album.name}
                    loading="lazy"
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <PhotoAlbumIcon color="disabled" sx={{ fontSize: 32 }} />
                )}
              </Box>
              <Typography
                variant="caption"
                fontWeight={600}
                noWrap
                display="block"
                sx={{ mt: 0.5 }}
              >
                {album.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {album.media_count} item{album.media_count === 1 ? "" : "s"}
              </Typography>
            </Box>
          </Link>
        ))}
      </Box>
    </HomeWidgetCard>
  );
}
