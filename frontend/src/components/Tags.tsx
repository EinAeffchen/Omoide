import React from "react";
import { Link } from "react-router-dom";
import { Media, Tag } from "../types";
import { Person } from "../types";
import { Chip, Box, Typography } from "@mui/material";
import {
  removeTagFromMedia,
  removeTagFromPerson,
} from "../services/tagActions";
import config from "../config";

export interface TagsProps {
  media?: Media;
  person?: Person;
  onUpdate: (updated: Media | Person) => void;
}

export function Tags({ media, person, onUpdate }: Readonly<TagsProps>) {
  const owner = media || person;
  if (!owner) {
    return null;
  }

  const handleRemove = async (tagToRemove: Tag) => {
    try {
      if (media) {
        await removeTagFromMedia(media.id, tagToRemove.id);
        onUpdate({
          ...media,
          tags: media.tags.filter((t) => t.id !== tagToRemove.id),
        });
      } else if (person) {
        await removeTagFromPerson(person.id, tagToRemove.id);
        onUpdate({
          ...person,
          tags: person.tags.filter((t) => t.id !== tagToRemove.id),
        });
      }
    } catch (error) {
      console.error("Failed to remove tag:", error);
    }
  };
  return (
    <Box component="section" sx={{ mt: 2 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1, fontWeight: "600" }}>
        Tags
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {(owner.tags ?? []).map((tag) => (
          <Chip
            key={tag.id}
            label={tag.name}
            // This makes the whole chip a clickable link
            component={Link}
            to={`/tag/${tag.id}`}
            clickable
            // The onDelete prop adds a delete icon and handles the click
            onDelete={
              config.PRESENTATION_MODE
                ? undefined
                : (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRemove(tag);
                  }
            }
            // Use the theme's accent color for a consistent look
            sx={{
              color: "accent.dark",
              fontWeight: 500,
              borderColor: "accent.dark",
              "& .MuiChip-deleteIcon": {
                color: "accent.dark",
                "&:hover": {
                  color: "accent.dark", // A darker shade on hover
                },
              },
            }}
            variant="outlined"
          />
        ))}
      </Box>
    </Box>
  );
}
