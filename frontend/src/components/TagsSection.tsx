import React from "react";
import { Box, Typography } from "@mui/material";
import { Media, Person, Tag } from "../types";
import config from "../config";
import TagAdder from "./TagAdder";
import { Tags } from "./Tags";

interface TagsSectionProps {
  media?: Media;
  person?: Person;
  onTagAdded: (tag: Tag) => void;
  onUpdate: (updatedMediaObject: Media | Person) => void;
}

export function TagsSection({
  media,
  person,
  onTagAdded,
  onUpdate,
}: TagsSectionProps) {
  const owner = media || person;
  const ownerType = media ? "media" : "person";
  if (!owner) return null;
  const tags = owner.tags ?? [];
  const ownerId = owner.id;
  return (
    <Box mt={4}>
      {!config.PRESENTATION_MODE && (
        <Box mb={2}>
          <Typography variant="h6" gutterBottom>
            {ownerType === "person" ? "Add tag to person" : "Add tag to media"}
          </Typography>
          <TagAdder
            ownerType={ownerType}
            ownerId={ownerId}
            existingTags={tags ?? []}
            onTagAdded={onTagAdded}
          />
        </Box>
      )}

      {tags && tags.length > 0 && (
        <Tags media={media} person={person} onUpdate={onUpdate} />
      )}
    </Box>
  );
}
