import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Container, Typography } from "@mui/material";
import TheatersIcon from "@mui/icons-material/Theaters";
import { useParams } from "react-router-dom";
import { CursorMediaGrid } from "../components/CursorMediaGrid";
import { EmptyState } from "../components/EmptyState";
import { getEvent, getEventMedia } from "../services/features";
import { EventItem } from "../types";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(eventId)) return;
    getEvent(eventId)
      .then(setEvent)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load event")
      );
  }, [eventId]);

  const fetcher = useCallback(
    (cursor: string | null) => getEventMedia(eventId, cursor),
    [eventId]
  );

  const dateRange = event
    ? `${new Date(event.start_at).toLocaleDateString()} – ${new Date(
        event.end_at
      ).toLocaleDateString()}`
    : "";

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <TheatersIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          {event?.title || dateRange || "Event"}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {event ? `${dateRange} · ${event.media_count} items` : ""}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <CursorMediaGrid
        listKey={`event-${eventId}`}
        fetcher={fetcher}
        empty={
          <EmptyState
            icon={<TheatersIcon />}
            title="No media"
            description="This event has no media."
          />
        }
      />
    </Container>
  );
}
