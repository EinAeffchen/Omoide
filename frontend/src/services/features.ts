import {
  Album,
  CameraCount,
  CursorPage,
  EventItem,
  EventPage,
  HighlightYear,
  LibraryStats,
  Media,
  MemoryGroup,
  PlaceCountry,
  Task,
} from "../types";
import { apiFetch } from "./api";

// ---------- memories & highlights ----------

export const getMemories = async (
  signal?: AbortSignal
): Promise<MemoryGroup[]> =>
  apiFetch<MemoryGroup[]>("/api/memories", {
    errorMessage: "Failed to load memories",
    signal,
  });

export const getHighlights = async (
  year: number,
  limit = 60,
  signal?: AbortSignal
): Promise<Media[]> =>
  apiFetch<Media[]>("/api/memories/highlights", {
    query: { year, limit },
    errorMessage: "Failed to load highlights",
    signal,
  });

export const getHighlightYears = async (
  signal?: AbortSignal
): Promise<HighlightYear[]> =>
  apiFetch<HighlightYear[]>("/api/memories/highlights/years", {
    errorMessage: "Failed to load highlight years",
    signal,
  });

// ---------- statistics ----------

export const getLibraryStats = async (
  signal?: AbortSignal
): Promise<LibraryStats> =>
  apiFetch<LibraryStats>("/api/stats", {
    errorMessage: "Failed to load statistics",
    signal,
  });

export const getCameras = async (
  signal?: AbortSignal
): Promise<CameraCount[]> =>
  apiFetch<CameraCount[]>("/api/stats/cameras", {
    errorMessage: "Failed to load cameras",
    signal,
  });

// ---------- albums ----------

export const getAlbums = async (signal?: AbortSignal): Promise<Album[]> =>
  apiFetch<Album[]>("/api/albums", {
    errorMessage: "Failed to load albums",
    signal,
  });

export const getAlbum = async (
  id: number,
  signal?: AbortSignal
): Promise<Album> =>
  apiFetch<Album>(`/api/albums/${id}`, {
    errorMessage: "Failed to load album",
    signal,
  });

export const createAlbum = async (
  name: string,
  description?: string
): Promise<Album> =>
  apiFetch<Album>("/api/albums", {
    method: "POST",
    body: { name, description },
    errorMessage: "Failed to create album",
  });

export const updateAlbum = async (
  id: number,
  patch: { name?: string; description?: string; cover_media_id?: number }
): Promise<Album> =>
  apiFetch<Album>(`/api/albums/${id}`, {
    method: "PATCH",
    body: patch,
    errorMessage: "Failed to update album",
  });

export const deleteAlbum = async (id: number): Promise<void> =>
  apiFetch<void>(`/api/albums/${id}`, {
    method: "DELETE",
    errorMessage: "Failed to delete album",
  });

export const addMediaToAlbum = async (
  id: number,
  mediaIds: number[]
): Promise<Album> =>
  apiFetch<Album>(`/api/albums/${id}/media`, {
    method: "POST",
    body: { media_ids: mediaIds },
    errorMessage: "Failed to add media to album",
  });

export const removeMediaFromAlbum = async (
  id: number,
  mediaIds: number[]
): Promise<Album> =>
  apiFetch<Album>(`/api/albums/${id}/media`, {
    method: "DELETE",
    body: { media_ids: mediaIds },
    errorMessage: "Failed to remove media from album",
  });

export const getAlbumMedia = async (
  id: number,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<Media>> =>
  apiFetch<CursorPage<Media>>(`/api/albums/${id}/media`, {
    query: { cursor },
    errorMessage: "Failed to load album media",
    signal,
  });

// ---------- events ----------

export const getEvents = async (
  cursor: string | null,
  signal?: AbortSignal
): Promise<EventPage> =>
  apiFetch<EventPage>("/api/events", {
    query: { cursor },
    errorMessage: "Failed to load events",
    signal,
  });

export const getEvent = async (
  id: number,
  signal?: AbortSignal
): Promise<EventItem> =>
  apiFetch<EventItem>(`/api/events/${id}`, {
    errorMessage: "Failed to load event",
    signal,
  });

export const getEventMedia = async (
  id: number,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<Media>> =>
  apiFetch<CursorPage<Media>>(`/api/events/${id}/media`, {
    query: { cursor },
    errorMessage: "Failed to load event media",
    signal,
  });

export const updateEvent = async (
  id: number,
  title: string
): Promise<EventItem> =>
  apiFetch<EventItem>(`/api/events/${id}`, {
    method: "PATCH",
    body: { title },
    errorMessage: "Failed to rename event",
  });

export const convertEventToAlbum = async (
  id: number,
  name?: string
): Promise<Album> =>
  apiFetch<Album>(`/api/events/${id}/convert-to-album`, {
    method: "POST",
    body: { name: name ?? null },
    errorMessage: "Failed to convert event to album",
  });

// ---------- places ----------

export const getPlaces = async (
  signal?: AbortSignal
): Promise<PlaceCountry[]> =>
  apiFetch<PlaceCountry[]>("/api/places", {
    errorMessage: "Failed to load places",
    signal,
  });

export const getPlaceMedia = async (
  city: string,
  country: string | null,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<Media>> => {
  // `city` is a required backend param and must be sent even when empty
  // (apiFetch's `query` would drop ""), so build this query string by hand.
  const params = new URLSearchParams();
  params.append("city", city);
  if (country) params.append("country", country);
  if (cursor) params.append("cursor", cursor);
  return apiFetch<CursorPage<Media>>(`/api/places/media?${params}`, {
    errorMessage: "Failed to load place media",
    signal,
  });
};

// ---------- organize tasks ----------

export const startBuildEvents = async (): Promise<Task> =>
  apiFetch<Task>("/api/tasks/build_events", {
    method: "POST",
    errorMessage: "Failed to start event clustering",
  });

export const startGeocodePlaces = async (): Promise<Task> =>
  apiFetch<Task>("/api/tasks/geocode_places", {
    method: "POST",
    errorMessage: "Failed to start geocoding",
  });
