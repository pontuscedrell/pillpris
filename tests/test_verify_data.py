import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from verify_data import validate_file


def test_data_files_exist():
    data_dir = Path("data")
    assert data_dir.exists(), "data/ directory is missing"
    files = sorted([p for p in data_dir.glob("*.json") if p.stem.isdigit() and len(p.stem) == 4])
    assert len(files) > 0, "No YYMM.json files found in data/"


def test_data_files_are_valid():
    data_dir = Path("data")
    files = [p for p in data_dir.glob("*.json") if p.stem.isdigit() and len(p.stem) == 4]
    files = sorted(files, key=lambda p: int(p.stem), reverse=True)
    recent = files[:5]
    assert len(recent) > 0, "No recent YYMM.json files found in data/"
    for p in recent:
        res = validate_file(p, limit=200)
        assert res["ok"], f"{p.name} has validation issues: {res['errors'][:5]}"
