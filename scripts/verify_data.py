import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any

MANDATORY_KEYS = [
    "Status",
    "Produktnamn",
    "Varunummer",
    "Styrka",
    "Substans",
    "Beredningsform",
    "Storlek",
    "Försäljningspris",
]
ALLOWED_STATUS = {"PV", "Nej", "R1", "R2"}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_item(item: Dict[str, Any]) -> List[str]:
    missing = [k for k in MANDATORY_KEYS if k not in item]
    if "Status" in item and item["Status"] not in ALLOWED_STATUS:
        missing.append("Status(valid)")
    if "Försäljningspris" in item and not isinstance(item["Försäljningspris"], (int, float)):
        missing.append("Försäljningspris(number)")
    return missing


def validate_file(path: Path, limit: int | None) -> Dict[str, Any]:
    data = load_json(path)
    result: Dict[str, Any] = {
        "file": path.name,
        "ok": True,
        "count": 0,
        "errors": [],
    }

    if not isinstance(data, list):
        result["ok"] = False
        result["errors"].append("Top-level JSON is not a list")
        return result

    n = len(data)
    result["count"] = n
    to_check = data if limit is None else data[: min(limit, n)]

    for idx, item in enumerate(to_check):
        if not isinstance(item, dict):
            result["ok"] = False
            result["errors"].append(f"Item {idx} is not an object")
            continue
        missing = validate_item(item)
        if missing:
            result["ok"] = False
            result["errors"].append(f"Item {idx} missing/invalid: {', '.join(missing)}")

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify TLV data JSON files in ./data")
    parser.add_argument("--data-dir", default="data", help="Directory containing YYMM.json files")
    parser.add_argument("--limit", type=int, default=200, help="Max items to validate per file (set 0 for all)")
    parser.add_argument("--verbose", action="store_true", help="Print per-file details")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"ERROR: data directory not found: {data_dir}")
        return 2

    files = sorted([p for p in data_dir.glob("*.json") if p.stem.isdigit() and len(p.stem) == 4])
    if not files:
        print("ERROR: no YYMM.json files found in data directory")
        return 2

    limit = None if args.limit == 0 else args.limit
    total_items = 0
    bad_files = 0
    for p in files:
        try:
            res = validate_file(p, limit)
        except Exception as e:
            print(f"[FAIL] {p.name}: exception while reading - {e}")
            bad_files += 1
            continue

        total_items += res["count"]
        if res["ok"]:
            if args.verbose:
                print(f"[OK]   {p.name}: {res['count']} items")
        else:
            bad_files += 1
            print(f"[FAIL] {p.name}: {res['count']} items; issues:")
            for err in res["errors"][:5]:
                print(f"       - {err}")
            if len(res["errors"]) > 5:
                print(f"       (+ {len(res['errors']) - 5} more)")

    print(f"\nSummary: {len(files)} files, {total_items} total items, {bad_files} files with issues")
    return 0 if bad_files == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
