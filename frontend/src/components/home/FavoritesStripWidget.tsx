import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { Link, useLocation } from "react-router-dom";
import { API } from "../../config";
import { encodeFilePath } from "../../urlUtils";
import { getFavorites } from "../../services/media";
import { Media } from "../../types";
import { HomeWidgetCard } from "./HomeWidgetCard";

const thumbUrl = (media: Media) =>
  media.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(media.thumbnail_path)}`
    : `${API}/thumbnails/${media.id}.jpg`;

/** Homepage widget: a strip of favorited photos/videos. Hides itself when empty. */
export function FavoritesStripWidget() {
  const [items, setItems] = useState<Media[]>([]);
  const [loaded, setLoaded] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    getFavorites(null, "newest")
      .then((page) => {
        if (alive) setItems(page.items);
      })
      .catch((err) => console.warn("Failed to load favorites:", err))
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && items.length === 0) return null;

  return (
    <HomeWidgetCard
      icon={<FavoriteIcon color="error" fontSize="small" />}
      title="Favorites"
      viewAllTo="/favorites"
    >
      <Box
        sx={{
          display: "flex",
          gap: 1,
          overflowX: "auto",
          pb: 0.5,
          "&::-webkit-scrollbar": { height: 6 },
        }}
      >
        {items.map((media) => (
          <Link
            key={media.id}
            to={`/medium/${media.id}`}
            state={{ backgroundLocation: location }}
          >
            <Box
              component="img"
              src={thumbUrl(media)}
              alt={media.filename}
              loading="lazy"
              sx={{
                height: 120,
                width: "auto",
                minWidth: 80,
                objectFit: "cover",
                borderRadius: 2,
                display: "block",
                flexShrink: 0,
                transition: "transform 0.15s",
                "&:hover": { transform: "scale(1.03)" },
              }}
            />
          </Link>
        ))}
      </Box>
    </HomeWidgetCard>
  );
}
