import React from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Divider,
  useTheme,
  Typography,
} from "@mui/material";
import { NavLink as RouterNavLink, useLocation, Link } from "react-router-dom";
import { useSelection } from "../context/SelectionContext";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import MovieIcon from "@mui/icons-material/Movie";
import LabelIcon from "@mui/icons-material/Label";
import PeopleIcon from "@mui/icons-material/People";
import FaceIcon from "@mui/icons-material/Face";
import MapIcon from "@mui/icons-material/Map";
import AddLocationIcon from "@mui/icons-material/AddLocation";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import SettingsIcon from "@mui/icons-material/Settings";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import LabelOffIcon from "@mui/icons-material/LabelOff";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import PhotoSizeSelectSmallIcon from "@mui/icons-material/PhotoSizeSelectSmall";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import StarIcon from "@mui/icons-material/Star";
import TheatersIcon from "@mui/icons-material/Theaters";
import PublicIcon from "@mui/icons-material/Public";
import InsightsIcon from "@mui/icons-material/Insights";
import config from "../config";

const DRAWER_WIDTH = 280;

type NavItem = {
  label: string;
  to: string;
  icon: React.ReactNode;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

interface SidebarProps {
  variant?: "permanent" | "temporary";
  onClose?: () => void;
}

export function Sidebar({ variant = "permanent", onClose }: SidebarProps) {
  const theme = useTheme();
  const location = useLocation();
  const { isSelecting, selectedIds, toggleSelecting } = useSelection();
  const selectedCount = selectedIds.size;
  const base = import.meta.env.BASE_URL || "/";
  const wordmarkSrc = `${base}brand/omoide_header_${theme.palette.mode}.png`;
  const isTemporary = variant === "temporary";

  const RAW_SECTIONS: NavSection[] = [
    {
      label: "Library",
      items: [
        { label: "Images", to: "/images", icon: <PhotoLibraryIcon /> },
        { label: "Videos", to: "/videos", icon: <MovieIcon /> },
        { label: "Albums", to: "/albums", icon: <PhotoAlbumIcon /> },
        { label: "Events", to: "/events", icon: <TheatersIcon /> },
        { label: "Highlights", to: "/highlights", icon: <StarIcon /> },
        { label: "Tags", to: "/tags", icon: <LabelIcon /> },
      ],
    },
    {
      label: "People",
      items: [
        { label: "People", to: "/people", icon: <PeopleIcon /> },
        { label: "Unassigned Faces", to: "/orphanfaces", icon: <FaceIcon /> },
        {
          label: "No Persons Detected",
          to: "/nopersons",
          icon: <PersonOffIcon />,
        },
      ],
    },
    {
      label: "Map",
      items: [
        { label: "Map View", to: "/map", icon: <MapIcon /> },
        { label: "Places", to: "/places", icon: <PublicIcon /> },
        { label: "Add Locations", to: "/geotagger", icon: <AddLocationIcon /> },
      ],
    },
    {
      label: "Maintenance",
      items: [
        { label: "Duplicates", to: "/duplicates", icon: <ContentCopyIcon /> },
        { label: "Missing Files", to: "/missing", icon: <BrokenImageIcon /> },
        { label: "Blurry Images", to: "/blur", icon: <BlurOnIcon /> },
        { label: "Untagged Media", to: "/untagged", icon: <LabelOffIcon /> },
        {
          label: "Short Videos",
          to: "/shortvideos",
          icon: <VideocamOffIcon />,
        },
        {
          label: "Low Resolution",
          to: "/lowresolution",
          icon: <PhotoSizeSelectSmallIcon />,
        },
        { label: "No EXIF Date", to: "/noexifdate", icon: <EventBusyIcon /> },
        { label: "Broken Media", to: "/broken", icon: <ReportProblemIcon /> },
      ],
    },
    {
      label: "System",
      items: [
        {
          label: "Statistics",
          to: "/statistics",
          icon: <InsightsIcon />,
        },
        {
          label: "Configuration",
          to: "/configuration",
          icon: <SettingsIcon />,
        },
      ],
    },
  ];

  const pathsToExcludeInReadOnly: string[] = [
    "/orphanfaces",
    "/geotagger",
    "/duplicates",
    "/configuration",
    "/missing",
    "/blur",
    "/nopersons",
    "/untagged",
    "/shortvideos",
    "/lowresolution",
    "/noexifdate",
    "/broken",
  ];
  const pathsToExcludeInPeopleDisabled: string[] = [
    "/people",
    "/orphanfaces",
    "/nopersons",
  ];
  const shouldHidePath = (path: string) =>
    (config.PRESENTATION_MODE && pathsToExcludeInReadOnly.includes(path)) ||
    (!config.ENABLE_PEOPLE && pathsToExcludeInPeopleDisabled.includes(path));

  const navSections: NavSection[] = RAW_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((it) => !shouldHidePath(it.to)),
  })).filter((section) => section.items.length > 0);

  // Map detail routes to their owning section so a sensible nav item highlights
  const activePath = (() => {
    const { pathname } = location;
    if (pathname.startsWith("/tag/")) return "/tags";
    if (pathname.startsWith("/person/")) return "/people";
    if (pathname.startsWith("/album/")) return "/albums";
    if (pathname.startsWith("/event/")) return "/events";
    if (pathname.startsWith("/places/")) return "/places";
    if (pathname.startsWith("/medium/")) return null;
    return pathname;
  })();

  return (
    <Box
      sx={{
        width: isTemporary ? "100%" : DRAWER_WIDTH,
        flexShrink: 0,
        borderRight: isTemporary ? "none" : "1px solid",
        borderColor: "divider",
        height: isTemporary ? "100%" : "100vh",
        position: isTemporary ? "static" : "sticky",
        top: 0,
        display: isTemporary ? "flex" : { xs: "none", md: "flex" },
        flexDirection: "column",
        bgcolor: "background.paper",
        overflowY: "auto",
      }}
    >
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Link to="/">
          <Box
            component="img"
            src={wordmarkSrc}
            alt="omoide"
            sx={{ width: 140, height: "auto" }}
          />
        </Link>
      </Box>
      <Divider sx={{ mb: 2 }} />

      <List component="nav" sx={{ px: 2 }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <ListItemButton
            onClick={toggleSelecting}
            selected={isSelecting}
            sx={{
              borderRadius: 2,
              py: 1,
              "&.Mui-selected": {
                bgcolor: "action.selected",
                color: "primary.main",
                "& .MuiListItemIcon-root": { color: "primary.main" },
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: isSelecting ? "primary.main" : "text.secondary",
              }}
            >
              {isSelecting ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
            </ListItemIcon>
            <ListItemText
              primary={
                isSelecting && selectedCount > 0
                  ? `${selectedCount} selected`
                  : "Select Mode"
              }
              primaryTypographyProps={{
                fontWeight: isSelecting ? 600 : 500,
                fontSize: "0.9rem",
              }}
            />
          </ListItemButton>
        </Box>
        {navSections.map((section) => (
          <React.Fragment key={section.label}>
            <ListSubheader
              disableSticky
              sx={{
                bgcolor: "transparent",
                color: "text.secondary",
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                mt: 2,
                mb: 1,
                lineHeight: 1,
              }}
            >
              {section.label}
            </ListSubheader>
            {section.items.map((item) => {
              const isActive =
                activePath !== null &&
                (activePath === item.to ||
                  activePath.startsWith(`${item.to}/`));
              return (
                <ListItem key={item.to} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    component={RouterNavLink}
                    to={item.to}
                    selected={isActive}
                    sx={{
                      borderRadius: 2,
                      py: 1,
                      "&.active": {
                        bgcolor: "action.selected",
                        color: "primary.main",
                        "& .MuiListItemIcon-root": {
                          color: "primary.main",
                        },
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 40,
                        color: isActive ? "primary.main" : "text.secondary",
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontWeight: isActive ? 600 : 500,
                        fontSize: "0.9rem",
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </React.Fragment>
        ))}
      </List>

      <Box sx={{ flexGrow: 1 }} />

      <Divider />

      <Box sx={{ px: 2, pb: 1.5, textAlign: "center" }}>
        <Typography variant="caption" color="text.secondary">
          v{config.APP_VERSION}
        </Typography>
      </Box>
    </Box>
  );
}
