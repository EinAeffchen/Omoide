import React, { useState } from "react";
import {
  Button,
  Chip,
  Fade,
  Paper,
  Snackbar,
  Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ReplayIcon from "@mui/icons-material/Replay";
import { useSelection } from "../context/SelectionContext";
import { RerunProcessorsDialog } from "./RerunProcessorsDialog";

export const SelectionActionBar: React.FC = () => {
  const { selectedIds, clear } = useSelection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const count = selectedIds.size;

  return (
    <>
      <Fade in={count > 0}>
        <Paper
          elevation={4}
          sx={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1250,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            borderRadius: 6,
            bgcolor: "background.paper",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <Chip label={`${count} selected`} size="small" color="primary" />
          <Button
            size="small"
            startIcon={<ReplayIcon fontSize="small" />}
            onClick={() => setDialogOpen(true)}
            variant="contained"
            disableElevation
          >
            Rerun Processors
          </Button>
          <Button
            size="small"
            startIcon={<CloseIcon fontSize="small" />}
            onClick={clear}
            color="inherit"
          >
            Clear
          </Button>
        </Paper>
      </Fade>

      <RerunProcessorsDialog
        open={dialogOpen}
        mediaIds={Array.from(selectedIds)}
        onClose={() => setDialogOpen(false)}
        onStarted={() =>
          setSnackbar({ open: true, message: "Processing started." })
        }
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};
