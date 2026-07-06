import React from "react";
import MediaListPage from "../components/MediaListPage";
import { getVideos } from "../services/media";

export default function VideosPage() {
  return (
    <MediaListPage
      listKeyPrefix="videos"
      fetcher={getVideos}
      emptyTitle="No videos found"
      emptyDescription="Run a scan or add new media to see videos here."
    />
  );
}
