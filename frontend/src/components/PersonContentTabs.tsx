import React, { Suspense, useEffect, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Select,
  Slider,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  FaceRead,
  Media,
  Person,
  PersonReadSimple,
  PersonRelationshipGraph as PersonRelationshipGraphData,
  SimilarPerson,
  Tag,
} from "../types";
import { TimelineTab } from "./TimelineTab";
import MediaAppearances from "./MediaAppearances";
import SimilarPersonCard from "./SimilarPersonCard";
import { TagsSection } from "./TagsSection";
const PersonRelationshipGraph = React.lazy(
  () => import("./PersonRelationshipGraph")
);
import type { MergeResult } from "../services/personActions";

const DetectedFaces = React.lazy(() => import("./DetectedFaces"));

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`person-tabpanel-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

interface PersonContentTabsProps {
  person: Person;
  detectedFacesList: FaceRead[];
  hasMoreFaces: boolean;
  loadingMoreFaces: boolean;
  onTagAdded: (tag: Tag) => void;
  loadMoreDetectedFaces: () => void;
  handleProfileAssignmentWrapper: (faceId: number, personId: number) => void;
  handleAssignWrapper: (faceIds: number[], personId: number) => void;
  handleCreateWrapper: (faceIds: number[], name?: string) => Promise<Person>;
  handleDeleteWrapper: (faceIds: number[]) => void;
  handleDetachWrapper: (faceIds: number[]) => void;
  suggestedFaces: FaceRead[];
  similarPersons: SimilarPerson[];
  onMergeSelectedSimilar: (
    ids: number[],
  ) => Promise<MergeResult | void> | MergeResult | void;
  onAutoMergeSimilar: () => Promise<MergeResult | void> | MergeResult | void;
  isMergingSimilar: boolean;
  onTagUpdate: (obj: Person | Media) => void;
  onRefreshSuggestions: () => void | Promise<void>;
  onLoadSimilar: () => Promise<void> | void;
  isLoadingSuggestedFaces: boolean;
  suggestedFacesLimit: number;
  onSuggestedFacesLimitChange: (limit: number) => void;
  filterPeople: PersonReadSimple[];
  onFilterPeopleChange: (people: PersonReadSimple[]) => void;
  filterTags: Tag[];
  onFilterTagsChange: (tags: Tag[]) => void;
  mediaListKey: string;
  relationshipGraph: PersonRelationshipGraphData | null;
  relationshipDepth: number;
  isLoadingRelationships: boolean;
  hasLoadedRelationships: boolean;
  onLoadRelationships: (depth?: number) => Promise<void> | void;
  onDetachMedia?: (mediaId: number) => Promise<void>;
  facesSortBy: string;
  onFacesSortChange: (sort: string) => void;
  onFetchFacesForMedia: (mediaId: number) => Promise<FaceRead[]>;
}

export function PersonContentTabs({
  person,
  detectedFacesList,
  hasMoreFaces,
  loadingMoreFaces,
  onTagAdded,
  loadMoreDetectedFaces,
  handleProfileAssignmentWrapper,
  handleAssignWrapper,
  handleCreateWrapper,
  handleDeleteWrapper,
  handleDetachWrapper,
  suggestedFaces,
  similarPersons,
  onMergeSelectedSimilar,
  onAutoMergeSimilar,
  isMergingSimilar,
  onTagUpdate,
  onRefreshSuggestions,
  onLoadSimilar,
  isLoadingSuggestedFaces,
  suggestedFacesLimit,
  onSuggestedFacesLimitChange,
  filterPeople,
  onFilterPeopleChange,
  filterTags,
  onFilterTagsChange,
  mediaListKey,
  relationshipGraph,
  relationshipDepth,
  isLoadingRelationships,
  hasLoadedRelationships,
  onLoadRelationships,
  onDetachMedia,
  facesSortBy,
  onFacesSortChange,
  onFetchFacesForMedia,
}: PersonContentTabsProps) {
  const [tabValue, setTabValue] = useState(0);
  const [faceTabValue, setFaceTabValue] = useState(0);
  const [hasLoadedSimilar, setHasLoadedSimilar] = useState(false);
  const [hasRequestedRelationships, setHasRequestedRelationships] =
    useState(false);
  const [isProcessingFaces, setIsProcessingFaces] = useState(false);
  const [pinnedFaces, setPinnedFaces] = useState<FaceRead[] | null>(null);
  const [isLoadingSimilarTab, setIsLoadingSimilarTab] = useState(false);
  const [selectedSimilarIds, setSelectedSimilarIds] = useState<number[]>([]);

  const createActionHandler = <
    T extends (...args: any[]) => Promise<unknown> | void,
  >(
    action: T,
  ): ((...args: Parameters<T>) => Promise<void>) => {
    return async (...args: Parameters<T>) => {
      setIsProcessingFaces(true);
      try {
        await Promise.resolve(action(...args));
      } catch (error) {
        console.error("An error occurred during the face action:", error);
        throw error;
      } finally {
        setIsProcessingFaces(false);
      }
    };
  };

  const handleAssign = createActionHandler(handleAssignWrapper);
  const handleCreate = createActionHandler(handleCreateWrapper);
  const handleDelete = createActionHandler(handleDeleteWrapper);
  const handleDetach = createActionHandler(handleDetachWrapper);

  const toggleSimilarSelection = (similarId: number) => {
    setSelectedSimilarIds((prev) =>
      prev.includes(similarId)
        ? prev.filter((value) => value !== similarId)
        : [...prev, similarId]
    );
  };

  const handleMergeSelectedClick = async () => {
    if (selectedSimilarIds.length === 0) {
      return;
    }
    try {
      const result = (await Promise.resolve(
        onMergeSelectedSimilar(selectedSimilarIds),
      )) as MergeResult | void;
      if (result && result.merged_ids && result.merged_ids.length > 0) {
        setSelectedSimilarIds([]);
      }
    } catch (error) {
      console.error("Failed to merge selected similar persons:", error);
    }
  };

  const handleAutoMergeClick = async () => {
    try {
      const result = (await Promise.resolve(
        onAutoMergeSimilar(),
      )) as MergeResult | void;
      if (result && result.merged_ids && result.merged_ids.length > 0) {
        setSelectedSimilarIds([]);
      }
    } catch (error) {
      console.error("Failed to auto-merge similar persons:", error);
    }
  };

  const handleJumpToFace = async (mediaId: number) => {
    setTabValue(1);
    setFaceTabValue(0);
    const faces = await onFetchFacesForMedia(mediaId);
    setPinnedFaces(faces.length > 0 ? faces : null);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    if (newValue !== 1) setPinnedFaces(null);

    if (newValue === 2 && !hasLoadedSimilar) {
      setHasLoadedSimilar(true);
      setIsLoadingSimilarTab(true);
      Promise.resolve(onLoadSimilar())
        .catch((error) =>
          console.error("Failed to load similar persons:", error),
        )
        .finally(() => setIsLoadingSimilarTab(false));
    }

    if (
      newValue === 3 &&
      !hasRequestedRelationships &&
      !hasLoadedRelationships
    ) {
      setHasRequestedRelationships(true);
      Promise.resolve(onLoadRelationships()).catch((error) => {
        console.error("Failed to load relationship graph:", error);
        setHasRequestedRelationships(false);
      });
    }
  };

  const handleFaceTabChange = (
    _event: React.SyntheticEvent,
    newValue: number,
  ) => {
    setFaceTabValue(newValue);
  };

  useEffect(() => {
    setHasLoadedSimilar(false);
    setHasRequestedRelationships(false);
    setIsLoadingSimilarTab(false);
    setTabValue(0);
    setFaceTabValue(0);
    setSelectedSimilarIds([]);
  }, [person.id]);

  useEffect(() => {
    setSelectedSimilarIds((prev) =>
      prev.filter((id) => similarPersons.some((similar) => similar.id === id))
    );
  }, [similarPersons]);

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="Person content tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label={`Media Appearances (${person.appearance_count})`} />
          <Tab label="Faces" />
          <Tab label="Similar People" />
          <Tab label="Relationship Graph" />
          <Tab label="Timeline" />
          <Tab label="Tags" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Suspense fallback={<CircularProgress />}>
          <MediaAppearances
            person={person}
            filterPeople={filterPeople}
            onFilterPeopleChange={onFilterPeopleChange}
            filterTags={filterTags}
            onFilterTagsChange={onFilterTagsChange}
            mediaListKey={mediaListKey}
          />
        </Suspense>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs
            value={faceTabValue}
            onChange={handleFaceTabChange}
            aria-label="Faces content tabs"
          >
            <Tab label="Confirmed" />
            <Tab label="Suggested" />
          </Tabs>
        </Box>

        <TabPanel value={faceTabValue} index={0}>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
            <Select
              size="small"
              value={facesSortBy}
              onChange={(e) => onFacesSortChange(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="id_desc">Newest added</MenuItem>
              <MenuItem value="date_desc">Newest photo</MenuItem>
              <MenuItem value="date_asc">Oldest photo</MenuItem>
            </Select>
          </Box>
          <Suspense fallback={<CircularProgress />}>
            <DetectedFaces
              isProcessing={isProcessingFaces}
              title="Confirmed Faces"
              faces={detectedFacesList}
              profileFaceId={person.profile_face_id}
              onSetProfile={(faceId) =>
                handleProfileAssignmentWrapper(faceId, person.id)
              }
              onAssign={handleAssign}
              onDelete={handleDelete}
              onDetach={handleDetach}
              onCreateMultiple={handleCreate}
              onLoadMore={loadMoreDetectedFaces}
              hasMore={hasMoreFaces}
              isLoadingMore={loadingMoreFaces}
              personId={person.id}
              pinnedFaces={pinnedFaces ?? undefined}
              onClearPinned={() => setPinnedFaces(null)}
            />
          </Suspense>
        </TabPanel>

        <TabPanel value={faceTabValue} index={1}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Typography variant="h6">Suggestions</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ width: 180 }}>
                <Typography variant="caption" color="text.secondary">
                  Limit: {suggestedFacesLimit}
                </Typography>
                <Slider
                  value={suggestedFacesLimit}
                  min={10}
                  max={300}
                  step={10}
                  size="small"
                  disabled={isLoadingSuggestedFaces}
                  onChange={(_, value) =>
                    onSuggestedFacesLimitChange(value as number)
                  }
                  onChangeCommitted={(_, value) => {
                    onSuggestedFacesLimitChange(value as number);
                    void onRefreshSuggestions();
                  }}
                />
              </Box>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  void onRefreshSuggestions();
                }}
                disabled={isLoadingSuggestedFaces}
                startIcon={
                  isLoadingSuggestedFaces ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : undefined
                }
              >
                {isLoadingSuggestedFaces ? "Refreshing..." : "Refresh Suggestions"}
              </Button>
            </Box>
          </Box>
          <Suspense fallback={<CircularProgress />}>
            <DetectedFaces
              isProcessing={isProcessingFaces || isLoadingSuggestedFaces}
              title="Suggested Faces"
              faces={suggestedFaces}
              onAssign={handleAssign}
              onDelete={handleDelete}
              onDetach={handleDetach}
              onCreateMultiple={handleCreate}
              personId={person.id}
            />
          </Suspense>
        </TabPanel>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 1.5,
            mb: 2,
          }}
        >
          <Typography variant="h6">Similar People</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {selectedSimilarIds.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                {selectedSimilarIds.length} selected
              </Typography>
            )}
            <Button
              variant="outlined"
              size="small"
              onClick={handleAutoMergeClick}
              disabled={isMergingSimilar || isLoadingSimilarTab}
              startIcon={
                isMergingSimilar ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {isMergingSimilar ? "Auto Merging..." : "Auto Merge"}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleMergeSelectedClick}
              disabled={
                isMergingSimilar || selectedSimilarIds.length === 0
              }
            >
              {isMergingSimilar ? "Merging..." : "Merge Selected"}
            </Button>
          </Box>
        </Box>

        {similarPersons.length > 0 ? (
          <Grid container spacing={2}>
            {similarPersons.map((similar) => (
              <Grid key={similar.id} size={{ xs: 6, sm: 3, md: 2 }}>
                <SimilarPersonCard
                  {...similar}
                  selectable
                  selected={selectedSimilarIds.includes(similar.id)}
                  onToggleSelect={() => toggleSimilarSelection(similar.id)}
                />
              </Grid>
            ))}
          </Grid>
        ) : isLoadingSimilarTab || isMergingSimilar ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : hasLoadedSimilar ? (
          <Typography color="text.secondary">
            No similar people found yet.
          </Typography>
        ) : null}
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <Suspense fallback={<CircularProgress />}>
          <PersonRelationshipGraph
            graph={relationshipGraph}
            depth={relationshipDepth}
            isLoading={isLoadingRelationships}
            onDepthChange={(depthValue) => onLoadRelationships(depthValue)}
          />
        </Suspense>
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <Suspense fallback={<CircularProgress />}>
          <TimelineTab
            person={person}
            onDetachMedia={onDetachMedia}
            onJumpToFace={handleJumpToFace}
          />
        </Suspense>
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <TagsSection
          person={person}
          onTagAdded={(newTag) => onTagAdded(newTag)}
          onUpdate={onTagUpdate}
        />
      </TabPanel>
    </Box>
  );
}
