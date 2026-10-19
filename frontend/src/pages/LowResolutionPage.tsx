import { useMemo, useState } from "react";
import { Box, Slider, Typography } from "@mui/material";
import PhotoSizeSelectSmallIcon from "@mui/icons-material/PhotoSizeSelectSmall";

import { ReviewPage } from "../components/ReviewPage";
import { formatBytes } from "../formatUtils";
import { LowResMediaItem } from "../types";
import { useLocalStorageNumber } from "../hooks/useLocalStoragePreference";

const DEFAULT_MAX_MP = 1.0;
const MP_MARKS = [
  { value: 0.1, label: "0.1" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 5, label: "5 MP" },
];

const formatMp = (pixels: number) => {
  const mp = pixels / 1_000_000;
  return mp < 1 ? `${(mp * 1000).toFixed(0)} kP` : `${mp.toFixed(2)} MP`;
};

export default function LowResolutionPage() {
  const [maxMp, setMaxMp] = useLocalStorageNumber(
    "reviewLowResMaxMp",
    DEFAULT_MAX_MP,
    { min: 0.1, max: 5 }
  );
  const [pendingMp, setPendingMp] = useState(maxMp);
  const filters = useMemo(
    () => ({ max_pixels: Math.round(maxMp * 1_000_000) }),
    [maxMp]
  );

  return (
    <ReviewPage<LowResMediaItem>
      endpoint="/api/lowresolution"
      title="Low Resolution"
      description="Media whose pixel count (width × height) is below the threshold. Sorted lowest-resolution first. Useful for finding thumbnails, corrupt imports, and low-quality duplicates."
      filters={filters}
      controls={
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom id="lowres-max">
            Max resolution: <strong>{pendingMp.toFixed(pendingMp < 1 ? 2 : 1)} MP</strong>{" "}
            ({Math.round(pendingMp * 1_000_000).toLocaleString()} px)
          </Typography>
          <Slider
            aria-labelledby="lowres-max"
            value={pendingMp}
            onChange={(_, v) => setPendingMp(v as number)}
            onChangeCommitted={(_, v) => setMaxMp(v as number)}
            min={0.1}
            max={5}
            step={0.1}
            marks={MP_MARKS}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v.toFixed(1)} MP`}
            sx={{ maxWidth: 480 }}
          />
        </Box>
      }
      statsText={(total) =>
        `${total.toLocaleString()} item${total !== 1 ? "s" : ""} under ${maxMp.toFixed(1)} MP`
      }
      emptyIcon={<PhotoSizeSelectSmallIcon />}
      emptyText={() => `No media below ${maxMp.toFixed(1)} MP.`}
      badge={(item) => ({ label: formatMp(item.pixel_count), color: "warning" })}
      caption={(item) =>
        `${item.width}×${item.height}${item.duration != null ? " · video" : ""} · ${formatBytes(item.size)}`
      }
    />
  );
}
