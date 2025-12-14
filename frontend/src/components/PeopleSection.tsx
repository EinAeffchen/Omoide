import React, { Suspense } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import { Person, Face } from "../types";
import PersonCard from "./PersonCard";
import config from "../config";

const DetectedFaces = React.lazy(() => import("./DetectedFaces"));

interface PeopleSectionProps {
  persons: Person[];
  orphans: Face[];
  onAssign: (faceIds: number[], personId: number) => Promise<void>;
  onCreateFace: (faceIds: number[], data: { name: string }) => Promise<any>;
  onDeleteFace: (faceIds: number[]) => Promise<void>;
  onDetachFace: (faceIds: number[]) => Promise<void>;
}

const SectionLoader = () => (
  <Box
    sx={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "200px",
    }}
  >
    <CircularProgress />
  </Box>
);

export function PeopleSection({
  persons,
  orphans,
  onAssign,
  onCreateFace,
  onDeleteFace,
  onDetachFace,
}: PeopleSectionProps) {
  return (
    <>
      {persons && persons.length > 0 && (
        <Box mb={4}>
          <Typography variant="h6" gutterBottom>
            Detected Persons
          </Typography>
          <Box sx={{ display: "flex", overflowX: "auto", gap: 2, py: 1 }}>
            {persons.map((p) => (
              <Box
                key={p.id}
                sx={{
                  width: "140px",
                  flexShrink: 0,
                }}
              >
                <PersonCard person={p} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Unassigned Faces Section */}
      {orphans.length > 0 && !config.PRESENTATION_MODE && (
        <Box mb={4}>
          <Suspense fallback={<SectionLoader />}>
            <DetectedFaces
              isProcessing={false}
              allowIndividualActions={true}
              onSingleFaceDelete={(faceId) => onDeleteFace([faceId])}
              title="Unassigned Faces"
              faces={orphans}
              onAssign={onAssign}
              onSetProfile={() => {}}
              onDelete={onDeleteFace}
              onDetach={onDetachFace}
              onCreateMultiple={onCreateFace}
            />
          </Suspense>
        </Box>
      )}
    </>
  );
}
