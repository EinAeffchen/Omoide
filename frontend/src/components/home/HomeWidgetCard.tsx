import React from "react";
import { Box, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

interface HomeWidgetCardProps {
  icon: React.ReactNode;
  title: string;
  viewAllTo?: string;
  children: React.ReactNode;
}

/** Shared card chrome for optional homepage widgets (title row + content). */
export function HomeWidgetCard({
  icon,
  title,
  viewAllTo,
  children,
}: HomeWidgetCardProps) {
  return (
    <Box
      sx={{
        mb: 4,
        p: 2,
        borderRadius: 3,
        bgcolor: "background.paper",
        boxShadow: (theme) => theme.shadows[1],
      }}
    >
      <Box display="flex" alignItems="center" gap={1} mb={1.5}>
        {icon}
        <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {viewAllTo && (
          <Box
            component={Link}
            to={viewAllTo}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "primary.main",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            View all
            <ArrowForwardIcon sx={{ fontSize: 16 }} />
          </Box>
        )}
      </Box>
      {children}
    </Box>
  );
}
