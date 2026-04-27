import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";

interface ActionDialogsProps {
  dialogType: "convert" | "deleteRecord" | "deleteFile" | null;
  onClose: () => void;
  onConfirmConvert: () => void;
  onConfirmDeleteRecord: () => void;
  onConfirmDeleteFile: () => void;
}

export function ActionDialogs({
  dialogType,
  onClose,
  onConfirmConvert,
  onConfirmDeleteRecord,
  onConfirmDeleteFile,
}: ActionDialogsProps) {
  return (
    <>
      {/* Convert Dialog */}
      <Dialog open={dialogType === "convert"} onClose={onClose}>
        <DialogTitle>Convert Video Format?</DialogTitle>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={onConfirmConvert}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Record Dialog */}
      <Dialog open={dialogType === "deleteRecord"} onClose={onClose}>
        <DialogTitle>Remove from Library?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The record will be removed from the database. The file on disk is
            kept and can be re-imported by scanning.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="outlined" color="error" onClick={onConfirmDeleteRecord}>
            Remove Record
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete File Dialog */}
      <Dialog open={dialogType === "deleteFile"} onClose={onClose}>
        <DialogTitle>Delete File from Disk?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The file will be permanently deleted from disk. This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="error" onClick={onConfirmDeleteFile}>
            Delete File
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
