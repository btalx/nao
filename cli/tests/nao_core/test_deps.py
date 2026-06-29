import pytest

from nao_core.deps import (
    MissingDependencyError,
    MissingSystemLibraryError,
    require_database_backend,
    require_dependency,
)


def test_require_database_backend_uses_public_extra_for_shared_ibis_backend(monkeypatch):
    def raise_missing_backend(module_name: str):
        assert module_name == "ibis.backends.postgres"
        raise ModuleNotFoundError(module_name)

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_missing_backend)

    with pytest.raises(MissingDependencyError) as exc_info:
        require_database_backend("postgres", extra="redshift", database_type="redshift")

    message = str(exc_info.value)
    assert "to connect to redshift databases" in message
    assert "pip install 'nao-core[redshift]'" in message
    assert "uv pip install 'nao-core[redshift]'" in message


def test_require_database_backend_reports_missing_system_library(monkeypatch):
    def raise_missing_shared_lib(module_name: str):
        assert module_name == "ibis.backends.mysql"
        raise ImportError("libmariadb.so.3: cannot open shared object file: No such file or directory")

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_missing_shared_lib)

    with pytest.raises(MissingSystemLibraryError) as exc_info:
        require_database_backend("mysql")

    message = str(exc_info.value)
    assert "libmariadb.so.3" in message
    assert "system" in message
    assert "libmariadb3" in message
    assert "pip install 'nao-core[mysql]'" not in message


def test_require_database_backend_does_not_mask_unrelated_import_errors(monkeypatch):
    def raise_unrelated(module_name: str):
        raise ImportError("some unrelated import failure")

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_unrelated)

    with pytest.raises(ImportError) as exc_info:
        require_database_backend("mysql")

    assert not isinstance(exc_info.value, (MissingDependencyError, MissingSystemLibraryError))


def test_require_dependency_reports_missing_system_library(monkeypatch):
    def raise_missing_shared_lib(module_name: str):
        raise ImportError("libfoo.so.1: cannot open shared object file: No such file or directory")

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_missing_shared_lib)

    with pytest.raises(MissingSystemLibraryError) as exc_info:
        require_dependency("some_package", "some-extra")

    message = str(exc_info.value)
    assert "libfoo.so.1" in message
    assert "system" in message


def test_require_dependency_reports_missing_python_package(monkeypatch):
    def raise_missing_module(module_name: str):
        raise ModuleNotFoundError(f"No module named '{module_name}'")

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_missing_module)

    with pytest.raises(MissingDependencyError) as exc_info:
        require_dependency("some_package", "some-extra", "for testing")

    message = str(exc_info.value)
    assert "pip install 'nao-core[some-extra]'" in message
