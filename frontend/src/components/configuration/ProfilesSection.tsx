import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormHelperText,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Radio,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { ProfilesController } from "./useProfiles";

interface ProfilesSectionProps {
  isDocker: boolean;
  profilesCtl: ProfilesController;
}

export default function ProfilesSection({
  isDocker,
  profilesCtl,
}: ProfilesSectionProps) {
  const {
    profiles,
    profileError,
    profileHealth,
    hasActiveTasks,
    selectedProfilePath,
    setSelectedProfilePath,
    isSwitchingProfile,
    creatingProfile,
    newProfileName,
    setNewProfileName,
    newProfilePath,
    setNewProfilePath,
  } = profilesCtl;

  return (
    <Grid container spacing={2}>
      {isDocker ? (
        <Grid size={{ xs: 12 }}>
          <Alert severity="info">
            Profiles are not available in this environment.
          </Alert>
        </Grid>
      ) : profileError ? (
        <Grid size={{ xs: 12 }}>
          <Alert severity="error">{profileError}</Alert>
        </Grid>
      ) : profiles ? (
        <>
          {/* Active profile card */}
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Active Profile
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", fontFamily: "monospace" }}
              >
                {profiles.active_path}
              </Typography>
              {profileHealth &&
                (!profileHealth.active_exists || !profileHealth.has_db) && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    The active profile looks missing or empty. If you moved
                    it, choose the new location and click Save to relink.
                    <Button
                      size="small"
                      sx={{ ml: 2 }}
                      variant="outlined"
                      onClick={profilesCtl.pickRelocatePath}
                    >
                      Choose directory…
                    </Button>
                  </Alert>
                )}
            </Paper>
          </Grid>

          {hasActiveTasks && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="warning">
                Processing is active. Profile actions are disabled until
                tasks finish.
              </Alert>
            </Grid>
          )}

          {/* Two-column layout: list on left, create on right */}
          <Grid size={{ xs: 12, md: 7 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography variant="h6">All Profiles</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={profilesCtl.addExisting}
                  disabled={hasActiveTasks}
                >
                  Add Existing…
                </Button>
              </Box>
              <Divider />
              <List dense sx={{ mt: 1 }}>
                {(profiles.profiles ?? []).map((p) => (
                  <ListItem key={p.path} disableGutters>
                    <ListItemIcon>
                      <Radio
                        edge="start"
                        checked={selectedProfilePath === p.path}
                        onChange={() => setSelectedProfilePath(p.path)}
                        disabled={hasActiveTasks || isSwitchingProfile}
                        inputProps={{ "aria-label": `Select profile ${p.name}` }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={p.name}
                      secondary={p.path}
                      secondaryTypographyProps={{
                        sx: { fontFamily: "monospace" },
                      }}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        aria-label={`remove profile ${p.name}`}
                        onClick={() => profilesCtl.removeProfile(p.path)}
                        disabled={
                          p.path === profiles.active_path ||
                          hasActiveTasks ||
                          isSwitchingProfile
                        }
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              {selectedProfilePath &&
                selectedProfilePath !== profiles.active_path && (
                  <Typography
                    variant="caption"
                    sx={{
                      mt: 1,
                      display: "block",
                      color: "text.secondary",
                    }}
                  >
                    Selected profile will become active when you click Save
                    below.
                  </Typography>
                )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Create New Profile
              </Typography>
              <Stack direction="column" spacing={1.5}>
                <TextField
                  label="Name"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  fullWidth
                />
                <Box sx={{ display: "flex", gap: 1 }}>
                  <TextField
                    label="Directory"
                    value={newProfilePath}
                    onChange={(e) => setNewProfilePath(e.target.value)}
                    fullWidth
                  />
                  <IconButton
                    aria-label="browse for profile directory"
                    onClick={profilesCtl.pickNewProfilePath}
                    disabled={hasActiveTasks}
                  >
                    <FolderOpenIcon />
                  </IconButton>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={!creatingProfile ? <AddIcon /> : undefined}
                    onClick={profilesCtl.createProfile}
                    disabled={
                      !newProfilePath || creatingProfile || hasActiveTasks
                    }
                    sx={{ minWidth: 120 }}
                  >
                    {creatingProfile ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      "Create"
                    )}
                  </Button>
                </Box>
                <FormHelperText>
                  Destination directory must be empty or non-existent.
                </FormHelperText>
              </Stack>
            </Paper>
          </Grid>
        </>
      ) : (
        <Grid size={{ xs: 12 }}>
          <Alert severity="info">
            No profiles are registered yet. Create or add one below.
          </Alert>
        </Grid>
      )}
    </Grid>
  );
}
