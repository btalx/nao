"""`nao notes` — scaffold human-authored notes that enrich a table's synced docs."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from cyclopts import Parameter
from rich.console import Console

from nao_core.commands.sync.cleanup import get_database_folder_names
from nao_core.commands.sync.providers.databases.notes import manual_notes_path
from nao_core.config import NaoConfig, resolve_project_path
from nao_core.tracking import track_command

console = Console()

_STARTER_TEMPLATE = """# {table}

<!--
  Manual notes for `{schema}.{table}` on the `{connection}` connection.
  Folded into how_to_use.md the next time `nao sync` runs. This file lives
  outside `databases/`, so sync never overwrites or deletes it — edit it
  whenever, whether or not `databases/` exists locally yet.
-->
"""


@track_command("notes")
def notes(
    connection: str,
    schema: str,
    table: str,
    *,
    force: Annotated[bool, Parameter(name=["-f", "--force"])] = False,
) -> Path:
    """Scaffold a manual notes file for a table and print its path.

    Creates `notes/type=<type>/database=<name>/schema=<schema>/<table>.md` for the
    given connection, deriving the path from `nao_config.yaml` alone — no database
    connection or prior `nao sync` run is required. This is the safe place to add
    business context for a table: sync never overwrites or deletes it, and the next
    `nao sync` (local or in CI) folds its content into that table's `how_to_use.md`.

    Parameters
    ----------
    connection : str
        Name of the database connection, as configured in `nao_config.yaml`.
    schema : str
        Schema (or dataset) the table belongs to.
    table : str
        Table name.
    force : bool
        Overwrite an existing file with a fresh starter template.
    """
    config = NaoConfig.try_load(resolve_project_path(), exit_on_error=True)
    assert config is not None  # Help type checker after exit_on_error=True

    matches = [db for db in config.databases if db.name == connection]
    if not matches:
        available = ", ".join(db.name for db in config.databases) or "none configured"
        console.print(f"[red]Error:[/red] No connection named '{connection}' found. Available: {available}")
        raise SystemExit(1)
    db_config = matches[0]

    db_folder = get_database_folder_names([db_config])[0]
    path = manual_notes_path(resolve_project_path(), db_config.type, db_folder, schema, table)

    if path.exists() and not force:
        console.print(f"[dim]Notes already exist:[/dim] {path}")
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_STARTER_TEMPLATE.format(table=table, schema=schema, connection=connection))
    console.print(f"[bold green]✓[/bold green] Created [cyan]{path}[/cyan]")
    console.print("[dim]Edit it, then run `nao sync` to fold it into how_to_use.md.[/dim]")
    return path
