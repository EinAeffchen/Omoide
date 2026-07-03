import React from "react";
import {
  Card,
  CardActionArea,
  CardContent,
  Box,
  Typography,
  useTheme,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import { alpha } from "@mui/material/styles";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { MediaFolderEntry } from "../types";

interface FolderCardProps {
  folder: MediaFolderEntry;
  onOpen: (path: string) => void;
}

const PREVIEW_LIMIT = 3;

const formatCount = (count: number, singular: string, plural: string) => {
  if (count === 0) return `No ${plural}`;
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural}`;
};

const buildPreviewUrl = (id: number, thumbnailPath?: string | null) => {
  if (thumbnailPath) {
    return `${API}/thumbnails/${encodeFilePath(thumbnailPath)}`;
  }
  return `${API}/thumbnails/${id}.jpg`;
};

const FolderCard: React.FC<FolderCardProps> = ({ folder, onOpen }) => {
  const theme = useTheme();
  const previews = folder.previews.slice(0, PREVIEW_LIMIT);

  const handleClick = () => {
    onOpen(folder.path);
  };

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: alpha(theme.palette.background.paper, 0.7),
        border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
        transition: "transform 0.18s ease-in-out, box-shadow 0.18s ease-in-out",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: theme.shadows[8],
        },
      }}
    >
      <CardActionArea
        onClick={handleClick}
        sx={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}
        aria-label={`Open folder ${folder.name}`}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            pt: "68%",
            background: `linear-gradient(135deg, ${alpha(
              theme.palette.primary.main,
              theme.palette.mode === "dark" ? 0.52 : 0.42
            )}, ${alpha(theme.palette.primary.light, 0.25)})`,
          }}
        >
          <FolderIcon
            sx={{
              position: "absolute",
              top: 16,
              left: 16,
              fontSize: 48,
              color: alpha(theme.palette.common.white, 0.9),
            }}
          />
          {previews.length > 0 && (
            <Box
              sx={{
                position: "absolute",
                bottom: 16,
                right: 16,
                display: "flex",
                alignItems: "center",
              }}
            >
              {previews.map((preview, index) => (
                <Box
                  key={preview.id}
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: 1.5,
                    overflow: "hidden",
                    backgroundColor: theme.palette.background.paper,
                    border: `2px solid ${theme.palette.background.paper}`,
                    boxShadow: theme.shadows[4],
                    ml: index === 0 ? 0 : -1.5,
                    zIndex: previews.length - index,
                  }}
                >
                  <Box
                    component="img"
                    src={buildPreviewUrl(preview.id, preview.thumbnail_path)}
                    alt={`${folder.name} preview ${index + 1}`}
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    loading="lazy"
                  />
                </Box>
              ))}
            </Box>
          )}
        </Box>
        <CardContent
          sx={{
            width: "100%",
            py: 1.5,
            px: 2,
          }}
        >
          <Typography
            variant="subtitle1"
            fontWeight={600}
            noWrap
            title={folder.name}
            gutterBottom
          >
            {folder.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {formatCount(folder.media_count, "item", "items")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatCount(folder.subfolder_count, "subfolder", "subfolders")}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default FolderCard;
