import React, { useCallback } from "react";
import { Box, Container, Typography } from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import { useSearchParams } from "react-router-dom";
import { CursorMediaGrid } from "../components/CursorMediaGrid";
import { EmptyState } from "../components/EmptyState";
import { getPlaceMedia } from "../services/features";

export default function PlaceMediaPage() {
  const [searchParams] = useSearchParams();
  const city = searchParams.get("city") ?? "";
  const country = searchParams.get("country");

  const fetcher = useCallback(
    (cursor: string | null) => getPlaceMedia(city, country, cursor),
    [city, country]
  );

  return (
    <Container maxWidth="xl" sx={{ minHeight: "100vh", py: 4 }}>
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <PublicIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          {city}
          {country ? `, ${country}` : ""}
        </Typography>
      </Box>
      <CursorMediaGrid
        listKey={`place-${country ?? ""}-${city}`}
        fetcher={fetcher}
        empty={
          <EmptyState
            icon={<PublicIcon />}
            title="No media"
            description="No media found for this place."
          />
        }
      />
    </Container>
  );
}
