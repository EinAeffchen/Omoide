import React, { useState } from "react";
import {
  Box,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import FaceCard from "./FaceCard";
import { FaceRead } from "../types";
import { API } from "../config";

interface FaceMediaGroupProps {
  faces: FaceRead[];
  profileFaceId?: number;
  onSetProfile?: (faceId: number) => void;
  selectedFaceIds: number[];
  onToggleSelect: (faceId: number) => void;
  onToggleGroupSelect: (faceIds: number[]) => void;
  canMutate: boolean;
}

export default function FaceMediaGroup({
  faces,
  profileFaceId,
  onSetProfile,
  selectedFaceIds,
  onToggleSelect,
  onToggleGroupSelect,
  canMutate,
}: FaceMediaGroupProps) {
  const [expanded, setExpanded] = useState(faces.length <= 8);

  const faceIds = faces.map((f) => f.id);
  const selectedCount = faceIds.filter((id) => selectedFaceIds.includes(id)).length;
  const allSelected = selectedCount === faces.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        borderWidth: someSelected || allSelected ? 2 : 1,
        borderColor: allSelected
          ? "primary.main"
          : someSelected
          ? "primary.light"
          : "divider",
      }}
    >
      {/* Header row */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {canMutate && (
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            size="small"
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleGroupSelect(faceIds)}
          />
        )}

        {/* Thumbnail strip shown when collapsed */}
        {!expanded && (
          <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
            {faces.slice(0, 4).map((face) => (
              <Box
                key={face.id}
                component="img"
                src={`${API}/thumbnails/${face.thumbnail_path}`}
                sx={{
                  width: 36,
                  height: 36,
                  objectFit: "cover",
                  borderRadius: 0.5,
                }}
              />
            ))}
            {faces.length > 4 && (
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 0.5,
                  bgcolor: "action.hover",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  +{faces.length - 4}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        <Chip
          label={`${faces.length} faces · same video`}
          size="small"
          variant="outlined"
          sx={{ flexGrow: 1, pointerEvents: "none" }}
        />

        <IconButton size="small" tabIndex={-1}>
          {expanded ? (
            <ExpandLessIcon fontSize="small" />
          ) : (
            <ExpandMoreIcon fontSize="small" />
          )}
        </IconButton>
      </Box>

      {/* Expanded face grid */}
      <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{ display: "flex", flexWrap: "wrap", gap: 1, pt: 1 }}
        >
          {faces.map((face) => (
            <FaceCard
              key={face.id}
              face={face as any}
              isProfile={face.id === profileFaceId}
              onSetProfile={canMutate ? onSetProfile : undefined}
              selected={canMutate && selectedFaceIds.includes(face.id)}
              onToggleSelect={canMutate ? onToggleSelect : undefined}
            />
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}
