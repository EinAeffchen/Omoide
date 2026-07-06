import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import InsightsIcon from "@mui/icons-material/Insights";
import { Link } from "react-router-dom";
import { getLibraryStats } from "../services/features";
import { LibraryStats } from "../types";
import { formatBytes } from "../formatUtils";

// Validated 2-slot categorical palette (dataviz reference palette, slots 1+2).
// Light-mode aqua sits below 3:1 on the surface, so year columns always carry
// visible value labels (the relief rule).
const SERIES = {
  light: { images: "#2a78d6", videos: "#1baf7a" },
  dark: { images: "#3987e5", videos: "#199e70" },
};
const INK = {
  light: { muted: "#898781", grid: "#e1e0d9", baseline: "#c3c2b7" },
  dark: { muted: "#898781", grid: "#2c2c2a", baseline: "#383835" },
};

const CHART_HEIGHT = 160;

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Paper sx={{ p: 2, borderRadius: 3, flex: "1 1 130px", minWidth: 130 }}>
      <Typography variant="h5" fontWeight={700}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: "3px", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function TopList({
  title,
  rows,
  barColor,
}: {
  title: string;
  rows: { key: string | number; label: string; count: number; to?: string }[];
  barColor: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, flex: "1 1 280px", minWidth: 260 }}>
      <Typography variant="subtitle2" fontWeight={700} mb={1.5}>
        {title}
      </Typography>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No data yet.
        </Typography>
      )}
      {rows.map((row) => {
        const content = (
          <Box sx={{ mb: 1.25 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                gap: 1,
                mb: 0.25,
              }}
            >
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {row.label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {row.count.toLocaleString()}
              </Typography>
            </Box>
            <Box
              sx={{
                height: 6,
                borderRadius: "3px",
                bgcolor: "action.hover",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${(row.count / max) * 100}%`,
                  borderRadius: "3px",
                  bgcolor: barColor,
                }}
              />
            </Box>
          </Box>
        );
        return row.to ? (
          <Box
            key={row.key}
            component={Link}
            to={row.to}
            sx={{ textDecoration: "none", color: "inherit", display: "block" }}
          >
            {content}
          </Box>
        ) : (
          <Box key={row.key}>{content}</Box>
        );
      })}
    </Paper>
  );
}

export default function StatisticsPage() {
  const theme = useTheme();
  const mode = theme.palette.mode === "dark" ? "dark" : "light";
  const series = SERIES[mode];
  const ink = INK[mode];

  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLibraryStats()
      .then(setStats)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load stats")
      );
  }, []);

  const yearMax = useMemo(
    () =>
      Math.max(1, ...(stats?.per_year ?? []).map((y) => y.images + y.videos)),
    [stats]
  );
  const monthMax = useMemo(
    () => Math.max(1, ...(stats?.per_month ?? []).map((m) => m.count)),
    [stats]
  );

  if (error) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }
  if (!stats) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  const { totals } = stats;
  const videoHours = totals.video_seconds / 3600;

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <InsightsIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Library statistics
        </Typography>
      </Box>

      {/* KPI row */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <StatTile label="Media" value={totals.media.toLocaleString()} />
        <StatTile label="Images" value={totals.images.toLocaleString()} />
        <StatTile label="Videos" value={totals.videos.toLocaleString()} />
        <StatTile
          label="Video runtime"
          value={
            videoHours >= 1
              ? `${videoHours.toFixed(1)} h`
              : `${Math.round(totals.video_seconds / 60)} min`
          }
        />
        <StatTile label="Storage" value={formatBytes(totals.size_bytes)} />
        <StatTile label="With location" value={totals.with_gps.toLocaleString()} />
        <StatTile label="People" value={totals.persons.toLocaleString()} />
        <StatTile label="Favorites" value={totals.favorites.toLocaleString()} />
      </Box>

      {/* Per-year stacked columns: identity job (images vs videos) */}
      <Paper sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 2,
          }}
        >
          <Typography variant="subtitle2" fontWeight={700}>
            Media per year
          </Typography>
          <Box sx={{ display: "flex", gap: 2 }}>
            <LegendChip color={series.images} label="Images" />
            <LegendChip color={series.videos} label="Videos" />
          </Box>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: "6px",
            height: CHART_HEIGHT + 40,
            borderBottom: `1px solid ${ink.baseline}`,
            overflowX: "auto",
            pb: 0,
          }}
        >
          {stats.per_year.map((y) => {
            const total = y.images + y.videos;
            const imgH = (y.images / yearMax) * CHART_HEIGHT;
            const vidH = (y.videos / yearMax) * CHART_HEIGHT;
            return (
              <Tooltip
                key={y.year}
                title={`${y.year}: ${y.images.toLocaleString()} images, ${y.videos.toLocaleString()} videos`}
              >
                <Box
                  sx={{
                    flex: "1 0 34px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    height: "100%",
                    minWidth: 34,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontVariantNumeric: "tabular-nums",
                      mb: "2px",
                    }}
                  >
                    {total.toLocaleString()}
                  </Typography>
                  {y.videos > 0 && (
                    <Box
                      sx={{
                        width: 22,
                        height: Math.max(2, vidH),
                        bgcolor: series.videos,
                        borderRadius: "4px 4px 0 0",
                        mb: y.images > 0 ? "2px" : 0,
                      }}
                    />
                  )}
                  {y.images > 0 && (
                    <Box
                      sx={{
                        width: 22,
                        height: Math.max(2, imgH),
                        bgcolor: series.images,
                        borderRadius:
                          y.videos > 0 ? "0" : "4px 4px 0 0",
                      }}
                    />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
        <Box sx={{ display: "flex", gap: "6px", mt: 0.5 }}>
          {stats.per_year.map((y) => (
            <Typography
              key={y.year}
              variant="caption"
              sx={{
                flex: "1 0 34px",
                minWidth: 34,
                textAlign: "center",
                color: ink.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {y.year}
            </Typography>
          ))}
        </Box>
      </Paper>

      {/* Last 24 months: single-series magnitude, one hue */}
      <Paper sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} mb={2}>
          Media per month (last 24 months)
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: "2px",
            height: 100,
            borderBottom: `1px solid ${ink.baseline}`,
          }}
        >
          {stats.per_month.map((m) => (
            <Tooltip key={m.month} title={`${m.month}: ${m.count.toLocaleString()}`}>
              <Box
                sx={{
                  flex: 1,
                  height: Math.max(2, (m.count / monthMax) * 100),
                  bgcolor: series.images,
                  borderRadius: "4px 4px 0 0",
                  "&:hover": { opacity: 0.8 },
                }}
              />
            </Tooltip>
          ))}
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
          <Typography variant="caption" sx={{ color: ink.muted }}>
            {stats.per_month[0]?.month}
          </Typography>
          <Typography variant="caption" sx={{ color: ink.muted }}>
            {stats.per_month[stats.per_month.length - 1]?.month}
          </Typography>
        </Box>
      </Paper>

      {/* Top-N lists */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <TopList
          title="Top cameras"
          barColor={series.images}
          rows={stats.cameras.map((c) => ({
            key: `${c.make}-${c.model}`,
            label: [c.make, c.model].filter(Boolean).join(" "),
            count: c.count,
          }))}
        />
        <TopList
          title="Top tags"
          barColor={series.images}
          rows={stats.top_tags.map((t) => ({
            key: t.id,
            label: t.name,
            count: t.count,
            to: `/tag/${t.id}`,
          }))}
        />
        <TopList
          title="Top people"
          barColor={series.images}
          rows={stats.top_people.map((p) => ({
            key: p.id,
            label: p.name || `Person ${p.id}`,
            count: p.count,
            to: `/person/${p.id}`,
          }))}
        />
      </Box>
    </Container>
  );
}
