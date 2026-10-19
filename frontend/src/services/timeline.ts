import { format } from "date-fns";
import {
  CursorPage,
  TimelineEntry,
  TimelineEvent,
  TimelineEventCreate,
  TimelineEventUpdate,
} from "../types";
import { apiFetch } from "./api";

export const getPersonTimeline = async (
  personId: number,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<TimelineEntry>> =>
  apiFetch<CursorPage<TimelineEntry>>(
    `/api/person/${personId}/timeline`,
    {
      query: { cursor },
      errorMessage: "Failed to fetch person timeline.",
      signal,
    }
  );

export const createTimelineEvent = async (
  personId: number,
  eventData: TimelineEventCreate
): Promise<TimelineEvent> => {
  const payload = {
    ...eventData,
    event_date: format(eventData.event_date, "yyyy-MM-dd"),
  };
  return apiFetch<TimelineEvent>(`/api/person/${personId}/events`, {
    method: "POST",
    body: payload, // Send the formatted payload
    errorMessage: "Failed to create timeline event.",
  });
};

export const updateTimelineEvent = async (
  personId: number,
  eventId: number,
  eventData: TimelineEventUpdate
): Promise<TimelineEvent> => {
  const payload = {
    ...eventData,
    ...(eventData.event_date && {
      event_date: format(eventData.event_date, "yyyy-MM-dd"),
    }),
  };

  return apiFetch<TimelineEvent>(
    `/api/person/${personId}/events/${eventId}`,
    {
      method: "PUT",
      body: payload,
      errorMessage: "Failed to update timeline event.",
    }
  );
};

export const deleteTimelineEvent = async (
  personId: number,
  eventId: number
): Promise<void> =>
  apiFetch<void>(`/api/person/${personId}/events/${eventId}`, {
    method: "DELETE",
    errorMessage: "Failed to delete timeline event.",
  });
