import React, { useEffect, useState } from "react";
import { Box, Fade, Typography } from "@mui/material";
import TouchAppIcon from "@mui/icons-material/TouchApp";

export function SwipeHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Fade in={visible} timeout={1000}>
      <Box
        sx={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 9999,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          bgcolor: "rgba(0, 0, 0, 0.6)",
          borderRadius: 4,
          p: 3,
          backdropFilter: "blur(4px)",
        }}
      >
        <TouchAppIcon sx={{ fontSize: 64, mb: 1, animation: "swipeAnimation 1.5s infinite" }} />
        <Typography variant="h6" fontWeight="bold">
          Swipe to Navigate
        </Typography>
        <style>
          {`
            @keyframes swipeAnimation {
              0% { transform: translateX(-20px); opacity: 0.5; }
              50% { transform: translateX(20px); opacity: 1; }
              100% { transform: translateX(-20px); opacity: 0.5; }
            }
          `}
        </style>
      </Box>
    </Fade>
  );
}
