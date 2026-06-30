import React from "react";
import { Box, Button, IconButton, Paper, Tooltip } from "@mui/material";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import { MediaPreview } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

interface MediaItemGroupProps {
  mediaItems: MediaPreview[];
  onViewAll: () => void;
  onRemoveMedia?: (mediaId: number) => void;
  onJumpToFace?: (mediaId: number) => void;
}

export const MediaItemGroup: React.FC<MediaItemGroupProps> = ({
  mediaItems,
  onViewAll,
  onRemoveMedia,
  onJumpToFace,
}) => {
  const previewItems = mediaItems.slice(0, 3);

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}
    >
      {/* Photo Stack Preview */}
      <Box
        sx={{ position: "relative", height: "120px", cursor: "pointer" }}
      >
        {previewItems.map((media, index) => (
          <Box
            key={media.id}
            sx={{
              position: "absolute",
              height: "100px",
              width: "100px",
              top: `${index * 8}px`,
              left: `${index * 8}px`,
              transform: `rotate(${index * 4 - 4}deg)`,
              transition: "transform 0.2s ease-in-out",
              "&:hover": {
                transform: `rotate(${index * 4 - 4}deg) scale(1.05)`,
                "& .remove-btn": { opacity: 1 },
              },
            }}
          >
            <Box
              component="img"
              src={`${API}/thumbnails/${media.thumbnail_path ? encodeFilePath(media.thumbnail_path) : `${media.id}.jpg`}`}
              onClick={onViewAll}
              sx={{
                height: "100px",
                width: "100px",
                objectFit: "cover",
                borderRadius: 1,
                boxShadow: 3,
                display: "block",
              }}
            />
            {onJumpToFace && (
              <Tooltip title="Find face in Faces tab">
                <IconButton
                  className="remove-btn"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onJumpToFace(media.id); }}
                  sx={{
                    position: "absolute",
                    top: -8,
                    left: -8,
                    opacity: 0,
                    transition: "opacity 0.15s",
                    bgcolor: "background.paper",
                    p: 0,
                    "&:hover": { bgcolor: "background.paper" },
                  }}
                >
                  <PersonSearchIcon color="primary" fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onRemoveMedia && (
              <IconButton
                className="remove-btn"
                size="small"
                onClick={(e) => { e.stopPropagation(); onRemoveMedia(media.id); }}
                sx={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  opacity: 0,
                  transition: "opacity 0.15s",
                  bgcolor: "background.paper",
                  p: 0,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <RemoveCircleIcon color="error" fontSize="small" />
              </IconButton>
            )}
          </Box>
        ))}
      </Box>

      {/* "View All" Button */}
      <Button
        variant="contained"
        startIcon={<PhotoLibraryIcon />}
        onClick={onViewAll}
      >
        View all {mediaItems.length} photos
      </Button>
    </Paper>
  );
};
