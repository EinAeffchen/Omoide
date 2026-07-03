import { Box, Card, Checkbox, IconButton, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import VideoLibraryIcon from "@mui/icons-material/VideoLibrary";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { useNavigate, useLocation } from "react-router-dom";
import { FaceRead } from "../types";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";

interface FaceGroupCardProps {
  faces: FaceRead[];
  selectedFaceIds: number[];
  onToggleGroupSelect: (faceIds: number[]) => void;
  canMutate: boolean;
  onToggleExpand: () => void;
}

export default function FaceGroupCard({
  faces,
  selectedFaceIds,
  onToggleGroupSelect,
  canMutate,
  onToggleExpand,
}: FaceGroupCardProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const faceIds = faces.map((f) => f.id);
  const selectedCount = faceIds.filter((id) => selectedFaceIds.includes(id)).length;
  const allSelected = selectedCount === faces.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const preview = faces.slice(0, 4);

  const handleCardClick = () => {
    navigate(`/medium/${faces[0].media_id}`, {
      state: { backgroundLocation: location },
    });
  };

  return (
    <Card
      elevation={someSelected || allSelected ? 8 : 2}
      sx={{
        width: 140,
        height: 140,
        position: "relative",
        cursor: "pointer",
        overflow: "hidden",
        flexShrink: 0,
        outline: allSelected
          ? "2px solid"
          : someSelected
          ? "2px solid"
          : "none",
        outlineColor: allSelected ? "primary.main" : "primary.light",
      }}
      onClick={handleCardClick}
    >
      {/* 2×2 thumbnail collage */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          width: "100%",
          height: "100%",
          gap: "1px",
          bgcolor: "divider",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => {
          const face = preview[i] ?? preview[0];
          return (
            <Box
              key={i}
              component="img"
              loading="lazy"
              src={`${API}/thumbnails/${encodeFilePath(face.thumbnail_path)}`}
              sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          );
        })}
      </Box>

      {/* Bottom gradient + count */}
      <Box
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          px: 0.5,
          pb: 0.5,
          pt: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 0.4,
        }}
      >
        <VideoLibraryIcon sx={{ fontSize: 13, color: "white" }} />
        <Typography variant="caption" sx={{ color: "white", fontWeight: 700, lineHeight: 1 }}>
          {faces.length}
        </Typography>
      </Box>

      {/* Checkbox */}
      {canMutate && (
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggleGroupSelect(faceIds);
          }}
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            color: "white",
            "&.Mui-checked": { color: "white" },
            p: 0.5,
            bgcolor: (theme) => alpha(theme.palette.common.black, 0.3),
            borderRadius: "20%",
          }}
        />
      )}

      {/* Expand button */}
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
        sx={{
          position: "absolute",
          top: 0,
          right: 0,
          color: "white",
          p: 0.5,
          bgcolor: (theme) => alpha(theme.palette.common.black, 0.3),
          borderRadius: "20%",
          "&:hover": {
            bgcolor: (theme) => alpha(theme.palette.common.black, 0.5),
          },
        }}
      >
        <UnfoldMoreIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Card>
  );
}
