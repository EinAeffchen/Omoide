import React from "react";
import { Box, CircularProgress, Paper } from "@mui/material";

interface ReviewMediaGridProps {
  itemCount: number;
  isLoading: boolean;
  hasMore: boolean;
  loaderRef: (node?: Element | null) => void;
  empty: React.ReactNode;
  children: React.ReactNode;
}

const ReviewMediaGrid: React.FC<ReviewMediaGridProps> = ({
  itemCount,
  isLoading,
  hasMore,
  loaderRef,
  empty,
  children,
}) => (
  <Paper variant="outlined" sx={{ mb: 3 }}>
    {isLoading && itemCount === 0 ? (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    ) : itemCount === 0 ? (
      <Box sx={{ py: 6, textAlign: "center" }}>{empty}</Box>
    ) : (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 1.5,
          p: 2,
        }}
      >
        {children}
      </Box>
    )}
    {hasMore && <Box ref={loaderRef} sx={{ height: 1 }} />}
    {isLoading && itemCount > 0 && (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )}
  </Paper>
);

export default ReviewMediaGrid;
