import React from "react";
import {
  Card,
  CardContent,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Chip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { TimelineEvent } from "../types";
import CakeIcon from "@mui/icons-material/Cake";

interface EventCardProps {
  event: TimelineEvent;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  onEdit,
  onDelete,
}) => {
  return (
    <Card
      variant="outlined"
      sx={{ borderWidth: "1px", borderColor: "divider" }}
    >
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <Box>
            <Typography variant="h6" component="div">
              {event.title}
            </Typography>
            {event.description && (
              <Typography variant="body2" color="text.secondary">
                {event.description}
              </Typography>
            )}
            {event.recurrence === "yearly" && (
              <Chip
                icon={<CakeIcon />}
                label="Recurs Yearly"
                size="small"
                sx={{ mt: 1 }}
              />
            )}
          </Box>
          <Box>
            {onEdit && (
              <Tooltip title="Edit Event">
                <IconButton size="small" onClick={onEdit}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip title="Delete Event">
                <IconButton size="small" onClick={onDelete}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
