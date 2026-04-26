import React, { useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { useThemeContext } from "./ThemeContext";
import { getTheme } from "./theme";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { TaskEventsProvider } from "./TaskEventsContext";
import { SelectionProvider } from "./context/SelectionContext";
import { AppRoutes } from "./routes";

export default function App() {
  const { mode } = useThemeContext();
  const theme = useMemo(() => getTheme(mode), [mode]);

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <TaskEventsProvider>
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          <SelectionProvider>
            <Router>
              <AppRoutes />
            </Router>
          </SelectionProvider>
        </MuiThemeProvider>
      </TaskEventsProvider>
    </LocalizationProvider>
  );
}
