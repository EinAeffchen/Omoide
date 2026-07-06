import React, { Suspense, lazy, MutableRefObject } from "react";
import { Box, Tabs, Tab, CircularProgress } from "@mui/material";

import { TagsSection } from "./TagsSection";
import { MediaExif } from "./MediaExif";
import { MediaDetail, Tag } from "../types";
import { Media } from "../types";
import config from "../config";
import { PeopleTabContent } from "./PeopleTabContent";
import { FaceAppearanceStrip } from "./FaceAppearanceStrip";
import { SceneManager } from "./SceneManager";
import TagIcon from "@mui/icons-material/Tag";
import PeopleIcon from "@mui/icons-material/People";
import CollectionsIcon from "@mui/icons-material/Collections";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ReplayIcon from "@mui/icons-material/Replay";
import MovieIcon from "@mui/icons-material/Movie";
import { MediaProcessorsTab } from "./MediaProcessorsTab";

const SimilarContent = lazy(() => import("./MediaRelatedContent"));

interface TabPanelProps {
  children?: React.ReactNode;
  index: string;
  value: string;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

interface MediaContentTabsProps {
  detail: MediaDetail;
  tabKey: string;
  onTabChange: (key: string) => void;
  onTagUpdate: (updatedMedia: Media) => void;
  onTagAdded: (newTag: Tag) => void;
  onDetailReload: () => void;
  onSeekRequest: (time: number) => void;
  videoTimeRef?: MutableRefObject<number>;
}

export function MediaContentTabs(props: MediaContentTabsProps) {
  const {
    detail,
    tabKey,
    onTabChange,
    onTagUpdate,
    onTagAdded,
    onDetailReload,
    onSeekRequest,
    videoTimeRef,
  } = props;

  const { media, persons, orphans } = detail;

  const isVideo = typeof media?.duration === "number";

  // Build tabs dynamically so keys stay stable regardless of feature flags
  const tabs: { key: string; label: string; icon: React.ReactNode }[] = [];
  if (isVideo) tabs.push({ key: "scenes", label: "Scenes", icon: <MovieIcon /> });
  tabs.push({ key: "similar", label: "Similar", icon: <CollectionsIcon /> });
  if (config.ENABLE_PEOPLE && persons)
    tabs.push({
      key: "people",
      label: `People (${persons.length})`,
      icon: <PeopleIcon />,
    });
  tabs.push({ key: "tags", label: "Tags", icon: <TagIcon /> });
  tabs.push({ key: "exif", label: "Exif Data", icon: <DataObjectIcon /> });
  tabs.push({ key: "processors", label: "Processors", icon: <ReplayIcon /> });

  // Fall back to the first tab when the current media type lacks the selected tab
  const activeTab = tabs.some((t) => t.key === tabKey) ? tabKey : tabs[0].key;

  const handleTabChange = (_: React.SyntheticEvent, newValue: string) =>
    onTabChange(newValue);

  return (
    <Box sx={{ width: "100%", mt: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label="Media content tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          {tabs.map((t) => (
            <Tab
              key={t.key}
              value={t.key}
              label={t.label}
              icon={t.icon}
              iconPosition="start"
              sx={{ minHeight: "64px" }}
            />
          ))}
        </Tabs>
      </Box>

      {media && (
        <>
          {isVideo && (
            <TabPanel value={activeTab} index="scenes">
              <SceneManager
                mediaId={media.id}
                duration={media.duration!}
                persons={persons ?? []}
                onSeekRequest={onSeekRequest}
                videoTimeRef={videoTimeRef}
              />
            </TabPanel>
          )}

          <TabPanel value={activeTab} index="similar">
            <Suspense fallback={<CircularProgress />}>
              <SimilarContent mediaId={media.id} />
            </Suspense>
          </TabPanel>

          {config.ENABLE_PEOPLE && (
            <TabPanel value={activeTab} index="people">
              {isVideo && (
                <FaceAppearanceStrip
                  faces={media.faces ?? []}
                  onSeekRequest={onSeekRequest}
                />
              )}
              <PeopleTabContent
                mediaId={media.id}
                initialPersons={persons}
                initialOrphans={orphans}
                onDataChanged={onDetailReload}
              />
            </TabPanel>
          )}

          <TabPanel value={activeTab} index="tags">
            <TagsSection
              media={media}
              onTagAdded={onTagAdded}
              onUpdate={onTagUpdate}
            />
          </TabPanel>

          <TabPanel value={activeTab} index="exif">
            <MediaExif mediaId={media.id} />
          </TabPanel>

          <TabPanel value={activeTab} index="processors">
            <MediaProcessorsTab mediaId={media.id} />
          </TabPanel>
        </>
      )}
    </Box>
  );
}
