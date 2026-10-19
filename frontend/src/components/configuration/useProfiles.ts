import { useCallback, useState } from "react";
import {
  addExistingProfile,
  createProfile as apiCreateProfile,
  getProfileHealth,
  listProfiles,
  pickDirectory,
  reloadConfig,
  removeProfile as apiRemoveProfile,
} from "../../services/config";
import { AppConfig, ProfileHealth, ProfileListResponse } from "../../types";
import { getErrorMessage, ShowSnackbar } from "./shared";

interface UseProfilesOptions {
  showSnackbar: ShowSnackbar;
  /** Called with the authoritative server config after a profile was created. */
  onConfigReloaded: (latest: AppConfig) => void;
}

/**
 * Profile list / selection state for the Configuration page. Lives in the page
 * (not the Profiles tab) because Save switches to the selected profile and the
 * create form must survive switching tabs.
 */
export function useProfiles({
  showSnackbar,
  onConfigReloaded,
}: UseProfilesOptions) {
  const [profiles, setProfiles] = useState<ProfileListResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [selectedProfilePath, setSelectedProfilePath] = useState<string | null>(
    null
  );
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("My Library");
  const [newProfilePath, setNewProfilePath] = useState("");
  const [profileHealth, setProfileHealth] = useState<ProfileHealth | null>(
    null
  );
  const [hasActiveTasks, setHasActiveTasks] = useState(false);

  /** Initial load: profiles, profile health and active tasks (errors ignored). */
  const loadInitial = useCallback(async () => {
    // Try to load profiles; ignore errors on Docker
    try {
      const p = await listProfiles();
      setProfiles(p);
      setSelectedProfilePath(p.active_path);
    } catch {
      setProfiles(null);
    }
    // Fetch profile health to detect moved/missing profiles
    try {
      const h = await getProfileHealth();
      setProfileHealth(h);
    } catch {}
    // Check active tasks to gate profile actions
    try {
      const tasks = await (
        await import("../../services/taskActions")
      ).getActiveTasks();
      setHasActiveTasks(tasks.length > 0);
    } catch {}
  }, []);

  const refreshProfiles = async () => {
    try {
      const p = await listProfiles();
      setProfiles(p);
      setProfileError(null);
    } catch (error: unknown) {
      setProfileError(getErrorMessage(error, "Failed to load profiles"));
    }
  };

  const createProfile = async () => {
    if (!newProfilePath) return;
    setCreatingProfile(true);
    try {
      await apiCreateProfile(newProfilePath, newProfileName || "Profile");
      const latest = await reloadConfig();
      onConfigReloaded(latest);
      const lp = await listProfiles();
      setProfiles(lp);
      setSelectedProfilePath(lp.active_path);
      showSnackbar("Profile created", "success");
      setNewProfilePath("");
    } catch (error: unknown) {
      showSnackbar(getErrorMessage(error, "Failed to create profile"), "error");
    } finally {
      setCreatingProfile(false);
    }
  };

  // Switching happens as part of Save; users select via radio and then Save.

  const removeProfile = async (path: string) => {
    try {
      await apiRemoveProfile(path);
      await refreshProfiles();
      showSnackbar("Removed profile", "success");
    } catch (error: unknown) {
      showSnackbar(getErrorMessage(error, "Failed to remove profile"), "error");
    }
  };

  const pickNewProfilePath = async () => {
    const p = await pickDirectory();
    if (p) setNewProfilePath(p);
  };

  // Relocate current profile if it was moved manually by selecting new path,
  // then clicking Save (will run switchProfile)
  const pickRelocatePath = async () => {
    const p = await pickDirectory();
    if (p) setSelectedProfilePath(p);
  };

  const addExisting = async () => {
    try {
      const p = await pickDirectory();
      if (!p) return;
      await addExistingProfile(p);
      await refreshProfiles();
      setSelectedProfilePath(p);
      showSnackbar("Profile added", "success");
    } catch (error: unknown) {
      showSnackbar(getErrorMessage(error, "Failed to add profile"), "error");
    }
  };

  /** True when the user picked a profile other than the active one. */
  const hasPendingSwitch = Boolean(
    profiles &&
      selectedProfilePath &&
      selectedProfilePath !== profiles.active_path
  );

  return {
    profiles,
    profileError,
    profileHealth,
    hasActiveTasks,
    selectedProfilePath,
    setSelectedProfilePath,
    isSwitchingProfile,
    setIsSwitchingProfile,
    creatingProfile,
    newProfileName,
    setNewProfileName,
    newProfilePath,
    setNewProfilePath,
    hasPendingSwitch,
    loadInitial,
    refreshProfiles,
    createProfile,
    removeProfile,
    pickNewProfilePath,
    pickRelocatePath,
    addExisting,
  };
}

export type ProfilesController = ReturnType<typeof useProfiles>;
