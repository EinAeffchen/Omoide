import type { ThemeMode } from "./ThemeContext";
import { createTheme } from "@mui/material";

// Gallery Slate palette and derived tints - Modernized
const gallerySlate = {
  light: {
    primary: { main: "#3B82F6", light: "#60A5FA", dark: "#2563EB" }, // Vibrant Blue
    secondary: { main: "#64748B", light: "#94A3B8", dark: "#475569" }, // Slate
    accent: { main: "#10B981", light: "#34D399", dark: "#059669" }, // Emerald
    background: { default: "#F8FAFC", paper: "#FFFFFF" },
    text: { primary: "#0F172A", secondary: "#475569", disabled: "#94A3B8" },
    divider: "#E2E8F0",
    success: { main: "#22C55E" },
    warning: { main: "#F59E0B" },
    error: { main: "#EF4444" },
    info: { main: "#3B82F6" },
    overlays: {
      elevated: "rgba(255, 255, 255, 0.8)",
      hover: "rgba(15, 23, 42, 0.04)",
      active: "rgba(15, 23, 42, 0.08)",
      focus: "rgba(59, 130, 246, 0.2)",
      selection: "rgba(59, 130, 246, 0.15)",
    },
  },
  dark: {
    primary: { main: "#60A5FA", light: "#93C5FD", dark: "#3B82F6" },
    secondary: { main: "#94A3B8", light: "#CBD5E1", dark: "#64748B" },
    accent: { main: "#34D399", light: "#6EE7B7", dark: "#10B981" },
    background: { default: "#0F172A", paper: "#1E293B" },
    text: { primary: "#F8FAFC", secondary: "#CBD5E1", disabled: "#64748B" },
    divider: "#334155",
    success: { main: "#4ADE80" },
    warning: { main: "#FBBF24" },
    error: { main: "#F87171" },
    info: { main: "#60A5FA" },
    overlays: {
      elevated: "rgba(30, 41, 59, 0.8)",
      hover: "rgba(248, 250, 252, 0.06)",
      active: "rgba(248, 250, 252, 0.12)",
      focus: "rgba(96, 165, 250, 0.3)",
      selection: "rgba(96, 165, 250, 0.2)",
    },
  },
} as const;

export const getTheme = (mode: ThemeMode) => {
  const p = mode === "light" ? gallerySlate.light : gallerySlate.dark;
  const theme = createTheme({
    palette: {
      mode,
      primary: p.primary,
      secondary: p.secondary,
      background: p.background,
      text: p.text,
      divider: p.divider,
      success: p.success,
      warning: p.warning,
      error: p.error,
      info: p.info,
      // custom field set via module augmentation below
      accent: p.accent,
    },
    shape: { borderRadius: 16 }, // Increased border radius
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: { fontWeight: 700 },
      h2: { fontWeight: 700 },
      h3: { fontWeight: 600 },
      h4: { fontWeight: 600 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (themeParam) => ({
          'html, body, #root': {
            backgroundColor: themeParam.palette.background.default,
            color: themeParam.palette.text.primary,
            minHeight: '100%',
            scrollBehavior: 'smooth',
          },
          body: {
            // CSS custom properties for app-wide use
            "--color-bg": themeParam.palette.background.default,
            "--color-paper": themeParam.palette.background.paper,
            "--color-text": themeParam.palette.text.primary,
            "--color-text-secondary": themeParam.palette.text.secondary,
            "--color-divider": themeParam.palette.divider,
            "--color-primary": themeParam.palette.primary.main,
            "--color-secondary": themeParam.palette.secondary.main,
            "--color-accent": themeParam.palette.accent.main,
            "--overlay-hover": p.overlays.hover,
            "--overlay-active": p.overlays.active,
            "--overlay-focus": p.overlays.focus,
            "--overlay-selection": p.overlays.selection,
          },
          '.MuiPaper-root': {
            backgroundColor: themeParam.palette.background.paper,
            color: themeParam.palette.text.primary,
          },
          '.MuiDialog-paper': {
            backgroundColor: themeParam.palette.background.paper,
            color: themeParam.palette.text.primary,
          },
        }),
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            // Glassmorphism effect
            backdropFilter: "blur(12px)",
            backgroundColor: p.overlays.elevated,
            '&.MuiPaper-elevation1': { 
              boxShadow: mode === 'light' 
                ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' 
                : '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
            },
            '&.MuiPaper-elevation2': {
               boxShadow: mode === 'light'
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
                : '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
            }
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          colorPrimary: {
            backgroundColor: p.overlays.elevated,
            backdropFilter: "blur(12px)",
            color: p.text.primary,
            borderBottom: `1px solid ${p.divider}`,
            boxShadow: 'none',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { 
            textTransform: "none",
            borderRadius: 12,
            padding: "8px 16px",
          },
          containedPrimary: { 
            boxShadow: "0 4px 6px -1px rgba(59, 130, 246, 0.3)",
            '&:hover': {
              boxShadow: "0 10px 15px -3px rgba(59, 130, 246, 0.4)",
            }
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500 },
          colorPrimary: ({ theme }) => ({
            background: theme.palette.primary.main,
            color: theme.palette.getContrastText(theme.palette.primary.main),
          }),
          colorInfo: ({ theme }) => ({
            background: theme.palette.info.main,
            color: "#FFFFFF",
          }),
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { 
            backgroundColor: p.primary.main,
            height: 3,
            borderRadius: '3px 3px 0 0'
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { 
            textTransform: "none",
            fontWeight: 600,
            fontSize: '0.95rem',
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: p.text.primary,
            color: p.background.paper,
            borderRadius: 8,
            fontSize: '0.8rem',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: '2px 8px',
            "&:hover": { background: p.overlays.hover },
            "&.Mui-selected": {
              background: p.overlays.selection,
              color: p.primary.main,
              "& .MuiListItemIcon-root": {
                color: p.primary.main,
              }
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            "&:hover": { background: p.overlays.hover },
            "&.Mui-focusVisible": { boxShadow: `0 0 0 3px ${p.overlays.focus}` },
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: p.divider } },
      },
    },
  });
  return theme;
};

// Palette augmentation for custom 'accent'
declare module "@mui/material/styles" {
  interface Palette {
    accent: Palette["primary"];
  }
  interface PaletteOptions {
    accent?: PaletteOptions["primary"];
  }
}
