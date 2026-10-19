import { useMemo, useState } from "react";
import { Box, Slider, Typography } from "@mui/material";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";

import { ReviewPage } from "../components/ReviewPage";
import { formatBytes } from "../formatUtils";
import { ShortVideoItem } from "../types";
import { useLocalStorageNumber } from "../hooks/useLocalStoragePreference";

const DEFAULT_MAX_DURATION = 10;

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(0).padStart(2, "0");
  return `${m}:${s}`;
};

export default function ShortVideosPage() {
  const [maxDuration, setMaxDuration] = useLocalStorageNumber(
    "reviewShortVideoMaxSeconds",
    DEFAULT_MAX_DURATION,
    { min: 1, max: 120 }
  );
  const [pendingDuration, setPendingDuration] = useState(maxDuration);
  const filters = useMemo(() => ({ max_duration: maxDuration }), [maxDuration]);

  return (
    <ReviewPage<ShortVideoItem>
      endpoint="/api/shortvideos"
      title="Short Videos"
      description="Videos shorter than the threshold duration. Useful for finding accidental recordings, boomerangs, or animated clips that may not be worth keeping. Sorted shortest-first."
      filters={filters}
      mediaTypeFilter={false}
      controls={
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom id="shortvideos-duration">
            Max duration: <strong>{formatDuration(pendingDuration)}</strong>
          </Typography>
          <Slider
            aria-labelledby="shortvideos-duration"
            value={pendingDuration}
            onChange={(_, v) => setPendingDuration(v as number)}
            onChangeCommitted={(_, v) => setMaxDuration(v as number)}
            min={1}
            max={120}
            step={1}
            marks={[
              { value: 5, label: "5s" },
              { value: 10, label: "10s" },
              { value: 30, label: "30s" },
              { value: 60, label: "1m" },
              { value: 120, label: "2m" },
            ]}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => formatDuration(v)}
            sx={{ maxWidth: 480 }}
          />
        </Box>
      }
      statsText={(total) =>
        `${total.toLocaleString()} video${total !== 1 ? "s" : ""} under ${formatDuration(maxDuration)}`
      }
      emptyIcon={<VideocamOffIcon />}
      emptyText={() => `No videos shorter than ${formatDuration(maxDuration)}.`}
      badge={(item) => ({ label: formatDuration(item.duration), color: "primary" })}
      caption={(item) =>
        `${formatBytes(item.size)}${
          item.width && item.height ? ` · ${item.width}×${item.height}` : ""
        }`
      }
    />
  );
}
