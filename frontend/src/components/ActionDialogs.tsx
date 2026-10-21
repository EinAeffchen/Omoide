import React, { useState } from "react";
import {
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
} from "@mui/material";

type ConversionChoice = "keep_original" | "replace_original";

interface ActionDialogsProps {
  dialogType: "convert" | "deleteRecord" | "deleteFile" | null;
  onClose: () => void;
  onConfirmConvert: (mode: ConversionChoice) => void;
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
      {dialogType === "convert" && (
        <ConvertDialog onClose={onClose} onConfirm={onConfirmConvert} />
      )}

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

/** Asks how to convert: nothing is preselected, and replacing the original
 * requires an explicit acknowledgement. */
function ConvertDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (mode: ConversionChoice) => void;
}) {
  const [mode, setMode] = useState<ConversionChoice | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const canConfirm = mode === "keep_original" || (mode === "replace_original" && acknowledged);

  return (
    <Dialog open onClose={onClose} aria-labelledby="convert-dialog-title">
      <DialogTitle id="convert-dialog-title">Convert to a playable MP4?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          Converting re-encodes the video so every browser can play it. It can take a while and uses a lot of CPU or GPU time.
        </DialogContentText>
        <RadioGroup
          aria-label="Conversion mode"
          value={mode ?? ""}
          onChange={(e) => {
            setMode(e.target.value as ConversionChoice);
            setAcknowledged(false);
          }}
        >
          <FormControlLabel
            value="keep_original"
            control={<Radio />}
            label="Keep the original — store a playable copy in Omoide's data folder (uses extra disk space)"
          />
          <FormControlLabel
            value="replace_original"
            control={<Radio />}
            label="Replace the original — the original file is deleted after a successful conversion"
          />
        </RadioGroup>
        {mode === "replace_original" && (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />}
            label="I understand that the original file will be permanently deleted."
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color={mode === "replace_original" ? "error" : "primary"}
          disabled={!canConfirm}
          onClick={() => mode && onConfirm(mode)}
        >
          Convert
        </Button>
      </DialogActions>
    </Dialog>
  );
}
