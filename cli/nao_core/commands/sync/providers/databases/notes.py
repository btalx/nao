"""Human-authored notes that enrich a synced table without being overwritten by `nao sync`.

Notes live under `notes/`, mirroring the `databases/` layout (`type=<type>/database=<name>/
schema=<schema>/<table>.md`) but rooted outside of it. This keeps them out of reach of
sync's per-table overwrite and stale-path cleanup, and means the path can be constructed
purely from config (no live connection or prior sync needed) — so a note can be written
even when `nao sync` only ever runs in CI and the `databases/` tree never exists locally.
"""

from __future__ import annotations

from pathlib import Path

NOTES_ROOT = "notes"


def manual_notes_path(project_path: Path, db_type: str, db_folder: str, schema: str, table: str) -> Path:
    """Return the path where manual notes for a table are looked up.

    `db_folder` is the same `database=<name>` segment sync uses for this connection
    (see `get_database_folder_names`), so the note path always matches the table's
    location under `databases/` once it's synced.
    """
    return project_path / NOTES_ROOT / f"type={db_type}" / db_folder / f"schema={schema}" / f"{table}.md"


def read_manual_notes(path: Path) -> str | None:
    """Return the note's content, or None if it doesn't exist or can't be read as text."""
    if not path.is_file():
        return None
    try:
        content = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return content or None
