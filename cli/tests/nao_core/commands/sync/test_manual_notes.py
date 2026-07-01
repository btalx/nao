"""Tests for the manual table-notes convention (`notes/` folder + `nao notes`)."""

from pathlib import Path

import duckdb
import pytest
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.notes import manual_notes_path, read_manual_notes
from nao_core.commands.sync.providers.databases.provider import DatabaseSyncProvider, sync_database
from nao_core.config.databases.duckdb import DuckDBConfig


@pytest.fixture(autouse=True)
def reset_template_engine():
    """Templates are cached globally, so isolate each test's project_path."""
    import nao_core.templates.engine as engine_module

    engine_module._engine = None
    yield
    engine_module._engine = None


@pytest.fixture
def duckdb_project(tmp_path: Path) -> tuple[Path, DuckDBConfig]:
    """A tmp project directory with a DuckDB database containing one `orders` table."""
    db_path = tmp_path / "test.duckdb"
    conn = duckdb.connect(str(db_path))
    conn.execute("CREATE TABLE orders (id INTEGER NOT NULL, amount DOUBLE NOT NULL)")
    conn.execute("INSERT INTO orders VALUES (1, 10.0), (2, 20.0)")
    conn.close()

    config = DuckDBConfig(name="test-db", path=str(db_path))
    return tmp_path, config


class TestManualNotesPath:
    def test_manual_notes_path_mirrors_databases_layout(self, tmp_path: Path):
        path = manual_notes_path(tmp_path, "duckdb", "database=jaffle_shop", "main", "orders")

        assert path == tmp_path / "notes" / "type=duckdb" / "database=jaffle_shop" / "schema=main" / "orders.md"

    def test_read_manual_notes_returns_none_when_missing(self, tmp_path: Path):
        assert read_manual_notes(tmp_path / "notes" / "does-not-exist.md") is None

    def test_read_manual_notes_returns_none_for_empty_file(self, tmp_path: Path):
        path = tmp_path / "empty.md"
        path.write_text("   \n")

        assert read_manual_notes(path) is None

    def test_read_manual_notes_returns_stripped_content(self, tmp_path: Path):
        path = tmp_path / "note.md"
        path.write_text("\n  Only ever query with a partition filter.  \n")

        assert read_manual_notes(path) == "Only ever query with a partition filter."


class TestManualNotesFoldedIntoHowToUse:
    def _how_to_use_content(self, project_path: Path, config: DuckDBConfig) -> str:
        output = project_path / "databases"
        with Progress(transient=True) as progress:
            sync_database(config, output, progress, project_path=project_path)

        table_dir = (
            output / f"type={config.type}" / f"database={config.get_database_name()}" / "schema=main" / "table=orders"
        )
        return (table_dir / "how_to_use.md").read_text()

    def test_no_notes_file_means_no_notes_section(self, duckdb_project):
        project_path, config = duckdb_project

        content = self._how_to_use_content(project_path, config)

        assert "## Notes" not in content

    def test_manual_notes_are_included_in_how_to_use(self, duckdb_project):
        project_path, config = duckdb_project

        note_path = manual_notes_path(
            project_path, "duckdb", f"database={config.get_database_name()}", "main", "orders"
        )
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("Only ever query this table with a status filter applied.")

        content = self._how_to_use_content(project_path, config)

        assert "## Notes" in content
        assert "Only ever query this table with a status filter applied." in content

    def test_notes_survive_stale_table_cleanup(self, duckdb_project):
        """A note must not be deleted even if its table is later excluded from sync."""
        project_path, config = duckdb_project
        db_folder = f"database={config.get_database_name()}"
        note_path = manual_notes_path(project_path, "duckdb", db_folder, "main", "orders")
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("Keep me around even if the table is excluded later.")

        provider = DatabaseSyncProvider()
        output = project_path / "databases"

        provider.sync([config], output, project_path=project_path)
        assert (output / "type=duckdb" / db_folder / "schema=main" / "table=orders").is_dir()

        excluded_config = config.model_copy(update={"exclude": ["main.orders"]})
        provider.sync([excluded_config], output, project_path=project_path)

        assert not (output / "type=duckdb" / db_folder / "schema=main" / "table=orders").exists()
        assert note_path.is_file()
        assert note_path.read_text() == "Keep me around even if the table is excluded later."

    def test_notes_available_before_table_is_ever_synced(self, duckdb_project):
        """Notes can be written even when `databases/` doesn't exist yet (e.g. sync-only-in-CI)."""
        project_path, config = duckdb_project
        db_folder = f"database={config.get_database_name()}"

        assert not (project_path / "databases").exists()

        note_path = manual_notes_path(project_path, "duckdb", db_folder, "main", "orders")
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("Written before this table has ever been synced.")

        content = self._how_to_use_content(project_path, config)

        assert "Written before this table has ever been synced." in content
