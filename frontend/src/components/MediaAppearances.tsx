import React, { useState, useEffect } from "react";
import { Box, CircularProgress, Autocomplete, TextField } from "@mui/material";
import Masonry from "react-masonry-css";
import { useInView } from "react-intersection-observer";

import { Person, PersonReadSimple, Tag } from "../types";
import MediaCard from "./MediaCard";
import { useListStore, defaultListState } from "../stores/useListStore";
import { getPeople, getPersonMediaAppearances } from "../services/person";
import { getTags } from "../services/tag";
import { searchTags } from "../services/search";

const breakpointColumnsObj = {
  default: 6,
  1800: 5,
  1500: 4,
  1200: 3,
  900: 2,
  600: 1,
};

interface MediaAppearancesProps {
  person: Person;
  filterPeople: PersonReadSimple[];
  onFilterPeopleChange: (people: PersonReadSimple[]) => void;
  filterTags: Tag[];
  onFilterTagsChange: (tags: Tag[]) => void;
  mediaListKey: string;
}
export default function MediaAppearances({
  person,
  filterPeople,
  onFilterPeopleChange,
  filterTags,
  onFilterTagsChange,
  mediaListKey,
}: MediaAppearancesProps) {
  const [personOptions, setPersonOptions] = useState<PersonReadSimple[]>([]);
  const [tagOptions, setTagOptions] = useState<Tag[]>([]);
  const [tagQuery, setTagQuery] = useState("");

  const { items, hasMore, isLoading } = useListStore(
    (state) => state.lists[mediaListKey] || defaultListState
  );
  const { fetchInitial, loadMore } = useListStore();
  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  useEffect(() => {
    getPeople()
      .then((data) => {
        const options = data.items.filter((p) => p.id !== person.id);
        setPersonOptions(options);
      })
      .catch((err) => console.error("Failed to fetch person options:", err));
  }, [person.id]);

  useEffect(() => {
    let active = true;
    const trimmed = tagQuery.trim();
    const loadTags = async () => {
      try {
        const data = trimmed
          ? await searchTags(trimmed, 25)
          : await getTags(null);
        if (!active) return;
        setTagOptions(data.items || []);
      } catch (error) {
        if (active) {
          console.error("Failed to load tag options:", error);
        }
      }
    };
    void loadTags();
    return () => {
      active = false;
    };
  }, [tagQuery]);

  useEffect(() => {
    const filterIds = filterPeople.map((p) => p.id);
    const tagNames = filterTags.map((tag) => tag.name);
    fetchInitial(mediaListKey, () =>
      getPersonMediaAppearances(person.id, undefined, filterIds, tagNames)
    );
  }, [mediaListKey, fetchInitial, person.id, filterPeople, filterTags]);

  useEffect(() => {
    if (inView && hasMore && !isLoading) {
      const filterIds = filterPeople.map((p) => p.id);
      const tagNames = filterTags.map((tag) => tag.name);
      loadMore(mediaListKey, (cursor) =>
        getPersonMediaAppearances(person.id, cursor, filterIds, tagNames)
      );
    }
  }, [
    inView,
    hasMore,
    isLoading,
    loadMore,
    mediaListKey,
    person.id,
    filterPeople,
    filterTags,
  ]);

  return (
    <Box>
      <Box sx={{ mb: 2, p: 2, bgcolor: "background.paper", borderRadius: 1 }}>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          }}
        >
          <Autocomplete
            multiple
            limitTags={3}
            options={personOptions}
            getOptionLabel={(option) => option.name || `Person ${option.id}`}
            value={filterPeople}
            onChange={(_event, newValue) => {
              onFilterPeopleChange(newValue);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                label="Filter by photos also including..."
                placeholder="Select people"
              />
            )}
          />
          <Autocomplete
            multiple
            limitTags={3}
            options={tagOptions}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={filterTags}
            filterSelectedOptions
            onInputChange={(_event, newValue) => setTagQuery(newValue)}
            onChange={(_event, newValue) => {
              onFilterTagsChange(newValue);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                label="Filter by tags"
                placeholder="Select tags"
              />
            )}
          />
        </Box>
      </Box>
      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {items &&
          items.map((media) => (
            <div key={media.id}>
              <MediaCard media={media} mediaListKey={mediaListKey} />
            </div>
          ))}
      </Masonry>

      <Box ref={loaderRef} sx={{ height: "1px" }} />

      {isLoading && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
}
