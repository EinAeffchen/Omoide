"""Prepare a release: set the version, roll CHANGELOG.md, commit and tag.

    uv run python scripts/release.py              # see "auto" below
    uv run python scripts/release.py patch|minor|major
    uv run python scripts/release.py 0.8.0
    uv run python scripts/release.py notes 0.7.6  # print a version's notes (CI)

"auto" releases the version already in app/VERSION if it has no tag yet,
otherwise the next patch version. Add --dry-run to only show what would
happen, --yes to skip the confirmation prompts.

The version lives in app/VERSION, pyproject.toml and uv.lock; this script
updates all three. Release notes come from the "Unreleased" section of
CHANGELOG.md, which becomes the new version's section. Pushing the tag
(`make push`) lets CI build the release and attach these notes.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "app" / "VERSION"
PYPROJECT = ROOT / "pyproject.toml"
UV_LOCK = ROOT / "uv.lock"
CHANGELOG = ROOT / "CHANGELOG.md"
RELEASE_FILES = [VERSION_FILE, PYPROJECT, UV_LOCK, CHANGELOG]

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$")
UNRELEASED_HEADING = "## [Unreleased]"
CHANGELOG_TEMPLATE = """# Changelog

User-facing changes per release. Add entries under "Unreleased" as you go;
`make release` turns that section into the new version's release notes.

{unreleased}
"""
EMPTY_UNRELEASED = f"""{UNRELEASED_HEADING}

### Added

### Changed

### Fixed
"""


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.rstrip()  # keep leading spaces: `status --porcelain` columns


def tag_exists(version: str) -> bool:
    return bool(git("tag", "--list", f"v{version}"))


def current_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def next_version(current: str, target: str) -> str:
    if target == "auto":
        return current if not tag_exists(current) else next_version(current, "patch")
    if target in ("patch", "minor", "major"):
        major, minor, patch = (int(p) for p in current.split("-")[0].split(".")[:3])
        if target == "major":
            return f"{major + 1}.0.0"
        if target == "minor":
            return f"{major}.{minor + 1}.0"
        return f"{major}.{minor}.{patch + 1}"
    version = target.removeprefix("v")
    if not VERSION_RE.match(version):
        sys.exit(f"Not a version or bump keyword: {target}")
    return version


# --- CHANGELOG.md -----------------------------------------------------------


def _sections(text: str) -> list[tuple[str, str]]:
    """(heading, body) for each "## " section, in file order."""
    parts = re.split(r"^(## .*)$", text, flags=re.M)
    return [(parts[i].strip(), parts[i + 1]) for i in range(1, len(parts), 2)]


def _has_entries(body: str) -> bool:
    return any(
        line.strip() and not line.lstrip().startswith("#") for line in body.splitlines()
    )


def _drop_empty_subsections(body: str) -> str:
    """Remove "### Heading" blocks without entries (template leftovers)."""
    blocks = re.split(r"^(?=### )", body.strip(), flags=re.M)
    kept = [b.strip() for b in blocks if _has_entries(b)]
    return "\n\n".join(kept)


def section_notes(version: str) -> str | None:
    if not CHANGELOG.exists():
        return None
    for heading, body in _sections(CHANGELOG.read_text(encoding="utf-8")):
        if heading.startswith(f"## [{version}]"):
            return _drop_empty_subsections(body)
    return None


def unreleased_notes() -> str:
    if not CHANGELOG.exists():
        return ""
    for heading, body in _sections(CHANGELOG.read_text(encoding="utf-8")):
        if heading.startswith(UNRELEASED_HEADING):
            return _drop_empty_subsections(body) if _has_entries(body) else ""
    return ""


def roll_changelog(version: str, notes: str) -> None:
    """Turn the Unreleased section into `version`'s and start a fresh one."""
    released = f"## [{version}] - {date.today().isoformat()}\n\n{notes}\n"
    if not CHANGELOG.exists():
        CHANGELOG.write_text(
            CHANGELOG_TEMPLATE.format(unreleased=EMPTY_UNRELEASED + "\n" + released),
            encoding="utf-8",
        )
        return
    text = CHANGELOG.read_text(encoding="utf-8")
    pattern = re.compile(r"^## \[Unreleased\].*?(?=^## |\Z)", flags=re.M | re.S)
    replacement = EMPTY_UNRELEASED + "\n" + released + "\n"
    if pattern.search(text):
        text = pattern.sub(lambda _: replacement, text, count=1)
    else:
        first = re.search(r"^## ", text, flags=re.M)
        at = first.start() if first else len(text)
        text = text[:at] + replacement + text[at:]
    CHANGELOG.write_text(text.rstrip() + "\n", encoding="utf-8")


# --- Version files ------------------------------------------------------------


def _replace_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.M)
    if count != 1:
        sys.exit(f"Could not find the version in {path.relative_to(ROOT)}")
    path.write_text(updated, encoding="utf-8")


def write_version(version: str) -> None:
    VERSION_FILE.write_text(version, encoding="utf-8")
    _replace_once(PYPROJECT, r'^(version\s*=\s*)"[^"]*"', rf'\g<1>"{version}"')
    # The project's own entry; editing it avoids `uv lock` re-resolving deps.
    _replace_once(UV_LOCK, r'^(name = "omoide"\nversion = )"[^"]*"', rf'\g<1>"{version}"')


# --- Main ---------------------------------------------------------------------


def confirm(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    try:
        return input(f"{question} [y/N] ").strip().lower() in ("y", "yes")
    except EOFError:
        return False


def commits_since_last_tag() -> list[str]:
    try:
        last = git("describe", "--tags", "--abbrev=0", "HEAD")
        log = git("log", "--no-merges", "--format=%s", f"{last}..HEAD")
    except subprocess.CalledProcessError:
        log = git("log", "--no-merges", "--format=%s")
    return [line for line in log.splitlines() if line.strip()]


def release(target: str, dry_run: bool, assume_yes: bool) -> None:
    current = current_version()
    # A previous run tagged the release but `make push` failed (e.g. Docker
    # was not running): publishing is what is left, not a new version.
    if target == "auto" and tag_exists(current):
        pushed = git("ls-remote", "--tags", "origin", f"refs/tags/v{current}")
        if not pushed:
            sys.exit(
                f"v{current} is tagged but not pushed yet. Run `make push` to "
                "publish it, or pass V=patch|minor|major for a new release."
            )
    version = next_version(current, target)
    if tag_exists(version):
        sys.exit(f"v{version} is already tagged.")

    tracked = {p.relative_to(ROOT).as_posix() for p in RELEASE_FILES}
    dirty = [
        line[3:].strip('"')
        for line in git("status", "--porcelain").splitlines()
        if line[3:].strip('"') not in tracked
    ]
    if dirty:
        sys.exit(
            "Commit or stash these changes first; a release commit should only "
            "contain the version and changelog:\n  " + "\n  ".join(dirty)
        )

    notes = unreleased_notes()
    if not notes:
        commits = commits_since_last_tag()
        if not commits:
            sys.exit('CHANGELOG.md has no "Unreleased" entries and there are no new commits.')
        print('CHANGELOG.md has no "Unreleased" entries. Commits since the last tag:')
        print("\n".join(f"  - {c}" for c in commits))
        if not confirm("Use these commit messages as the release notes?", assume_yes):
            sys.exit('Add entries under "## [Unreleased]" in CHANGELOG.md and run again.')
        notes = "### Changed\n\n" + "\n".join(f"- {c}" for c in commits)

    print(f"\nRelease v{version} (currently {current}), branch {git('branch', '--show-current')}")
    print("Release notes:\n")
    print(notes)
    print()
    if dry_run:
        print("Dry run: nothing changed.")
        return
    if not confirm(f"Commit and tag v{version}?", assume_yes):
        sys.exit("Aborted.")

    write_version(version)
    roll_changelog(version, notes)
    git("add", *(p.relative_to(ROOT).as_posix() for p in RELEASE_FILES))
    git("commit", "-m", f"Release v{version}")
    # verbatim: git would otherwise drop the "### Added" lines as comments.
    git("tag", "-a", "--cleanup=verbatim", f"v{version}", "-m", f"Release v{version}\n\n{notes}")
    print(f"Committed and tagged v{version}. `make push` builds and publishes it.")


def main() -> None:
    # Notes are UTF-8; Windows consoles and pipes default to a legacy code page.
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("target", nargs="?", default="auto")
    parser.add_argument("version", nargs="?", help="with `notes`: the version")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", "-y", action="store_true")
    args = parser.parse_args()

    if args.target == "notes":
        if not args.version:
            parser.error("notes needs a version")
        version = args.version.removeprefix("v")
        notes = section_notes(version)
        print(notes or f"Release v{version}")
        return
    release(args.target, args.dry_run, args.yes)


if __name__ == "__main__":
    main()
