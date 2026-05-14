import React, { Suspense, useState } from "react";
import { Box, Tabs, Tab, CircularProgress } from "@mui/material";

import { TagsSection } from "./TagsSection";
import SimilarContent from "./MediaRelatedContent";
import { MediaExif } from "./MediaExif";
import { MediaDetail, Tag } from "../types";
import { Media } from "../types";
import config from "../config";
import { PeopleTabContent } from "./PeopleTabContent";
import TagIcon from "@mui/icons-material/Tag";
import PeopleIcon from "@mui/icons-material/People";
import CollectionsIcon from "@mui/icons-material/Collections";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ReplayIcon from "@mui/icons-material/Replay";
import { MediaProcessorsTab } from "./MediaProcessorsTab";
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
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
  onTagUpdate: (updatedMedia: Media) => void;
  onTagAdded: (newTag: Tag) => void;
  onDetailReload: () => void;
}

export function MediaContentTabs(props: MediaContentTabsProps) {
  const { detail, onTagUpdate, onTagAdded, onDetailReload } = props;

  const [tabValue, setTabValue] = useState(0);
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) =>
    setTabValue(newValue);
  const { media, persons, orphans } = detail;

  const renderTab = (label: string, icon: React.ReactNode) => (
    <Tab
      label={label}
      icon={icon}
      iconPosition="start"
      sx={{ minHeight: "64px" }} // Taller tabs for a better look
    />
  );
  const tabIndices = {
    similar: 0,
    people: config.ENABLE_PEOPLE ? 1 : -1, // -1 if not rendered
    tags: config.ENABLE_PEOPLE ? 2 : 1,
    exif: config.ENABLE_PEOPLE ? 3 : 2,
    processors: config.ENABLE_PEOPLE ? 4 : 3,
  };

  return (
    <Box sx={{ width: "100%", mt: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="Media content tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          {renderTab("Similar", <CollectionsIcon />)}
          {config.ENABLE_PEOPLE &&
            persons &&
            renderTab(`People (${persons.length})`, <PeopleIcon />)}
          {renderTab("Tags", <TagIcon />)}
          {renderTab("Exif Data", <DataObjectIcon />)}
          {renderTab("Processors", <ReplayIcon />)}
        </Tabs>
      </Box>
      {media && (
        <>
          <TabPanel value={tabValue} index={tabIndices.similar}>
            <Suspense fallback={<CircularProgress />}>
              {media && <SimilarContent mediaId={media.id} />}
            </Suspense>
          </TabPanel>
          {config.ENABLE_PEOPLE && (
            <TabPanel value={tabValue} index={tabIndices.people}>
              {/* The People tab now uses its own smart component */}
              <PeopleTabContent
                mediaId={media.id}
                initialPersons={persons}
                initialOrphans={orphans}
                onDataChanged={onDetailReload}
              />
            </TabPanel>
          )}
          <TabPanel value={tabValue} index={tabIndices.tags}>
            <TagsSection
              media={media}
              onTagAdded={onTagAdded}
              onUpdate={onTagUpdate}
            />
          </TabPanel>

          <TabPanel value={tabValue} index={tabIndices.exif}>
            <MediaExif mediaId={media.id} />
          </TabPanel>
          <TabPanel value={tabValue} index={tabIndices.processors}>
            <MediaProcessorsTab mediaId={media.id} />
          </TabPanel>
        </>
      )}
    </Box>
  );
}
