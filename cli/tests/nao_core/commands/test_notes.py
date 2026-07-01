"""Unit tests for the `nao notes` command."""

from pathlib import Path

import pytest

from nao_core.commands.notes import notes


@pytest.fixture
def duckdb_config(tmp_path, monkeypatch):
    """Write a minimal nao_config.yaml with one DuckDB connection and chdir into it."""
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text(
        "project_name: test-project\ndatabases:\n  - type: duckdb\n    name: my-duckdb\n    path: ':memory:'\n"
    )
    monkeypatch.chdir(tmp_path)
    return tmp_path


class TestNotesCommand:
    def test_creates_notes_file_at_expected_path(self, duckdb_config: Path):
        path = notes("my-duckdb", "main", "orders")

        expected = duckdb_config / "notes" / "type=duckdb" / "database=memory" / "schema=main" / "orders.md"
        assert path == expected
        assert path.is_file()
        assert "orders" in path.read_text()

    def test_does_not_overwrite_existing_file_without_force(self, duckdb_config: Path):
        path = notes("my-duckdb", "main", "orders")
        path.write_text("my hand-written note")

        result = notes("my-duckdb", "main", "orders")

        assert result == path
        assert path.read_text() == "my hand-written note"

    def test_force_overwrites_existing_file(self, duckdb_config: Path):
        path = notes("my-duckdb", "main", "orders")
        path.write_text("my hand-written note")

        notes("my-duckdb", "main", "orders", force=True)

        assert path.read_text() != "my hand-written note"

    def test_unknown_connection_exits_with_error(self, duckdb_config: Path):
        with pytest.raises(SystemExit):
            notes("no-such-connection", "main", "orders")

    def test_works_without_any_database_connection(self, duckdb_config: Path):
        """Path is derived purely from config — no live warehouse connection needed."""
        path = notes("my-duckdb", "analytics", "orders")

        assert path.exists()
