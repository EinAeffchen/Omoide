import React from "react";
import { Box, Tabs, Tab } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import LabelOffIcon from "@mui/icons-material/LabelOff";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import PhotoSizeSelectSmallIcon from "@mui/icons-material/PhotoSizeSelectSmall";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";

export const MAINTENANCE_TABS = [
  { label: "Duplicates", to: "/duplicates", icon: <ContentCopyIcon fontSize="small" /> },
  { label: "Missing Files", to: "/missing", icon: <BrokenImageIcon fontSize="small" /> },
  { label: "Blurry Images", to: "/blur", icon: <BlurOnIcon fontSize="small" /> },
  { label: "Untagged Media", to: "/untagged", icon: <LabelOffIcon fontSize="small" /> },
  { label: "Short Videos", to: "/shortvideos", icon: <VideocamOffIcon fontSize="small" /> },
  { label: "Low Resolution", to: "/lowresolution", icon: <PhotoSizeSelectSmallIcon fontSize="small" /> },
  { label: "No EXIF Date", to: "/noexifdate", icon: <EventBusyIcon fontSize="small" /> },
  { label: "Broken Media", to: "/broken", icon: <ReportProblemIcon fontSize="small" /> },
];

export const MAINTENANCE_PATHS = MAINTENANCE_TABS.map((tab) => tab.to);

interface MaintenanceShellProps {
  children: React.ReactNode;
}

/** Tab bar shared by all maintenance/review pages so they read as one section. */
export function MaintenanceShell({ children }: MaintenanceShellProps) {
  const location = useLocation();

  return (
    <Box>
      <Tabs
        value={location.pathname}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", px: { xs: 1, sm: 2 } }}
      >
        {MAINTENANCE_TABS.map((tab) => (
          <Tab
            key={tab.to}
            label={tab.label}
            icon={tab.icon}
            iconPosition="start"
            value={tab.to}
            component={Link}
            to={tab.to}
            sx={{ minHeight: 48, py: 1 }}
          />
        ))}
      </Tabs>
      {children}
    </Box>
  );
}
