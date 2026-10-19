import React from "react";
import { FormControlLabel, Switch, Typography } from "@mui/material";
import { AppConfig } from "../../types";

/** Sets a single key inside one top-level config section. */
export type ConfigValueChange = <
  T extends keyof AppConfig,
  K extends keyof AppConfig[T],
>(
  section: T,
  key: K,
  value: AppConfig[T][K]
) => void;

/** Applies a functional update to the (loaded) config. */
export type ConfigUpdate = (updater: (prev: AppConfig) => AppConfig) => void;

export type SnackbarSeverity = "success" | "error" | "info";

export type ShowSnackbar = (message: string, severity: SnackbarSeverity) => void;

export interface ConfigSectionProps {
  config: AppConfig;
  onValueChange: ConfigValueChange;
}

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return fallback;
};

interface SwitchSettingProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: React.ReactNode;
}

/** Labelled switch followed by an indented caption (used inside a FormGroup). */
export function SwitchSetting({
  label,
  checked,
  onChange,
  description,
}: SwitchSettingProps) {
  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
        }
        label={label}
      />
      {description && (
        <Typography variant="caption" sx={{ ml: 6, mt: -1, display: "block" }}>
          {description}
        </Typography>
      )}
    </>
  );
}
