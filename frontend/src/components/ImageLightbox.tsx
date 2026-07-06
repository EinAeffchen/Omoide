import React, { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.15;

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export function ImageLightbox({ open, src, alt, onClose }: ImageLightboxProps) {
  const [viewState, setViewState] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Refs to avoid stale closures in DOM event listeners
  const viewStateRef = useRef(viewState);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
  const pinchDistRef = useRef<number | null>(null);
  const pinchPanRef = useRef<{ x: number; y: number } | null>(null);

  // Keep ref in sync so DOM listeners always see current state
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

  const updateState = useCallback((next: ViewState) => {
    viewStateRef.current = next;
    setViewState(next);
  }, []);

  const reset = useCallback(() => {
    updateState({ zoom: 1, panX: 0, panY: 0 });
  }, [updateState]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // Wheel — must be a passive:false DOM listener to call preventDefault
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelHandlerRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const { zoom, panX, panY } = viewStateRef.current;
      const rect = container.getBoundingClientRect();
      // Mouse position relative to container center
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      const newZoom = clampZoom(zoom * factor);
      if (newZoom <= MIN_ZOOM) {
        updateState({ zoom: MIN_ZOOM, panX: 0, panY: 0 });
        return;
      }
      // Zoom toward the cursor position
      updateState({
        zoom: newZoom,
        panX: mouseX - (mouseX - panX) * (newZoom / zoom),
        panY: mouseY - (mouseY - panY) * (newZoom / zoom),
      });
    };
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: WheelEvent) => wheelHandlerRef.current(e);
    document.addEventListener("wheel", handler, { passive: false });
    return () => document.removeEventListener("wheel", handler);
  }, [open]);

  // Mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (viewState.zoom <= MIN_ZOOM) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: viewState.panX,
      startPanY: viewState.panY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setViewState((prev) => ({
      ...prev,
      panX: dragRef.current.startPanX + (e.clientX - dragRef.current.startX),
      panY: dragRef.current.startPanY + (e.clientY - dragRef.current.startY),
    }));
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch — pinch-to-zoom and single-finger pan
  const getTouchDist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchDistRef.current = getTouchDist(e.touches);
      pinchPanRef.current = null;
    } else if (e.touches.length === 1 && viewState.zoom > MIN_ZOOM) {
      pinchPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pinchDistRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistRef.current !== null) {
      const newDist = getTouchDist(e.touches);
      const factor = newDist / pinchDistRef.current;
      pinchDistRef.current = newDist;
      const { zoom, panX, panY } = viewStateRef.current;
      const newZoom = clampZoom(zoom * factor);
      if (newZoom <= MIN_ZOOM) {
        updateState({ zoom: MIN_ZOOM, panX: 0, panY: 0 });
      } else {
        updateState({ zoom: newZoom, panX: panX * factor, panY: panY * factor });
      }
    } else if (e.touches.length === 1 && pinchPanRef.current) {
      const dx = e.touches[0].clientX - pinchPanRef.current.x;
      const dy = e.touches[0].clientY - pinchPanRef.current.y;
      pinchPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setViewState((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
    }
  };

  const handleTouchEnd = () => {
    pinchDistRef.current = null;
    pinchPanRef.current = null;
  };

  // Keyboard shortcuts — registered in the capture phase so Arrow keys are
  // consumed here (pan when zoomed, otherwise noop) and never reach the
  // page-level prev/next navigation handler while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.stopPropagation();
        e.preventDefault();
        const { zoom, panX, panY } = viewStateRef.current;
        if (zoom > MIN_ZOOM) {
          const step = 40;
          const dx =
            e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
          const dy =
            e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
          updateState({ zoom, panX: panX + dx, panY: panY + dy });
        }
      } else if (e.key === "+" || e.key === "=") {
        const { zoom, panX, panY } = viewStateRef.current;
        updateState({ zoom: clampZoom(zoom * (1 + ZOOM_STEP)), panX, panY });
      } else if (e.key === "-") {
        const { zoom, panX, panY } = viewStateRef.current;
        const newZoom = clampZoom(zoom * (1 - ZOOM_STEP));
        updateState(newZoom <= MIN_ZOOM ? { zoom: MIN_ZOOM, panX: 0, panY: 0 } : { zoom: newZoom, panX, panY });
      } else if (e.key === "0") {
        reset();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, reset, updateState]);

  const { zoom, panX, panY } = viewState;
  const cursor = zoom > MIN_ZOOM ? (isDragging ? "grabbing" : "grab") : "zoom-in";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      PaperProps={{ sx: { bgcolor: "rgba(0,0,0,0.95)", m: 0, overflow: "hidden" } }}
    >
      <IconButton
        onClick={onClose}
        size="small"
        sx={{
          position: "fixed",
          top: 8,
          right: 8,
          zIndex: 10,
          color: "white",
          bgcolor: "rgba(0,0,0,0.5)",
          "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
        }}
      >
        <CloseIcon />
      </IconButton>

      {/* Zoom controls */}
      <Box
        sx={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          bgcolor: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          borderRadius: 2,
          px: 1,
          py: 0.5,
          zIndex: 10,
        }}
      >
        <IconButton
          size="small"
          onClick={() => {
            const { zoom: z, panX: px, panY: py } = viewStateRef.current;
            const nz = clampZoom(z * (1 - ZOOM_STEP));
            updateState(nz <= MIN_ZOOM ? { zoom: MIN_ZOOM, panX: 0, panY: 0 } : { zoom: nz, panX: px, panY: py });
          }}
          disabled={zoom <= MIN_ZOOM}
          sx={{ color: "white" }}
        >
          <ZoomOutIcon fontSize="small" />
        </IconButton>
        <Typography
          variant="body2"
          sx={{ color: "white", minWidth: 48, textAlign: "center", fontSize: "0.8rem" }}
        >
          {Math.round(zoom * 100)}%
        </Typography>
        <IconButton
          size="small"
          onClick={() => {
            const { zoom: z, panX: px, panY: py } = viewStateRef.current;
            updateState({ zoom: clampZoom(z * (1 + ZOOM_STEP)), panX: px, panY: py });
          }}
          disabled={zoom >= MAX_ZOOM}
          sx={{ color: "white" }}
        >
          <ZoomInIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={reset}
          disabled={zoom === MIN_ZOOM && panX === 0 && panY === 0}
          sx={{ color: "white" }}
        >
          <RestartAltIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Image container */}
      <Box
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={reset}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <Box
          component="img"
          src={src}
          alt={alt}
          draggable={false}
          sx={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.08s ease-out",
            pointerEvents: "none",
            display: "block",
          }}
        />
      </Box>
    </Dialog>
  );
}
