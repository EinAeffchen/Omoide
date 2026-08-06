import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import { Link, useLocation } from "react-router-dom";
import { API } from "../../config";
import { encodeFilePath } from "../../urlUtils";
import { getHighlightYears, getHighlights } from "../../services/features";
import { Media } from "../../types";
import { HomeWidgetCard } from "./HomeWidgetCard";

const thumbUrl = (media: Media) =>
  media.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(media.thumbnail_path)}`
    : `${API}/thumbnails/${media.id}.jpg`;

/** Homepage widget: best-of picks from the most recent highlighted year. */
export function HighlightsStripWidget() {
  const [items, setItems] = useState<Media[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    getHighlightYears()
      .then((years) => {
        if (!alive || years.length === 0) return undefined;
        const latest = years[0].year;
        setYear(latest);
        return getHighlights(latest, 20).then((media) => {
          if (alive) setItems(media);
        });
      })
      .catch((err) => console.warn("Failed to load highlights:", err))
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
      icon={<StarIcon color="primary" fontSize="small" />}
      title={year ? `Highlights of ${year}` : "Highlights"}
      viewAllTo="/highlights"
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
