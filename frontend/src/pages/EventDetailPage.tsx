import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import TheatersIcon from "@mui/icons-material/Theaters";
import EditIcon from "@mui/icons-material/Edit";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import { useNavigate, useParams } from "react-router-dom";
import config from "../config";
import { CursorMediaGrid } from "../components/CursorMediaGrid";
import { EmptyState } from "../components/EmptyState";
import {
  convertEventToAlbum,
  getEvent,
  getEventMedia,
  updateEvent,
} from "../services/features";
import { EventItem } from "../types";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const eventId = Number(id);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

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

  if (!config.EVENTS_ENABLED) {
    return (
      <Typography variant="h5" color="text.primary" gutterBottom>
        Events disabled!
      </Typography>
    );
  }

  const startRenaming = () => {
    setTitleDraft(event?.title || "");
    setIsRenaming(true);
  };

  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!title || !event) {
      setIsRenaming(false);
      return;
    }
    setIsSavingTitle(true);
    try {
      const updated = await updateEvent(event.id, title);
      setEvent(updated);
      setIsRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename event");
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleConvert = async () => {
    if (!event) return;
    setIsConverting(true);
    try {
      const album = await convertEventToAlbum(event.id);
      navigate(`/album/${album.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to convert event"
      );
      setIsConverting(false);
      setConvertOpen(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box display="flex" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <TheatersIcon color="primary" />
        {isRenaming ? (
          <>
            <TextField
              size="small"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              autoFocus
              disabled={isSavingTitle}
            />
            <Button
              size="small"
              onClick={saveTitle}
              disabled={isSavingTitle || !titleDraft.trim()}
            >
              Save
            </Button>
            <Button
              size="small"
              onClick={() => setIsRenaming(false)}
              disabled={isSavingTitle}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Typography variant="h5" fontWeight={700}>
              {event?.title || dateRange || "Event"}
            </Typography>
            {event && (
              <IconButton size="small" onClick={startRenaming}>
                <EditIcon fontSize="small" />
              </IconButton>
            )}
          </>
        )}
        <Box flexGrow={1} />
        {event && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<PhotoAlbumIcon />}
            onClick={() => setConvertOpen(true)}
          >
            Convert to album
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {event ? `${dateRange} · ${event.media_count} items` : ""}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
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

      <Dialog open={convertOpen} onClose={() => setConvertOpen(false)}>
        <DialogTitle>Convert event to album?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This creates a new album with this event&apos;s media and removes
            the event. This can&apos;t be undone (though a future
            &quot;Rebuild events&quot; run may recreate a similar event from
            the same media).
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertOpen(false)} disabled={isConverting}>
            Cancel
          </Button>
          <Button
            onClick={handleConvert}
            variant="contained"
            disabled={isConverting}
          >
            Convert
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
