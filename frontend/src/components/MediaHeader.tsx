import {
  Box,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import { Vrpano, Delete, DeleteForever, FolderOpen, OpenInNew, Favorite, FavoriteBorder } from "@mui/icons-material";
import { Media } from "../types";
import config from "../config";
import { BinaryNavigationControls } from "./BinaryNavigationControls";
import { setMediaFavorite } from "../services/mediaActions";
const ERROR_COLOR = "error.main";

interface MediaHeaderProps {
  media: Media;
  onOpenDialog: (type: "convert" | "deleteRecord" | "deleteFile") => void;
  isBinary?: boolean;
  onOpenFolder?: (mediaId: number) => void;
  onOpenFile?: (mediaId: number) => void;
  onFavoriteChange?: (media: Media) => void;
}

export function MediaHeader({
  media,
  onOpenDialog,
  isBinary = false,
  onOpenFolder,
  onOpenFile,
  onFavoriteChange,
}: MediaHeaderProps) {
  const filename = media ? media.filename : "File not found!";
  const isVideo = typeof media?.duration === "number";

  const handleToggleFavorite = () => {
    if (!media) return;
    const next = !media.is_favorite;
    onFavoriteChange?.({ ...media, is_favorite: next });
    setMediaFavorite(media.id, next).catch(() => {
      onFavoriteChange?.({ ...media, is_favorite: !next });
    });
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
          flex: { xs: "none", sm: 1 },
          minWidth: 0,
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
          {filename}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <BinaryNavigationControls variant="overlay" />
        {!config.PRESENTATION_MODE && media && (
          <Tooltip title={media.is_favorite ? "Remove favorite" : "Mark as favorite"}>
            <IconButton
              onClick={handleToggleFavorite}
              size="small"
              sx={{ color: media.is_favorite ? ERROR_COLOR : undefined }}
            >
              {media.is_favorite ? <Favorite /> : <FavoriteBorder />}
            </IconButton>
          </Tooltip>
        )}
        {!config.PRESENTATION_MODE && isBinary && media && (
          <>
            <Tooltip title="Open file">
              <IconButton onClick={() => onOpenFile?.(media.id)} color="primary" size="small">
                <OpenInNew />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open folder">
              <IconButton onClick={() => onOpenFolder?.(media.id)} color="primary" size="small">
                <FolderOpen />
              </IconButton>
            </Tooltip>
          </>
        )}
        {!config.PRESENTATION_MODE && (
          <>
            {media && isVideo && (
              <Tooltip title="Convert">
                <IconButton onClick={() => onOpenDialog("convert")} color="primary" size="small">
                  <Vrpano />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Remove from library">
              <IconButton onClick={() => onOpenDialog("deleteRecord")} sx={{ color: ERROR_COLOR }} size="small">
                <Delete />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete file">
              <IconButton onClick={() => onOpenDialog("deleteFile")} sx={{ color: ERROR_COLOR }} size="small">
                <DeleteForever />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  );
}
