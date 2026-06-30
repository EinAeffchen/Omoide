// components/DuplicateMediaCard.tsx

import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Radio,
  FormControlLabel,
  useTheme,
} from "@mui/material";
import { MediaDuplicate } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

interface DuplicateMediaCardProps {
  media: MediaDuplicate;
  isSelectedAsMaster: boolean;
  onSelectMaster: () => void;
}

export const DuplicateMediaCard: React.FC<DuplicateMediaCardProps> = ({
  media,
  isSelectedAsMaster,
  onSelectMaster,
}) => {
  const location = useLocation();
  const theme = useTheme();

  const filename = media ? media.filename : "404 Not found";
  const thumbUrl = media.thumbnail_path
    ? `${API}/thumbnails/${encodeFilePath(media.thumbnail_path)}`
    : `${API}/thumbnails/${media.id}.jpg`;

  return (
    media && (
      <Card
        sx={{
          height: "100%",
          border: isSelectedAsMaster
            ? `2px solid ${theme.palette.primary.main}`
            : `2px solid transparent`,
          boxShadow: isSelectedAsMaster ? theme.shadows[4] : theme.shadows[1],
        }}
      >
        <Link
          to={`/medium/${media.id}`}
          state={{ backgroundLocation: location }}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <CardMedia
            component="img"
            height="200"
            image={thumbUrl}
            alt={filename}
            sx={{ objectFit: "cover" }}
          />
        </Link>
        <CardContent>
          <FormControlLabel
            control={
              <Radio
                checked={isSelectedAsMaster}
                onChange={onSelectMaster}
                name={`master-select-${media.group_id}`}
              />
            }
            label="Keep this one"
          />
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            title={media.path}
          >
            {media.path}
          </Typography>
          {/* Displaying more metadata helps the user choose */}
          <Typography variant="caption" color="text.secondary" display="block">
            {media.width}x{media.height}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {(media.size / 1024 / 1024).toFixed(2)} MB
          </Typography>
        </CardContent>
      </Card>
    )
  );
};
