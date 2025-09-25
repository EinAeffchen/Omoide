import React, { useState } from "react";
import {
  Box,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Divider,
} from "@mui/material";
import { MoreVert, Vrpano, Delete, FolderOpen } from "@mui/icons-material";
import { Media } from "../types";
import config from "../config";
import { BinaryNavigationControls } from "./BinaryNavigationControls";
const ERROR_COLOR = "error.main";

interface MediaHeaderProps {
  media: Media;
  showExif: boolean;
  onToggleExif: () => void;
  onOpenDialog: (type: "convert" | "deleteRecord" | "deleteFile") => void;
  isBinary?: boolean;
  onOpenFolder?: (mediaId: number) => void;
}

export function MediaHeader({
  media,
  onOpenDialog,
  isBinary = false,
  onOpenFolder,
}: MediaHeaderProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleAction = (type: "convert" | "deleteRecord" | "deleteFile") => {
    try {
      onOpenDialog(type);
    } catch (error) {
      console.error("Failed to handle action:", error);
    } finally {
      handleMenuClose();
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: { xs: "wrap", sm: "nowrap" },
        gap: 2,
        mb: 2,
        width: "100%",
      }}
    >
      <Box
        sx={{
          width: { xs: "100%", sm: "auto" },
          textAlign: "left",
          mb: { xs: 1, sm: 0 },
        }}
      >
        <Typography
          variant="h4"
          component="h1"
          noWrap
          sx={{
            fontSize: "clamp(1.25rem, 4vw, 1.75rem)",
          }}
        >
          {media.filename}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <BinaryNavigationControls variant="overlay" />
        <IconButton onClick={handleMenuClick} color="primary">
          <MoreVert />
        </IconButton>

        {!config.READ_ONLY && (
          <Menu anchorEl={anchorEl} open={menuOpen} onClose={handleMenuClose}>
            <>
              <Divider />
              {isBinary && (
                <MenuItem
                  onClick={() => {
                    onOpenFolder?.(media.id);
                    handleMenuClose();
                  }}
                >
                  <ListItemIcon>
                    <FolderOpen fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>Open Containing Folder</ListItemText>
                </MenuItem>
              )}
              {media.duration && (
                <MenuItem onClick={() => handleAction("convert")}>
                  <ListItemIcon>
                    <Vrpano fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>Convert</ListItemText>
                </MenuItem>
              )}
              <MenuItem
                onClick={() => handleAction("deleteRecord")}
                sx={{ color: ERROR_COLOR }}
              >
                <ListItemIcon>
                  <Delete fontSize="small" sx={{ color: ERROR_COLOR }} />
                </ListItemIcon>
                <ListItemText>Delete Record</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => handleAction("deleteFile")}
                sx={{ color: ERROR_COLOR }}
              >
                <ListItemIcon>
                  <Delete fontSize="small" sx={{ color: ERROR_COLOR }} />
                </ListItemIcon>
                <ListItemText>Delete File</ListItemText>
              </MenuItem>
            </>
          </Menu>
        )}
      </Box>
    </Box>
  );
}
