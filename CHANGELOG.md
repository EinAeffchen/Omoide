# Changelog

User-facing changes per release. Add entries under "Unreleased" as you go;
`make release` turns that section into the new version's release notes.

## [Unreleased]

### Added

### Changed

### Fixed

## [0.7.6] - 2026-10-21

### Added

- Videos the browser can't play (e.g. HEVC, AVI, WMV) can be converted with ffmpeg: on the fly while playing, or automatically after scans into a playable copy or replacing the original (Configuration → Video).
- Map editor: filter un-located media by folder and choose the order (recently added, date taken, folder & file name).
- Map editor: folders and files Omoide can't write locations into are marked with a lock and the reason (read-only media directory, OS permissions, read-only drive).
- "Write Locations into Files" setting: when off, locations set in the map editor are only stored in Omoide's database, which also works for read-only media directories.

### Changed

- The map editor now also lists media without any EXIF data, and no longer lists files missing from disk.
- Locations set by hand are kept when EXIF data is extracted again.

### Fixed

- Saving a location to a write-protected file now explains why it failed.
