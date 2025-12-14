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
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import MovieIcon from "@mui/icons-material/Movie";
import LabelIcon from "@mui/icons-material/Label";
import PeopleIcon from "@mui/icons-material/People";
import FaceIcon from "@mui/icons-material/Face";
import MapIcon from "@mui/icons-material/Map";
import AddLocationIcon from "@mui/icons-material/AddLocation";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ImageSearchIcon from "@mui/icons-material/ImageSearch";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import SettingsIcon from "@mui/icons-material/Settings";
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
  const base = import.meta.env.BASE_URL || "/";
  const wordmarkSrc = `${base}brand/omoide_header_${theme.palette.mode}.png`;
  const isTemporary = variant === "temporary";

  const RAW_SECTIONS: NavSection[] = [
    {
      label: "Library",
      items: [
        { label: "Images", to: "/images", icon: <PhotoLibraryIcon /> },
        { label: "Videos", to: "/videos", icon: <MovieIcon /> },
        { label: "Tags", to: "/tags", icon: <LabelIcon /> },
      ],
    },
    {
      label: "People",
      items: [
        { label: "People", to: "/people", icon: <PeopleIcon /> },
        { label: "Unassigned Faces", to: "/orphanfaces", icon: <FaceIcon /> },
      ],
    },
    {
      label: "Map",
      items: [
        { label: "Map View", to: "/map", icon: <MapIcon /> },
        { label: "Add Locations", to: "/geotagger", icon: <AddLocationIcon /> },
      ],
    },
    {
      label: "Maintenance",
      items: [
        { label: "Duplicates", to: "/duplicates", icon: <ContentCopyIcon /> },
        { label: "Missing Files", to: "/missing", icon: <BrokenImageIcon /> },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Configuration", to: "/configuration", icon: <SettingsIcon /> },
      ],
    },
  ];

  const pathsToExcludeInReadOnly: string[] = [
    "/orphanfaces",
    "/geotagger",
    "/duplicates",
    "/configuration",
    "/missing",
  ];
  const pathsToExcludeInPeopleDisabled: string[] = ["/people", "/orphanfaces"];
  const shouldHidePath = (path: string) =>
    (config.PRESENTATION_MODE && pathsToExcludeInReadOnly.includes(path)) ||
    (!config.ENABLE_PEOPLE && pathsToExcludeInPeopleDisabled.includes(path));

  const navSections: NavSection[] = RAW_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((it) => !shouldHidePath(it.to)),
  })).filter((section) => section.items.length > 0);

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
      <Box sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              const isActive = location.pathname.startsWith(item.to);
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
      
      <Box sx={{ p: 2, textAlign: 'center' }}>
         <Typography variant="caption" color="text.secondary">
            v{config.APP_VERSION}
         </Typography>
      </Box>
    </Box>
  );
}
