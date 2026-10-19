import AddIcon from "@mui/icons-material/Add";
import { Dialog, DialogTitle, DialogContent, ImageList, ImageListItem, ImageListItemBar, IconButton, Tooltip } from "@mui/material";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineSeparator,
} from "@mui/lab";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import React, { Suspense, lazy, useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { EventCard } from "./EventCard";
import { MediaItemGroup } from "./MediaItemGroup";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import {
  createTimelineEvent,
  deleteTimelineEvent,
  getPersonTimeline,
  updateTimelineEvent,
} from "../services/timeline";
import { usePagedList } from "../hooks/usePagedList";
import {
  TimelineEntry,
  MediaPreview,
  Person,
  TimelineEvent,
  TimelineEventCreate,
  TimelineDisplayItem,
} from "../types";
import config, { API } from "../config";
import { encodeFilePath } from "../urlUtils";

const EventFormDialog = lazy(() =>
  import("./EventFormDialog").then((m) => ({ default: m.EventFormDialog }))
);

// The endpoint returns one entry per media item (grouped by day below) and
// one per event.

interface TimelineTabProps {
  person: Person;
  onDetachMedia?: (mediaId: number) => Promise<void>;
  onJumpToFace?: (mediaId: number) => void;
}

export const TimelineTab: React.FC<TimelineTabProps> = ({ person, onDetachMedia: onDetachMediaProp, onJumpToFace }) => {
  const canMutate = !config.PRESENTATION_MODE;
  const onDetachMedia = canMutate ? onDetachMediaProp : undefined;
  const [dayToView, setDayToView] = useState<MediaPreview[] | null>(null);
  const listKey = `person-${person.id}-timeline`;
  const { items, hasMore, isLoading, loaderRef, reload } =
    usePagedList<TimelineEntry>(
      listKey,
      (cursor, signal) =>
        getPersonTimeline(person.id, cursor, signal),
      { enabled: Boolean(person.id) }
    );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<TimelineEvent | null>(null);
  const [eventToDelete, setEventToDelete] = useState<TimelineEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenCreateDialog = () => {
    setEventToEdit(null);
    setIsFormOpen(true);
  };

  const handleOpenEditDialog = (event: TimelineEvent) => {
    setEventToEdit(event);
    setIsFormOpen(true);
  };
  const handleCloseDialog = () => {
    setIsFormOpen(false);
    setEventToEdit(null);
  };

  const handleDeleteEvent = (event: TimelineEvent) => {
    setEventToDelete(event);
  };

  const handleConfirmDeleteEvent = async () => {
    if (!eventToDelete) return;
    setIsDeleting(true);
    try {
      await deleteTimelineEvent(person.id, eventToDelete.id);
      reload();
      setEventToDelete(null);
    } catch (error) {
      console.error("Failed to delete timeline event:", error);
    } finally {
      setIsDeleting(false);
    }
  };
  const handleSubmitEvent = async (eventData: TimelineEventCreate) => {
    setIsSubmitting(true);
    try {
      if (eventToEdit) {
        await updateTimelineEvent(person.id, eventToEdit.id, eventData);
        reload();
      } else {
        await createTimelineEvent(person.id, eventData);
        reload();
      }
      handleCloseDialog();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMedia = async (mediaId: number) => {
    if (!onDetachMedia) return;
    await onDetachMedia(mediaId);
    reload();
    // Also remove from current day-view if open
    setDayToView((prev) => {
      if (!prev) return null;
      const updated = prev.filter((m) => m.id !== mediaId);
      return updated.length > 0 ? updated : null;
    });
  };

  const displayItems: TimelineDisplayItem[] = useMemo(() => {
    const grouped: (
      | TimelineDisplayItem
      | { type: "media_group"; date: string; items: MediaPreview[] }
    )[] = [];

    for (const item of items) {
      if (item.type === "event") {
        grouped.push(item);
        continue;
      }
      const lastItem = grouped[grouped.length - 1];
      if (lastItem?.type === "media_group" && lastItem.date === item.date) {
        lastItem.items.push(item.items);
      } else {
        grouped.push({
          type: "media_group",
          date: item.date,
          items: [item.items],
        });
      }
    }
    return grouped;
  }, [items]);

  return (
    <Box>
      {canMutate && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateDialog}
          >
            Add Event
          </Button>
        </Box>
      )}

      <Timeline position="alternate">
        {displayItems.map((item, index) => {
          const panelKey = `${item.type}-${item.date}-${index}`;
          return (
            <TimelineItem key={panelKey}>
              <TimelineSeparator>
                <TimelineDot
                  color={item.type === "media_group" ? "primary" : "secondary"}
                />
                {index < displayItems.length - 1 && <TimelineConnector />}
              </TimelineSeparator>
              <TimelineContent sx={{ py: "12px", px: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {item.date}
                </Typography>
                <Typography>
                  {item.type === "event" ? (
                    <EventCard
                      event={item.event}
                      onEdit={canMutate ? () => handleOpenEditDialog(item.event) : undefined}
                      onDelete={canMutate ? () => {
                        handleDeleteEvent(item.event);
                      } : undefined}
                    />
                  ) : (
                    <MediaItemGroup
                      mediaItems={item.items}
                      onViewAll={() => setDayToView(item.items)}
                      onRemoveMedia={onDetachMedia ? (id) => { void handleRemoveMedia(id); } : undefined}
                      onJumpToFace={onJumpToFace}
                    />
                  )}
                </Typography>
              </TimelineContent>
            </TimelineItem>
          );
        })}
      </Timeline>
      {/* The date picker library is only fetched once the form is opened. */}
      {isFormOpen && (
        <Suspense fallback={null}>
          <EventFormDialog
            open={isFormOpen}
            onClose={handleCloseDialog}
            onSubmit={handleSubmitEvent}
            isSubmitting={isSubmitting}
            initialData={eventToEdit}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={!!eventToDelete}
        title="Delete event?"
        message={`Are you sure you want to delete the event "${eventToDelete?.title ?? ""}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={isDeleting}
        onConfirm={handleConfirmDeleteEvent}
        onClose={() => setEventToDelete(null)}
      />
      {/* Day-view dialog with per-item remove */}
      <Dialog
        open={!!dayToView}
        onClose={() => setDayToView(null)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>
          Photos from{" "}
          {dayToView && dayToView.length > 0
            ? new Date(dayToView[0].inserted_at).toLocaleDateString()
            : ""}
        </DialogTitle>
        <DialogContent>
          {dayToView && (
            <ImageList cols={4} gap={8}>
              {dayToView.map((media) => (
                <ImageListItem key={media.id}>
                  <img
                    src={`${API}/thumbnails/${media.thumbnail_path ? encodeFilePath(media.thumbnail_path) : `${media.id}.jpg`}`}
                    alt={media.filename}
                    style={{ height: 180, objectFit: "cover", width: "100%" }}
                  />
                  {(onDetachMedia || onJumpToFace) && (
                    <ImageListItemBar
                      actionIcon={
                        <Box sx={{ display: "flex" }}>
                          {onJumpToFace && (
                            <Tooltip title="Find face in Faces tab">
                              <IconButton
                                size="small"
                                onClick={() => { setDayToView(null); onJumpToFace(media.id); }}
                                sx={{ color: "white" }}
                              >
                                <PersonSearchIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {onDetachMedia && (
                            <Tooltip title="Remove from this person">
                              <IconButton
                                size="small"
                                onClick={() => { void handleRemoveMedia(media.id); }}
                                sx={{ color: "white" }}
                              >
                                <LinkOffIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      }
                      actionPosition="right"
                      sx={{ background: "rgba(0,0,0,0.4)" }}
                    />
                  )}
                </ImageListItem>
              ))}
            </ImageList>
          )}
        </DialogContent>
      </Dialog>
      {hasMore && <Box ref={loaderRef} sx={{ height: "1px" }} />}
      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};
