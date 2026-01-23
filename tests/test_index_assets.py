from pathlib import Path


def test_site_assets_present():
    root = Path('.')
    assert (root / 'index.html').exists(), "index.html missing"
    assert (root / 'script.js').exists(), "script.js missing"
    assert (root / 'style.css').exists(), "style.css missing"
