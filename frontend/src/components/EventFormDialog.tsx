// components/EventFormDialog.tsx

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import { TimelineEvent } from "../types";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { MobileDatePicker } from "@mui/x-date-pickers/MobileDatePicker";
import { TimelineEventCreate } from "../types"; // Assuming this type is defined

interface EventFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (eventData: TimelineEventCreate) => Promise<void>;
  isSubmitting: boolean;
  initialData?: TimelineEvent | null; 
}
const getInitialState = (): TimelineEventCreate => ({
  title: "",
  description: "",
  event_date: new Date(), 
  recurrence: undefined,
});

export const EventFormDialog: React.FC<EventFormDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  initialData,
}) => {
  const [eventData, setEventData] = useState<TimelineEventCreate>(
    getInitialState()
  );

  useEffect(() => {
    // When the dialog opens, decide which data to show
    if (open) {
      if (initialData) {
        // We are in "Edit" mode. Populate with existing data.
        setEventData({
          title: initialData.title,
          description: initialData.description || "",
          // The date from the API is a string, but the picker needs a Date object.
          event_date: new Date(initialData.event_date),
          recurrence: initialData.recurrence,
        });
      } else {
        // We are in "Create" mode. Reset to a blank slate.
        setEventData(getInitialState());
      }
    }
  }, [open, initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEventData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (date: Date | null) => {
    if (date) {
      setEventData((prev) => ({ ...prev, event_date: date }));
    }
  };

  const handleRecurrenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEventData((prev) => ({
      ...prev,
      recurrence: e.target.checked ? "yearly" : undefined,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(eventData);
  };

  const isEditMode = !!initialData;
  const dialogTitle = isEditMode
    ? "Edit Timeline Event"
    : "Add New Timeline Event";

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              required
              margin="dense"
              name="title"
              label="Event Title"
              type="text"
              fullWidth
              variant="standard"
              value={eventData.title}
              onChange={handleChange}
            />
            <MobileDatePicker
              label="Event Date"
              value={eventData.event_date}
              onChange={handleDateChange}
              slotProps={{
                textField: { margin: "dense", fullWidth: true, variant: "standard" },
              }}
            />
            <TextField
              margin="dense"
              name="description"
              label="Description (Optional)"
              type="text"
              fullWidth
              multiline
              rows={3}
              variant="standard"
              value={eventData.description}
              onChange={handleChange}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={eventData.recurrence === "yearly"}
                  onChange={handleRecurrenceChange}
                />
              }
              label="This event recurs yearly (e.g., a birthday)"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : isEditMode
                ? "Save Changes"
                : "Create Event"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
};
