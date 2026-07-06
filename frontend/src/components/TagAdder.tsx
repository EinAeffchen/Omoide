import React, { useState, useEffect } from "react";
import { TextField, Autocomplete, CircularProgress } from "@mui/material";
import { Tag } from "../types";
import { getTags } from "../services/tag";
import { searchTags } from "../services/search";
import { createTag, assignTag } from "../services/tagging";

type OwnerType = "media" | "person";

interface TagAdderProps {
  ownerType: OwnerType;
  ownerId: number;
  existingTags: Tag[];
  onTagAdded: (newTag: Tag) => void;
}

interface TagOption extends Partial<Tag> {
  inputValue?: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 25;

export default function TagAdder({
  ownerType,
  ownerId,
  existingTags,
  onTagAdded,
}: TagAdderProps) {
  // Options come from a server-side search of the typed input so the
  // duplicate check is not limited to the first page of tags.
  const [options, setOptions] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = inputValue.trim();
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(
      () => {
        const request = query
          ? searchTags(query, SEARCH_LIMIT)
          : getTags(null);
        request
          .then((page) => {
            if (!cancelled) setOptions(page.items ?? []);
          })
          .catch((error) => {
            if (!cancelled) console.error("Failed to load tags:", error);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  const handleSelection = async (
    event: React.SyntheticEvent,
    newValue: string | TagOption | null
  ) => {
    if (!newValue) return;

    let tagNameToProcess: string;

    // This is a "Create new tag" action
    if (typeof newValue === "object" && newValue.inputValue) {
      tagNameToProcess = newValue.inputValue;
    }
    // This is selecting an existing tag
    else if (typeof newValue === "object" && newValue.name) {
      tagNameToProcess = newValue.name;
    }
    // This is for when the user types and hits Enter without selecting
    else if (typeof newValue === "string") {
      tagNameToProcess = newValue;
    } else {
      return;
    }

    const finalTagName = tagNameToProcess.trim().toLowerCase();
    if (!finalTagName) return;

    if (existingTags.some((t) => t.name.toLowerCase() === finalTagName)) {
      console.log(`Tag "${finalTagName}" is already assigned.`);
      return;
    }

    // Find the tag in the search results or create it
    let tagToAssign = options.find(
      (t) => t.name.toLowerCase() === finalTagName
    );
    if (!tagToAssign) {
      try {
        tagToAssign = await createTag(finalTagName);
      } catch (error) {
        console.error("Error creating tag:", error);
        return;
      }
    }

    // Assign the tag
    try {
      await assignTag(ownerType, ownerId, tagToAssign!.id);
      onTagAdded(tagToAssign);
    } catch (error) {
      console.error("Error assigning tag:", error);
    }
  };

  const availableOptions = options.filter(
    (tag) => !existingTags.some((existingTag) => existingTag.id === tag.id)
  );

  return (
    <Autocomplete
      fullWidth
      freeSolo
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      value={null}
      onChange={handleSelection}
      inputValue={inputValue}
      onInputChange={(_, newInputValue) => setInputValue(newInputValue)}
      options={availableOptions}
      loading={loading}
      getOptionLabel={(option) => {
        if (typeof option === "string") return option;
        if (option.inputValue) return option.name; // For "Create..." text
        return option.name ?? "";
      }}
      filterOptions={(opts, params) => {
        // Options are already filtered server-side; only decide whether to
        // offer creating a new tag based on the search results.
        const filtered = [...opts] as TagOption[];
        const query = params.inputValue.trim().toLowerCase();
        const isExisting = opts.some(
          (option) =>
            typeof option !== "string" &&
            query === option.name?.toLowerCase()
        );
        if (query !== "" && !isExisting && !loading) {
          filtered.push({
            inputValue: params.inputValue,
            name: `Create "${params.inputValue}"`,
          });
        }
        return filtered;
      }}
      renderOption={(props, option) => {
        if (typeof option === "string") {
          return (
            <li {...props} key={option}>
              {option}
            </li>
          );
        }
        return (
          <li {...props} key={option.id || option.inputValue}>
            {option.name}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="filled"
          size="small"
          placeholder="Add or create a tag..."
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? (
                  <CircularProgress color="inherit" size={20} />
                ) : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
