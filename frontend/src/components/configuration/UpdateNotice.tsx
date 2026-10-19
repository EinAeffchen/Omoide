import { Alert, Button } from "@mui/material";
import { VersionUpdateInfo } from "../../types";

interface UpdateNoticeProps {
  updateInfo: VersionUpdateInfo | null;
  updateError: string | null;
}

/** "New version available" / "could not check for updates" banners. */
export default function UpdateNotice({
  updateInfo,
  updateError,
}: UpdateNoticeProps) {
  const latestVersionLabel =
    updateInfo?.latest_version ?? updateInfo?.latest_tag ?? null;
  const updateLink =
    updateInfo?.release_url ??
    (updateInfo?.repo
      ? `https://github.com/${updateInfo.repo}/releases`
      : undefined);
  const updateCheckEnabled = updateInfo?.update_check_enabled ?? true;
  const showUpdateNotice =
    updateCheckEnabled && Boolean(updateInfo?.update_available);
  const showUpdateError =
    updateCheckEnabled && !showUpdateNotice && Boolean(updateError);

  return (
    <>
      {showUpdateNotice && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            updateLink ? (
              <Button
                color="inherit"
                size="small"
                component="a"
                href={updateLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Release
              </Button>
            ) : undefined
          }
        >
          A newer version
          {latestVersionLabel ? ` ${latestVersionLabel}` : ""} is available. You
          are running {updateInfo?.current_version}.
        </Alert>
      )}
      {showUpdateError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Could not check for updates
          {updateError ? `: ${updateError}` : "."}
        </Alert>
      )}
    </>
  );
}
