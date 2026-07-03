import React, { Suspense, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from "@mui/material";
import { Person, Face } from "../types";
import PersonCard from "./PersonCard";
import config, { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import {
  AddMediaAppearanceResult,
  searchPersonsByName,
} from "../services/personActions";

const DetectedFaces = React.lazy(() => import("./DetectedFaces"));

interface PeopleSectionProps {
  persons: Person[];
  orphans: Face[];
  onAssign: (faceIds: number[], personId: number) => Promise<void>;
  onCreateFace: (faceIds: number[], name?: string) => Promise<Person>;
  onDeleteFace: (faceIds: number[]) => Promise<void>;
  onDetachFace: (faceIds: number[]) => Promise<void>;
  onAttachMediaToPerson?: (
    personId: number
  ) => Promise<AddMediaAppearanceResult | void>;
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
  onAttachMediaToPerson,
}: PeopleSectionProps) {
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [personOptions, setPersonOptions] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "info" | "error";
  }>({ open: false, message: "", severity: "success" });

  useEffect(() => {
    if (!attachDialogOpen) {
      return;
    }
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setPersonOptions([]);
      return;
    }

    let active = true;
    const handle = window.setTimeout(() => {
      searchPersonsByName(trimmed)
        .then((results) => {
          if (active) {
            setPersonOptions(results);
          }
        })
        .catch((err) => {
          console.error("Failed to search persons:", err);
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [attachDialogOpen, searchTerm]);

  const resetAttachDialog = () => {
    setAttachDialogOpen(false);
    setSearchTerm("");
    setPersonOptions([]);
    setSelectedPerson(null);
  };

  const handleAttachConfirm = async () => {
    if (!onAttachMediaToPerson || !selectedPerson) {
      return;
    }
    setIsAttaching(true);
    try {
      const result = await onAttachMediaToPerson(selectedPerson.id);
      if (result && result.added === false) {
        setSnackbar({
          open: true,
          message:
            "This media is already linked to that person or has a detected face match.",
          severity: "info",
        });
      } else {
        setSnackbar({
          open: true,
          message: "Media attached to person.",
          severity: "success",
        });
      }
      resetAttachDialog();
    } catch (err) {
      console.error("Failed to attach media to person:", err);
      setSnackbar({
        open: true,
        message: "Failed to attach media to person.",
        severity: "error",
      });
    } finally {
      setIsAttaching(false);
    }
  };

  return (
    <>
      {!config.PRESENTATION_MODE && onAttachMediaToPerson && (
        <Box mb={2} sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={() => setAttachDialogOpen(true)}>
            Attach Media to Person
          </Button>
        </Box>
      )}

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

      <Dialog
        open={attachDialogOpen}
        onClose={resetAttachDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Attach Media to Person</DialogTitle>
        <DialogContent>
          <Autocomplete
            options={personOptions}
            value={selectedPerson}
            getOptionLabel={(option) => option.name || `Person ${option.id}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            inputValue={searchTerm}
            onInputChange={(_, value) => setSearchTerm(value)}
            onChange={(_, value) => setSelectedPerson(value)}
            renderOption={(props, option) => {
              const thumbPath = option.profile_face?.thumbnail_path;
              const thumbUrl = thumbPath
                ? `${API}/thumbnails/${encodeFilePath(thumbPath)}`
                : undefined;
              const initials =
                (option.name || `P${option.id}`)
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")
                  .slice(0, 2) || "?";

              return (
                <Box
                  component="li"
                  {...props}
                  sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}
                >
                  <Avatar src={thumbUrl} alt={option.name || `Person ${option.id}`}>
                    {thumbUrl ? null : initials}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap>{option.name || `Person ${option.id}`}</Typography>
                    {option.appearance_count ? (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {option.appearance_count} media
                      </Typography>
                    ) : null}
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Search for person"
                helperText={
                  searchTerm.trim().length < 2
                    ? "Type at least two characters to search"
                    : undefined
                }
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={resetAttachDialog} disabled={isAttaching}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAttachConfirm}
            disabled={!selectedPerson || isAttaching}
          >
            {isAttaching ? "Attaching..." : "Attach"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
