import React from "react";
import MediaListPage from "../components/MediaListPage";
import { getFavorites } from "../services/media";

export default function FavoritesPage() {
  return (
    <MediaListPage
      listKeyPrefix="favorites"
      fetcher={getFavorites}
      emptyTitle="No favorites yet"
      emptyDescription="Mark images or videos as favorites to see them here."
    />
  );
}
