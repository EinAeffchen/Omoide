import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  InputAdornment,
  TextField,
  CircularProgress, // ADDED: For the saving indicator
} from "@mui/material";
import { READ_ONLY } from "../config";

export function PersonEditForm({
  initialPersonData,
  onSave,
  saving,
}: {
  initialPersonData: { name: string; };
  onSave: (form: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initialPersonData);

  useEffect(() => {
    setForm(initialPersonData);
  }, [initialPersonData]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | { name?: string; value: unknown }>
  ) => {
    const target = e.target as HTMLInputElement;
    const { name, value } = target;
    setForm((prevForm) => ({ ...prevForm, [name!]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  // This component is now self-contained and doesn't render if in READ_ONLY mode
  if (READ_ONLY) {
    return null;
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ width: "100%" }}>
      {/* The Grid now centers items vertically for a cleaner alignment with the button */}
      <TextField
        fullWidth
        label="Name"
        name="name"
        value={form.name}
        onChange={handleChange}
        variant="filled"
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={saving}
                >
                  {saving ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  );
}
