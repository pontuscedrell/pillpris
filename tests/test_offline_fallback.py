from pathlib import Path


def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _assert_has_offline_fallback(js: str) -> None:
    assert "navigator.onLine === false" in js
    assert "cache: isOffline ? 'force-cache' : 'no-store'" in js
    assert "if (bustedUrl === path) throw error;" in js
    assert "fetch(path, { cache: 'force-cache' })" in js


def test_main_script_uses_offline_cache_fallback():
    js = _read("script.js")
    _assert_has_offline_fallback(js)


def test_statistics_script_uses_offline_cache_fallback():
    js = _read("statistics.js")
    _assert_has_offline_fallback(js)
