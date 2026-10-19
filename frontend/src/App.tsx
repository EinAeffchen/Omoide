import React, { useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { useThemeContext } from "./ThemeContext";
import { getTheme } from "./theme";
import { TaskEventsProvider } from "./TaskEventsContext";
import { SelectionProvider } from "./context/SelectionContext";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppRoutes } from "./routes";

export default function App() {
  const { mode } = useThemeContext();
  const theme = useMemo(() => getTheme(mode), [mode]);

  return (
    <TaskEventsProvider>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <SelectionProvider>
          <Router>
            <ScrollToTop />
            <AppRoutes />
          </Router>
        </SelectionProvider>
      </MuiThemeProvider>
    </TaskEventsProvider>
  );
}
