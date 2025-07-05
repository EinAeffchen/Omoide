// components/DuplicateGroup.tsx

import React, { useState } from "react";
import {
  Paper,
  Typography,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { DuplicateGroup as GroupType } from "../types";
import { DuplicateMediaCard } from "./DuplicateMediaCard";
import { resolveDuplicates } from "../services/duplicates";
import { CircularProgress } from "@mui/material";

interface DuplicateGroupProps {
  group: GroupType;
  onGroupResolved: () => void;
}

type ActionType = "DELETE_FILES" | "DELETE_RECORDS" | "BLACKLIST_RECORDS";

export const DuplicateGroup: React.FC<DuplicateGroupProps> = ({
  group,
  onGroupResolved,
}) => {
  // The ID of the media item selected as the "master" to keep
  const [masterId, setMasterId] = useState<number>(group.items[0].id);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ActionType | null>(null);

  const handleResolve = async () => {
    if (!confirmAction) return;

    setIsProcessing(true);

    try {
      await resolveDuplicates(group.group_id, masterId, confirmAction);

      onGroupResolved();
    } catch (error) {
      console.error(`Failed to resolve group ${group.group_id}:`, error);
      alert("Action failed. Please check the console.");
    } finally {
      setIsProcessing(false);
      setConfirmAction(null);
    }
  };

  const actionText = {
    DELETE_FILES: `This will KEEP the selected master file and PERMANENTLY DELETE the other ${
      group.items.length - 1
    } files and their database records.`,
    DELETE_RECORDS: `This will KEEP the selected master file and only DELETE the database records for the other ${
      group.items.length - 1
    } files. The files will remain on disk.`,
    BLACKLIST_RECORDS: `This will KEEP the selected master file, DELETE the records for the others, and BLACKLIST their paths to prevent re-import.`,
  };

  return (
    <Paper variant="outlined">
      <Box
        sx={{
          p: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Typography variant="h6">
          Group {group.group_id} ({group.items.length} items)
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="contained"
            onClick={() => setConfirmAction("DELETE_FILES")}
            color="error"
          >
            Keep Master, Delete Rest (Files)
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={() => setConfirmAction("DELETE_RECORDS")}
          >
            Keep Master, Delete Rest (Records)
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={() => setConfirmAction("BLACKLIST_RECORDS")}
          >
            Keep Master, Blacklist Rest
          </Button>
        </Box>
      </Box>
      <Grid container spacing={2} sx={{ p: 2 }}>
        {group.items.map((media) => (
          <Grid key={media.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
            <DuplicateMediaCard
              media={media}
              isSelectedAsMaster={media.id === masterId}
              onSelectMaster={() => setMasterId(media.id)}
            />
          </Grid>
        ))}
      </Grid>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmAction} onClose={() => setConfirmAction(null)}>
        <DialogTitle>Confirm Action</DialogTitle>
        <DialogContent>
          <Typography>
            {confirmAction ? actionText[confirmAction] : ""}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmAction(null)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleResolve}
            color="primary"
            variant="contained"
            disabled={isProcessing}
          >
            {isProcessing ? <CircularProgress size={24} /> : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};
