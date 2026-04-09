#!/usr/bin/env python3
"""Build an aggregated product history JSON from monthly TLV files.

The output groups rows by exchange group + package size, and stores one brand
entry per VNR with month-by-month status and price history. This lets the UI
load once and switch months locally without fetching each month file.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_packaging_map import build_packaging_map


DATA_DIR = Path("data")
OUTPUT_FILE = DATA_DIR / "product-history.json"


def normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def clean_size(value: Any) -> str:
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else str(number)
    except Exception:
        return str(value).strip()


def to_number(value: Any) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = value.replace(" ", "").replace(",", ".")
            if cleaned == "":
                return None
            return float(cleaned)
        return float(value)
    except Exception:
        return None


def parse_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(float(str(value).replace(",", ".")))
    except Exception:
        return None


def get_status(item: dict[str, Any]) -> str:
    raw_status = normalize_text(item.get("Status"))
    if raw_status:
        return raw_status.upper() if raw_status.upper() in {"PV", "R1", "R2", "NEJ"} else raw_status

    rank = parse_int(item.get("Rang"))
    if rank == 1:
        return "PV"
    if rank == 2:
        return "R1"
    if rank == 3:
        return "R2"
    return ""


def natural_month_sort(month_code: str) -> int:
    try:
        return int(month_code)
    except Exception:
        return 0


def build_product_history() -> dict[str, Any]:
    # Build packaging map in-memory from MEDPrice to avoid a separate JSON artifact.
    packaging_map = build_packaging_map(output_file=None)

    month_files = sorted(
        [p for p in DATA_DIR.glob("*.json") if p.stem.isdigit() and len(p.stem) == 4],
        key=lambda p: int(p.stem),
        reverse=True,
    )

    groups: dict[str, dict[str, Any]] = {}
    months: list[int] = []

    for month_file in month_files:
        month_code = month_file.stem
        months.append(int(month_code))

        with month_file.open("r", encoding="utf-8") as handle:
            month_data = json.load(handle)

        if not isinstance(month_data, list):
            continue

        for item in month_data:
            if not isinstance(item, dict):
                continue

            group_id = parse_int(item.get("Utbytesgrupps ID"))
            size_id = normalize_text(item.get("Förpackningsstorleksgrupp")).upper()
            if group_id is None or not size_id or size_id in {"NONE", "NAN"}:
                continue

            key = f"{group_id}|{size_id}"
            group = groups.setdefault(
                key,
                {
                    "key": key,
                    "id": str(group_id),
                    "size_id": size_id,
                    "sub": "",
                    "str": "",
                    "form": "",
                    "size": "",
                    "brands": {},
                },
            )

            if not group["sub"]:
                group["sub"] = str(item.get("Substans", "")).strip()
            if not group["str"]:
                group["str"] = str(item.get("Styrka", "")).strip()
            if not group["form"]:
                group["form"] = str(item.get("Beredningsform", "")).strip()
            if not group["size"]:
                group["size"] = clean_size(item.get("Storlek"))

            vnr = parse_int(item.get("Varunummer") or item.get("Vnr"))
            if vnr is None:
                continue

            brand_key = str(vnr)
            brand = group["brands"].setdefault(
                brand_key,
                {
                    "vnr": brand_key,
                    "name": "",
                    "company": "",
                    "origin": "",
                    "packaging": "",
                    "history": {},
                },
            )

            if not brand["name"]:
                brand["name"] = str(item.get("Produktnamn", "")).strip()
            if not brand["company"]:
                brand["company"] = str(item.get("Företag", "")).strip()
            if not brand["origin"]:
                brand["origin"] = str(item.get("Ursprung", "")).strip()
            if not brand["packaging"]:
                packaging = str(item.get("Förpackning", "")).strip()
                if packaging and packaging.lower() != "nan":
                    brand["packaging"] = packaging.split(",")[0].strip()

            # Fill missing packaging from MEDPrice-derived map per VNR.
            if not brand["packaging"]:
                brand["packaging"] = str(packaging_map.get(brand_key, "")).strip()

            brand["history"][month_code] = {
                "status": get_status(item),
                "price": to_number(item.get("Försäljningspris")),
            }

    group_list: list[dict[str, Any]] = []
    for group in groups.values():
        brands = list(group["brands"].values())
        brands.sort(key=lambda b: (b["name"].lower(), b["vnr"]))

        # Sort history maps by month so the JSON stays deterministic.
        for brand in brands:
            history = brand.get("history", {})
            brand["history"] = {
                month: history[month]
                for month in sorted(history.keys(), key=natural_month_sort, reverse=True)
            }

        group_list.append(
            {
                "key": group["key"],
                "id": group["id"],
                "size_id": group["size_id"],
                "sub": group["sub"],
                "str": group["str"],
                "form": group["form"],
                "size": group["size"],
                "brands": brands,
            }
        )

    group_list.sort(key=lambda g: (normalize_text(g["sub"]), normalize_text(g["str"]), g["id"], g["size_id"]))

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "months": months,
        "groups": group_list,
    }


def main() -> int:
    if not DATA_DIR.exists():
        print(f"❌ Data directory not found: {DATA_DIR}")
        return 1

    history = build_product_history()
    with OUTPUT_FILE.open("w", encoding="utf-8") as handle:
        json.dump(history, handle, ensure_ascii=False, indent=2)

    print(f"✅ Wrote {OUTPUT_FILE} with {len(history['groups'])} groups and {len(history['months'])} months")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())