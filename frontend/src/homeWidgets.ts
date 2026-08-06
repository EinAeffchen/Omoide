export type HomeWidgetId =
  | "on_this_day"
  | "recent_media"
  | "favorites_strip"
  | "highlights_strip"
  | "albums_preview"
  | "statistics_snapshot";

export interface HomeWidgetDef {
  id: HomeWidgetId;
  label: string;
  description: string;
}

export const HOME_WIDGETS: HomeWidgetDef[] = [
  {
    id: "on_this_day",
    label: "On This Day",
    description: "Media taken on this date in previous years.",
  },
  {
    id: "recent_media",
    label: "Recent Media",
    description:
      "Your media library grid with grid/folder view, camera and sort filters.",
  },
  {
    id: "favorites_strip",
    label: "Favorites",
    description: "A strip of your favorited photos and videos.",
  },
  {
    id: "highlights_strip",
    label: "Highlights",
    description: "Best-of picks from the most recent year with highlights.",
  },
  {
    id: "albums_preview",
    label: "Albums",
    description: "A quick jump-off row of your album covers.",
  },
  {
    id: "statistics_snapshot",
    label: "Statistics",
    description: "At-a-glance counts for your library.",
  },
];

export const DEFAULT_HOME_WIDGET_ORDER: HomeWidgetId[] = HOME_WIDGETS.map(
  (w) => w.id
);

export const DEFAULT_ENABLED_WIDGETS: HomeWidgetId[] = [
  "on_this_day",
  "recent_media",
];

export const isHomeWidgetId = (value: string): value is HomeWidgetId =>
  HOME_WIDGETS.some((w) => w.id === value);
