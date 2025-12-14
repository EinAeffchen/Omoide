import React from "react";
import { Alert, Container, Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import config from "../config";

interface ReadOnlyNoticeProps {
  title?: string;
  description?: string;
}

export function ReadOnlyNotice({
  title = "Read-only Mode",
  description = "This area is disabled because the system is running in read-only mode.",
}: ReadOnlyNoticeProps) {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Alert
        severity="info"
        icon={<LockOutlinedIcon fontSize="large" />}
        sx={{
          alignItems: "center",
          gap: 1.5,
          py: 3,
        }}
      >
        <Typography variant="h5" component="h2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body1">{description}</Typography>
      </Alert>
    </Container>
  );
}

interface WriteModeBoundaryProps extends ReadOnlyNoticeProps {
  children: React.ReactNode;
}

export function WriteModeBoundary({
  children,
  title,
  description,
}: WriteModeBoundaryProps) {
  const [, forceUpdate] = React.useState(0);

  React.useEffect(() => {
    const handler = () => forceUpdate((state) => state + 1);
    window.addEventListener("runtime-config-updated", handler as EventListener);
    return () =>
      window.removeEventListener(
        "runtime-config-updated",
        handler as EventListener
      );
  }, []);

  if (config.PRESENTATION_MODE) {
    return <ReadOnlyNotice title={title} description={description} />;
  }

  return <>{children}</>;
}
