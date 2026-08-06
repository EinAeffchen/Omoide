import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Container,
  Snackbar,
  Typography,
} from "@mui/material";
import TheatersIcon from "@mui/icons-material/Theaters";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import { Link } from "react-router-dom";
import { useInView } from "react-intersection-observer";
import config, { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { EmptyState } from "../components/EmptyState";
import { getEvents, startBuildEvents } from "../services/features";
import { useTaskCompletionVersion } from "../TaskEventsContext";
import { EventItem } from "../types";

const formatRange = (startIso: string, endIso: string) => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString(undefined, opts);
  const endStr = end.toLocaleDateString(undefined, opts);
  const year = end.getFullYear();
  return startStr === endStr
    ? `${startStr}, ${year}`
    : `${startStr} – ${endStr}, ${year}`;
};

export default function EventsPage() {
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });
  const [items, setItems] = useState<EventItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState("");
  const refreshKey = useTaskCompletionVersion(["build_events"]);

  const loadPage = async (fromCursor: string | null, replace: boolean) => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await getEvents(fromCursor);
      setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
    void loadPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (inView && hasMore && !isLoading && !error) {
      void loadPage(cursor, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, hasMore, isLoading, error, cursor]);

  const handleRebuild = async () => {
    try {
      await startBuildEvents();
      setSnackbar("Event clustering started — this page refreshes when done.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
    }
  };

  if (!config.EVENTS_ENABLED) {
    return (
      <Typography variant="h5" color="text.primary" gutterBottom>
        Events disabled!
      </Typography>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={1}
        mb={3}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <TheatersIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>
            Events
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<AutorenewIcon />}
          onClick={handleRebuild}
        >
          Rebuild events
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {items.length === 0 && !isLoading && !error && (
        <EmptyState
          icon={<TheatersIcon />}
          title="No events yet"
          description="Run “Rebuild events” to cluster your library into trips and moments. Run geocoding first (Places page) for named events."
        />
      )}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "repeat(1, 1fr)",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
            lg: "repeat(4, 1fr)",
          },
        }}
      >
        {items.map((event) => (
          <Card key={event.id} sx={{ borderRadius: 3 }}>
            <CardActionArea component={Link} to={`/event/${event.id}`}>
              <Box
                sx={{
                  aspectRatio: "16/9",
                  bgcolor: "action.hover",
                  overflow: "hidden",
                }}
              >
                {event.cover_thumbnail && (
                  <Box
                    component="img"
                    src={`${API}/thumbnails/${encodeFilePath(
                      event.cover_thumbnail
                    )}`}
                    alt={event.title ?? "Event"}
                    loading="lazy"
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                )}
              </Box>
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} noWrap>
                  {event.title || formatRange(event.start_at, event.end_at)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {event.title
                    ? `${formatRange(event.start_at, event.end_at)} · `
                    : ""}
                  {event.media_count} item{event.media_count === 1 ? "" : "s"}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      {isLoading && (
        <Box textAlign="center" py={3}>
          <CircularProgress />
        </Box>
      )}
      {hasMore && !error && <Box ref={loaderRef} sx={{ height: 10 }} />}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar("")}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Container>
  );
}
