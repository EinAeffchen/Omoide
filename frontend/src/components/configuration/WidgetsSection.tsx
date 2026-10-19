import React, { useMemo } from "react";
import {
  FormControlLabel,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Switch,
  Typography,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import FavoriteIcon from "@mui/icons-material/Favorite";
import StarIcon from "@mui/icons-material/Star";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import InsightsIcon from "@mui/icons-material/Insights";
import { HOME_WIDGETS, HomeWidgetId, mergeHomeWidgets } from "../../homeWidgets";
import { ConfigSectionProps } from "./shared";

const HOME_WIDGET_ICONS: Record<HomeWidgetId, React.ReactNode> = {
  on_this_day: <AutoAwesomeIcon fontSize="small" />,
  recent_media: <PhotoLibraryIcon fontSize="small" />,
  favorites_strip: <FavoriteIcon fontSize="small" />,
  highlights_strip: <StarIcon fontSize="small" />,
  albums_preview: <PhotoAlbumIcon fontSize="small" />,
  statistics_snapshot: <InsightsIcon fontSize="small" />,
};

export default function WidgetsSection({
  config,
  onValueChange,
}: ConfigSectionProps) {
  const homeWidgets = useMemo(
    () => mergeHomeWidgets(config.general.home_widgets),
    [config.general.home_widgets]
  );

  const toggleHomeWidget = (id: HomeWidgetId, enabled: boolean) => {
    const next = homeWidgets.map((w) => (w.id === id ? { ...w, enabled } : w));
    onValueChange("general", "home_widgets", next);
  };

  const moveHomeWidget = (id: HomeWidgetId, direction: -1 | 1) => {
    const index = homeWidgets.findIndex((w) => w.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= homeWidgets.length) return;
    const next = [...homeWidgets];
    [next[index], next[target]] = [next[target], next[index]];
    onValueChange("general", "home_widgets", next);
  };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Homepage Widgets
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Choose what shows on your homepage, and in what order. Click
          Save below to apply.
        </Typography>
        <Paper variant="outlined">
          <List dense disablePadding>
            {homeWidgets.map((widget, index) => {
              const def = HOME_WIDGETS.find((w) => w.id === widget.id);
              if (!def) return null;
              return (
                <ListItem
                  key={widget.id}
                  divider={index < homeWidgets.length - 1}
                  sx={{ py: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {HOME_WIDGET_ICONS[widget.id]}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <FormControlLabel
                        control={
                          <Switch
                            checked={widget.enabled}
                            onChange={(e) =>
                              toggleHomeWidget(widget.id, e.target.checked)
                            }
                          />
                        }
                        label={def.label}
                      />
                    }
                    secondary={def.description}
                    secondaryTypographyProps={{ sx: { ml: 6 } }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      size="small"
                      aria-label={`Move ${def.label} up`}
                      disabled={index === 0}
                      onClick={() => moveHomeWidget(widget.id, -1)}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move ${def.label} down`}
                      disabled={index === homeWidgets.length - 1}
                      onClick={() => moveHomeWidget(widget.id, 1)}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
          </List>
        </Paper>
      </Grid>
    </Grid>
  );
}
