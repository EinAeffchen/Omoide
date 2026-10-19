import React, { Suspense, lazy } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import IndexPage from "./pages/IndexPage";
import { Layout } from "./components/Layout";
import { WriteModeBoundary } from "./components/ReadOnlyBoundary";
import { MaintenanceShell } from "./components/MaintenanceShell";

const MediaDetailPage = lazy(() => import("./pages/MediaDetailPage"));
const TagDetailPage = lazy(() => import("./pages/TagDetailPage"));
const ImagesPage = lazy(() => import("./pages/ImagesPage"));
const VideosPage = lazy(() => import("./pages/VideosPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const PeoplePage = lazy(() => import("./pages/PeoplePage"));
const TagsPage = lazy(() => import("./pages/TagPage"));
const SearchPage = lazy(() => import("./pages/SearchResultPage"));
const BlurryPage = lazy(() => import("./pages/BlurryPage"));
const DuplicatesPage = lazy(() => import("./pages/DuplicatesPage"));
const MissingFilesPage = lazy(() => import("./pages/MissingFilesPage"));
const NopersonsPage = lazy(() => import("./pages/NopersonsPage"));
const UntaggedPage = lazy(() => import("./pages/UntaggedPage"));
const ShortVideosPage = lazy(() => import("./pages/ShortVideosPage"));
const LowResolutionPage = lazy(() => import("./pages/LowResolutionPage"));
const NoExifDatePage = lazy(() => import("./pages/NoExifDatePage"));
const BrokenMediaPage = lazy(() => import("./pages/BrokenMediaPage"));
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
          <Route path="/favorites" element={<FavoritesPage />} />
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
              <MaintenanceShell>
                <WriteModeBoundary description="Blurry image review is disabled while the system is in read-only mode.">
                  <BlurryPage />
                </WriteModeBoundary>
              </MaintenanceShell>
            }
          />
          <Route
            path="/duplicates"
            element={
              <MaintenanceShell>
                <WriteModeBoundary description="Duplicate review actions are disabled while the system is in read-only mode.">
                  <DuplicatesPage />
                </WriteModeBoundary>
              </MaintenanceShell>
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
              <MaintenanceShell>
                <WriteModeBoundary description="Missing file review is disabled while the system is in read-only mode.">
                  <MissingFilesPage />
                </WriteModeBoundary>
              </MaintenanceShell>
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
              <MaintenanceShell>
                <WriteModeBoundary description="Untagged media review is disabled while the system is in read-only mode.">
                  <UntaggedPage />
                </WriteModeBoundary>
              </MaintenanceShell>
            }
          />
          <Route
            path="/shortvideos"
            element={
              <MaintenanceShell>
                <WriteModeBoundary description="Short video review is disabled while the system is in read-only mode.">
                  <ShortVideosPage />
                </WriteModeBoundary>
              </MaintenanceShell>
            }
          />
          <Route
            path="/lowresolution"
            element={
              <MaintenanceShell>
                <WriteModeBoundary description="Low-resolution media review is disabled while the system is in read-only mode.">
                  <LowResolutionPage />
                </WriteModeBoundary>
              </MaintenanceShell>
            }
          />
          <Route
            path="/noexifdate"
            element={
              <MaintenanceShell>
                <WriteModeBoundary description="No-EXIF-date review is disabled while the system is in read-only mode.">
                  <NoExifDatePage />
                </WriteModeBoundary>
              </MaintenanceShell>
            }
          />
          <Route
            path="/broken"
            element={
              <MaintenanceShell>
                <WriteModeBoundary description="Broken media review is disabled while the system is in read-only mode.">
                  <BrokenMediaPage />
                </WriteModeBoundary>
              </MaintenanceShell>
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
