import React, { useState, useEffect } from "react";
import { PeopleSection } from "./PeopleSection";
import {
  assignFace,
  createPersonFromFaces,
  deleteFace,
  detachFace,
} from "../services/faceActions";
import { addMediaAppearanceToPerson } from "../services/personActions";
import { Person, Face } from "../types";

interface PeopleTabContentProps {
  mediaId: number;
  initialPersons: Person[];
  initialOrphans: Face[];
  onDataChanged: () => void;
}

export function PeopleTabContent({
  mediaId,
  initialPersons,
  initialOrphans,
  onDataChanged,
}: PeopleTabContentProps) {
  const [persons, setPersons] = useState(initialPersons);
  const [orphans, setOrphans] = useState(initialOrphans);

  useEffect(() => {
    setPersons(initialPersons);
    setOrphans(initialOrphans);
  }, [initialPersons, initialOrphans]);

  const handleDeleteFace = async (faceIds: number[]) => {
    await deleteFace(faceIds);
    setOrphans((prev) => prev.filter((f) => !faceIds.includes(f.id)));
    onDataChanged();
  };

  const handleAssignFace = async (faceIds: number[], personId: number) => {
    await assignFace(faceIds, personId);
    setOrphans((prev) => prev.filter((f) => !faceIds.includes(f.id)));
    onDataChanged();
  };

  const handleDetachFace = async (faceIds: number[]) => {
    await detachFace(faceIds);
    onDataChanged();
  };

  const handleCreateFace = async (faceIds: number[], name: string) => {
    const newPerson = await createPersonFromFaces(faceIds, name);
    setOrphans((prev) => prev.filter((f) => !faceIds.includes(f.id)));
    onDataChanged();
    return newPerson;
  };
  const handleAttachMediaToPerson = async (personId: number) => {
    const result = await addMediaAppearanceToPerson(personId, mediaId);
    onDataChanged();
    return result;
  };

  return (
    <PeopleSection
      persons={persons}
      orphans={orphans}
      onAttachMediaToPerson={handleAttachMediaToPerson}
      onAssign={handleAssignFace}
      onDeleteFace={handleDeleteFace}
      onDetachFace={handleDetachFace}
      onCreateFace={handleCreateFace}
    />
  );
}
