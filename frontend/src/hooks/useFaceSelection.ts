import { useState, useCallback } from "react";
import { FaceRead } from "../types";

export const useFaceSelection = () => {
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  const onToggleSelect = useCallback((faceId: number) => {
    setSelectedFaceIds((prev) =>
      prev.includes(faceId)
        ? prev.filter((id) => id !== faceId)
        : [...prev, faceId]
    );
  }, []);

  const onSelectAll = useCallback(
    (faces: FaceRead[]) => {
      if (selectedFaceIds.length < faces.length) {
        setSelectedFaceIds(faces.map((f) => f.id));
      } else {
        setSelectedFaceIds([]);
      }
    },
    [selectedFaceIds.length]
  );

  const onClearSelection = useCallback(() => {
    setSelectedFaceIds([]);
  }, []);

  return {
    selectedFaceIds,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    setSelectedFaceIds,
  };
};
