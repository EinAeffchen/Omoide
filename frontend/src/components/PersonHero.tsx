import React from "react";
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Button,
  Paper,
  useTheme,
  CircularProgress,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Grid from "@mui/material/Grid";
import { Person } from "../types";
import { PersonEditForm } from "./PersonEditForm";
import config, { API } from "../config";

interface PersonHeroProps {
  person: Person;
  onSave: (formData: { name: string }) => Promise<void>;
  onMerge: () => void;
  onDelete: () => void;
  onRefreshSimilar: () => void;
  onAutoSelectProfile: () => void;
  saving: boolean;
  autoSelectingProfile: boolean;
}

export function PersonHero({
  person,
  onSave,
  onMerge,
  onDelete,
  onRefreshSimilar,
  onAutoSelectProfile,
  saving,
  autoSelectingProfile,
}: PersonHeroProps) {
  const theme = useTheme();
  const thumbUrl = person.profile_face?.thumbnail_path
    ? `${API}/thumbnails/${encodeURIComponent(
        person.profile_face.thumbnail_path
      )}`
    : undefined;

  return (
    <Box sx={{ mb: 4 }}>
      {/* CORRECTED: Using the standard Grid component with your project's 'size' prop syntax */}
      <Grid container spacing={{ xs: 2, md: 4 }} alignItems="center">
        {/* Profile Avatar */}
        <Grid size={{ xs: 12, sm: 4, md: 3 }} sx={{ textAlign: "center" }}>
          <Avatar
            src={thumbUrl}
            sx={{
              width: { xs: 120, md: 160 },
              height: { xs: 120, md: 160 },
              mx: "auto",
              border: `4px solid ${theme.palette.background.paper}`,
              boxShadow: theme.shadows[6],
            }}
          />
        </Grid>

        {/* Person Details and Actions */}
        <Grid size={{ xs: 12, sm: 8, md: 9 }}>
          <Typography variant="h3" component="h1" fontWeight="bold">
            {person.name || "Unnamed Person"}
          </Typography>
          <Typography variant="body1" color="text.secondary" gutterBottom>
            {person.appearance_count
              ? `${person.appearance_count} appearances found`
              : "No appearances"}
          </Typography>

          {!config.PRESENTATION_MODE && (
            <Stack
              direction="row"
              spacing={1}
              mt={2}
              mb={3}
              flexWrap="wrap"
              useFlexGap
            >
              <Button variant="outlined" onClick={onMerge} disabled={saving}>
                Merge
              </Button>
              <Button
                variant="outlined"
                onClick={() => onRefreshSimilar()}
                disabled={saving}
              >
                Refresh Similar
              </Button>
              <Button
                variant="outlined"
                onClick={onAutoSelectProfile}
                disabled={saving || autoSelectingProfile}
              >
                {autoSelectingProfile ? (
                  <CircularProgress size={18} thickness={5} />
                ) : (
                  "Auto Profile"
                )}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={onDelete}
                disabled={saving}
              >
                Delete
              </Button>
            </Stack>
          )}
        </Grid>
      </Grid>

      {/* The Edit Form is now more cleanly integrated */}
      {!config.PRESENTATION_MODE && (
        <Paper
          sx={{
            p: { xs: 2, md: 3 },
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? alpha(theme.palette.common.white, 0.05)
                : alpha(theme.palette.common.black, 0.02),
            mt: 4,
            borderRadius: 3,
          }}
        >
          <PersonEditForm
            initialPersonData={{ name: person.name ?? "" }}
            onSave={onSave}
            saving={saving}
          />
        </Paper>
      )}
    </Box>
  );
}
