import React, { useEffect, useState } from "react";
import {
  useNavigate,
  useLocation,
  Link,
} from "react-router-dom";
import {
  AppBar,
  Box,
  Toolbar,
  TextField,
  Select,
  MenuItem,
  IconButton,
  Drawer,
  Typography,
  Badge,
  Tooltip,
  Button,
  useMediaQuery,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import TaskManager from "../components/TasksPanel";
import ThemeToggleButton from "../components/ThemeToggleButton";
import { searchByImage } from "../services/searchActions";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import AssignmentIcon from "@mui/icons-material/Assignment";
import config from "../config";
import { useTheme } from "@mui/material/styles";
import { useTaskEvents } from "../TaskEventsContext";
import { Sidebar } from "./Sidebar";
import { useSelection } from "../context/SelectionContext";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";

function TaskStatusButton({ onClick }: { onClick: () => void }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { activeTasks } = useTaskEvents();
  const activeCount = activeTasks.filter(
    (t) => t.status === "running" || t.status === "pending"
  ).length;
  const hasActive = activeCount > 0;

  if (isMobile) {
    return (
      <Tooltip title="Tasks & Processing — run scans, tagging, cleanup, and other jobs">
        <IconButton
          onClick={onClick}
          color={hasActive ? "primary" : "default"}
          size="large"
          sx={{ p: 1 }}
        >
          <Badge badgeContent={activeCount} color="error">
            <AssignmentIcon />
          </Badge>
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Tooltip title="Tasks & Processing — run scans, tagging, cleanup, and other jobs">
      <Button
        onClick={onClick}
        variant={hasActive ? "contained" : "outlined"}
        color="primary"
        size="small"
        disableElevation
        sx={{
          textTransform: "none",
          borderRadius: 2,
          px: 1.5,
          py: 0.75,
          gap: 1,
          minHeight: 42,
          boxShadow: hasActive ? 2 : 0,
          bgcolor: hasActive ? "primary.main" : "background.paper",
          color: hasActive ? "primary.contrastText" : "text.primary",
          "&:hover": {
            bgcolor: hasActive ? "primary.dark" : undefined,
          },
        }}
      >
        <Badge
          badgeContent={activeCount}
          color="error"
          overlap="circular"
          sx={{ "& .MuiBadge-badge": { fontWeight: 700, minWidth: 18 } }}
        >
          <AssignmentIcon fontSize="small" />
        </Badge>
        <Box sx={{ textAlign: "left", lineHeight: 1.1 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            Tasks & Processing
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            Run scans & jobs
          </Typography>
        </Box>
      </Button>
    </Tooltip>
  );
}

export function Header() {
  const theme = useTheme();
  const base = import.meta.env.BASE_URL || "/";
  const wordmarkSrc = `${base}brand/omoide_header_${theme.palette.mode}.png`;
  const { isSelecting, selectedIds, toggleSelecting } = useSelection();
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"media" | "tag" | "scene">(
    "media"
  );
  // Force a re-render when runtime config updates (e.g., read-only flag changes)
  const [configTick, setConfigTick] = useState(0);
  const navigate = useNavigate();
  const fileInputRef = React.useRef<HTMLInputElement>(null); // Ref for the hidden file input
  const location = useLocation();

  useEffect(() => {
    const handler = () => setConfigTick((v) => v + 1);
    window.addEventListener("runtime-config-updated", handler as EventListener);
    return () =>
      window.removeEventListener(
        "runtime-config-updated",
        handler as EventListener
      );
  }, []);

  // Keep the search input in sync with the URL on the search results route
  useEffect(() => {
    if (location.pathname !== "/searchresults") return;
    const params = new URLSearchParams(location.search);
    const urlQuery = params.get("query");
    const urlCategory = params.get("category");
    if (urlQuery !== null) setQ(urlQuery);
    if (
      urlCategory === "media" ||
      urlCategory === "tag" ||
      urlCategory === "scene"
    ) {
      setCategory(urlCategory);
    }
  }, [location.pathname, location.search]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    navigate(
      `/searchresults?` +
        new URLSearchParams({ category, query: trimmed }).toString(),
      { state: { timestamp: Date.now() } }
    );
    setIsSearchVisible(false);
  }

  const renderDefaultHeader = () => (
    <>
      {/* Mobile Menu Button */}
      <IconButton
        color="inherit"
        aria-label="open drawer"
        edge="start"
        onClick={() => setIsDrawerOpen(true)}
        sx={{ mr: 2, display: { md: "none" } }}
      >
        <MenuIcon />
      </IconButton>

      {/* Logo (Mobile Only - Desktop uses Sidebar) */}
      <Box sx={{ display: { xs: "block", md: "none" }, flexGrow: 1 }}>
        <Link to="/">
          <Box
            component="img"
            src={wordmarkSrc}
            alt="omoide logo"
            sx={{
              height: 32,
              width: "auto",
              display: "block",
            }}
          />
        </Link>
      </Box>

      {/* Search Inputs (Desktop) */}
      <Box sx={{ display: { xs: "none", md: "flex" }, flexGrow: 1, maxWidth: 600, mx: 4 }}>
        {renderSearchInputs()}
      </Box>

      <Box sx={{ flexGrow: { xs: 0, md: 1 } }} />
      
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ display: { xs: "none", md: "flex" } }}>
          <ThemeToggleButton />
        </Box>

        <Tooltip title={isSelecting ? `Select mode — ${selectedIds.size} selected` : "Select items"}>
          <IconButton
            onClick={toggleSelecting}
            color={isSelecting ? "primary" : "default"}
            size="large"
            sx={{ p: 1 }}
          >
            {isSelecting ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
          </IconButton>
        </Tooltip>

        {!config.PRESENTATION_MODE && (
          <TaskStatusButton onClick={() => setIsControlPanelOpen(true)} />
        )}

        <Box sx={{ display: { xs: "flex", md: "none" } }}>
          <IconButton color="primary" onClick={() => setIsSearchVisible(true)}>
            <SearchIcon />
          </IconButton>
        </Box>
      </Box>
    </>
  );

  const renderSearchInputs = () => (
    <Box
      component="form"
      onSubmit={onSearchSubmit}
      sx={{ display: "flex", flexGrow: 1, alignItems: "center" }}
    >
      <Select
        variant="outlined"
        size="small"
        value={category}
        onChange={(e) =>
          setCategory(e.target.value as "media" | "tag" | "scene")
        }
        sx={{ 
            borderTopRightRadius: 0, 
            borderBottomRightRadius: 0,
            bgcolor: 'background.paper',
            minWidth: 100
        }}
      >
        <MenuItem value="media">Media</MenuItem>
        <MenuItem value="tag">Tags</MenuItem>
        <MenuItem value="scene">Scenes</MenuItem>
      </Select>
      <TextField
        variant="outlined"
        size="small"
        fullWidth
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search..."
        sx={{
          "& .MuiOutlinedInput-root": {
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            bgcolor: 'background.paper'
          },
        }}
      />
      <IconButton
        color="primary"
        title="Search by image"
        onClick={() => fileInputRef.current?.click()} // Trigger the hidden input
        sx={{ ml: 1 }}
      >
        <PhotoCameraIcon />
      </IconButton>
      <button type="submit" style={{ display: "none" }} />
    </Box>
  );

  const renderSearchHeader = () => (
    <>
      <IconButton color="primary" onClick={() => setIsSearchVisible(false)}>
        <ArrowBackIcon />
      </IconButton>
      {renderSearchInputs()}
    </>
  );

  const handleImageSearch = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const results = await searchByImage(file);
      navigate("/searchresults?category=media&query=Image Search", {
        state: {
          items: results,
          searchType: "image",
        },
      });
    } catch (error) {
      console.error("Image search failed:", error);
    }

    if (event.target) event.target.value = "";
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageSearch}
        accept="image/*"
        style={{ display: "none" }}
      />
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backgroundColor: "background.default", // Transparent/Default to blend with content
          borderBottom: "1px solid",
          borderColor: "divider",
          backdropFilter: "blur(8px)",
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          {isSearchVisible ? renderSearchHeader() : renderDefaultHeader()}
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="left"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        ModalProps={{
            keepMounted: true, // Better open performance on mobile.
        }}
        sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: 280 },
        }}
      >
        <Sidebar variant="temporary" onClose={() => setIsDrawerOpen(false)} />
      </Drawer>

      <Drawer
        anchor="right"
        open={isControlPanelOpen}
        onClose={() => setIsControlPanelOpen(false)}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: "background.default",
              color: "text.primary",
              width: 320,
            },
          },
        }}
      >
        {!config.PRESENTATION_MODE && (
          <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 2, fontWeight: 700 }}
            >
              Task Manager
            </Typography>
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                <TaskManager isActive={isControlPanelOpen} />
            </Box>
          </Box>
        )}
      </Drawer>
    </>
  );
}
