import { API } from "../config";
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

const jsonOrThrow = async <T>(res: Response, what: string): Promise<T> => {
  if (!res.ok) throw new Error(`Failed to ${what} (${res.status})`);
  return res.json();
};

// ---------- memories & highlights ----------

export const getMemories = async (): Promise<MemoryGroup[]> =>
  jsonOrThrow(await fetch(`${API}/api/memories`), "load memories");

export const getHighlights = async (
  year: number,
  limit = 60
): Promise<Media[]> =>
  jsonOrThrow(
    await fetch(`${API}/api/memories/highlights?year=${year}&limit=${limit}`),
    "load highlights"
  );

export const getHighlightYears = async (): Promise<HighlightYear[]> =>
  jsonOrThrow(
    await fetch(`${API}/api/memories/highlights/years`),
    "load highlight years"
  );

// ---------- statistics ----------

export const getLibraryStats = async (): Promise<LibraryStats> =>
  jsonOrThrow(await fetch(`${API}/api/stats`), "load statistics");

export const getCameras = async (): Promise<CameraCount[]> =>
  jsonOrThrow(await fetch(`${API}/api/stats/cameras`), "load cameras");

// ---------- albums ----------

export const getAlbums = async (): Promise<Album[]> =>
  jsonOrThrow(await fetch(`${API}/api/albums`), "load albums");

export const getAlbum = async (id: number): Promise<Album> =>
  jsonOrThrow(await fetch(`${API}/api/albums/${id}`), "load album");

export const createAlbum = async (
  name: string,
  description?: string
): Promise<Album> =>
  jsonOrThrow(
    await fetch(`${API}/api/albums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),
    "create album"
  );

export const updateAlbum = async (
  id: number,
  patch: { name?: string; description?: string; cover_media_id?: number }
): Promise<Album> =>
  jsonOrThrow(
    await fetch(`${API}/api/albums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "update album"
  );

export const deleteAlbum = async (id: number): Promise<void> => {
  const res = await fetch(`${API}/api/albums/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete album (${res.status})`);
};

export const addMediaToAlbum = async (
  id: number,
  mediaIds: number[]
): Promise<Album> =>
  jsonOrThrow(
    await fetch(`${API}/api/albums/${id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_ids: mediaIds }),
    }),
    "add media to album"
  );

export const removeMediaFromAlbum = async (
  id: number,
  mediaIds: number[]
): Promise<Album> =>
  jsonOrThrow(
    await fetch(`${API}/api/albums/${id}/media`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_ids: mediaIds }),
    }),
    "remove media from album"
  );

export const getAlbumMedia = async (
  id: number,
  cursor: string | null
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  return jsonOrThrow(
    await fetch(`${API}/api/albums/${id}/media?${params.toString()}`),
    "load album media"
  );
};

// ---------- events ----------

export const getEvents = async (
  cursor: string | null
): Promise<EventPage> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  return jsonOrThrow(
    await fetch(`${API}/api/events?${params.toString()}`),
    "load events"
  );
};

export const getEvent = async (id: number): Promise<EventItem> =>
  jsonOrThrow(await fetch(`${API}/api/events/${id}`), "load event");

export const getEventMedia = async (
  id: number,
  cursor: string | null
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  return jsonOrThrow(
    await fetch(`${API}/api/events/${id}/media?${params.toString()}`),
    "load event media"
  );
};

// ---------- places ----------

export const getPlaces = async (): Promise<PlaceCountry[]> =>
  jsonOrThrow(await fetch(`${API}/api/places`), "load places");

export const getPlaceMedia = async (
  city: string,
  country: string | null,
  cursor: string | null
): Promise<CursorPage<Media>> => {
  const params = new URLSearchParams();
  params.append("city", city);
  if (country) params.append("country", country);
  if (cursor) params.append("cursor", cursor);
  return jsonOrThrow(
    await fetch(`${API}/api/places/media?${params.toString()}`),
    "load place media"
  );
};

// ---------- organize tasks ----------

export const startBuildEvents = async (): Promise<Task> =>
  jsonOrThrow(
    await fetch(`${API}/api/tasks/build_events`, { method: "POST" }),
    "start event clustering"
  );

export const startGeocodePlaces = async (): Promise<Task> =>
  jsonOrThrow(
    await fetch(`${API}/api/tasks/geocode_places`, { method: "POST" }),
    "start geocoding"
  );
