import React, { Suspense, lazy } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import IndexPage from "./pages/IndexPage";
import MediaDetailPage from "./pages/MediaDetailPage";
import { Layout } from "./components/Layout";
import TagDetailPage from "./pages/TagDetailPage";
import ImagesPage from "./pages/ImagesPage";
import VideosPage from "./pages/VideosPage";
import PeoplePage from "./pages/PeoplePage";
import TagsPage from "./pages/TagPage";
import SearchPage from "./pages/SearchResultPage";
import BlurryPage from "./pages/BlurryPage";
import DuplicatesPage from "./pages/DuplicatesPage";
import MissingFilesPage from "./pages/MissingFilesPage";
import NopersonsPage from "./pages/NopersonsPage";
import UntaggedPage from "./pages/UntaggedPage";
import ShortVideosPage from "./pages/ShortVideosPage";
import LowResolutionPage from "./pages/LowResolutionPage";
import NoExifDatePage from "./pages/NoExifDatePage";
import BrokenMediaPage from "./pages/BrokenMediaPage";
import { WriteModeBoundary } from "./components/ReadOnlyBoundary";

const PersonDetailPage = lazy(() => import("./pages/PersonDetailPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const MapEditorPage = lazy(() => import("./pages/MapEditorPage"));
const ConfigurationPage = lazy(() => import("./pages/ConfigurationPage"));
const OrphanFacesPage = lazy(() => import("./pages/OrphanFaces"));
const HighlightsPage = lazy(() => import("./pages/HighlightsPage"));
const StatisticsPage = lazy(() => import("./pages/StatisticsPage"));
const AlbumsPage = lazy(() => import("./pages/AlbumsPage"));
const AlbumDetailPage = lazy(() => import("./pages/AlbumDetailPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage"));
const PlacesPage = lazy(() => import("./pages/PlacesPage"));
const PlaceMediaPage = lazy(() => import("./pages/PlaceMediaPage"));

const RouteFallback = () => (
  <Box
    sx={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "50vh",
    }}
  >
    <CircularProgress />
  </Box>
);

export const AppRoutes = () => {
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<Layout />}>
          <Route index element={<IndexPage />} />
          <Route path="/searchresults" element={<SearchPage />} />
          <Route path="/medium/:id" element={<MediaDetailPage />} />
          <Route path="/images" element={<ImagesPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route
            path="/geotagger"
            element={
              <WriteModeBoundary description="Geo-tagging tools are disabled while the system is in read-only mode.">
                <MapEditorPage />
              </WriteModeBoundary>
            }
          />
          <Route path="/tags" element={<TagsPage />} />
          <Route
            path="/orphanfaces"
            element={
              <WriteModeBoundary description="Face assignment tools are disabled while the system is in read-only mode.">
                <OrphanFacesPage />
              </WriteModeBoundary>
            }
          />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/person/:id" element={<PersonDetailPage />} />
          <Route path="/tag/:id" element={<TagDetailPage />} />
          <Route path="/highlights" element={<HighlightsPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/album/:id" element={<AlbumDetailPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/event/:id" element={<EventDetailPage />} />
          <Route path="/places" element={<PlacesPage />} />
          <Route path="/places/media" element={<PlaceMediaPage />} />
          <Route
            path="/blur"
            element={
              <WriteModeBoundary description="Blurry image review is disabled while the system is in read-only mode.">
                <BlurryPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/duplicates"
            element={
              <WriteModeBoundary description="Duplicate review actions are disabled while the system is in read-only mode.">
                <DuplicatesPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/configuration"
            element={
              <WriteModeBoundary description="Configuration settings cannot be viewed or edited while the system is in read-only mode.">
                <ConfigurationPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/missing"
            element={
              <WriteModeBoundary description="Missing file review is disabled while the system is in read-only mode.">
                <MissingFilesPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/nopersons"
            element={
              <WriteModeBoundary description="No-persons review is disabled while the system is in read-only mode.">
                <NopersonsPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/untagged"
            element={
              <WriteModeBoundary description="Untagged media review is disabled while the system is in read-only mode.">
                <UntaggedPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/shortvideos"
            element={
              <WriteModeBoundary description="Short video review is disabled while the system is in read-only mode.">
                <ShortVideosPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/lowresolution"
            element={
              <WriteModeBoundary description="Low-resolution media review is disabled while the system is in read-only mode.">
                <LowResolutionPage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/noexifdate"
            element={
              <WriteModeBoundary description="No-EXIF-date review is disabled while the system is in read-only mode.">
                <NoExifDatePage />
              </WriteModeBoundary>
            }
          />
          <Route
            path="/broken"
            element={
              <WriteModeBoundary description="Broken media review is disabled while the system is in read-only mode.">
                <BrokenMediaPage />
              </WriteModeBoundary>
            }
          />
        </Route>
      </Routes>
      {backgroundLocation && (
        <Routes>
          <Route path="/medium/:id" element={<MediaDetailPage />} />
        </Routes>
      )}
    </Suspense>
  );
};
