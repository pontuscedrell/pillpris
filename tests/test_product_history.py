import json
from pathlib import Path


def test_product_history_file_present():
    path = Path("data/product-history.json")
    assert path.exists(), "data/product-history.json is missing"


def test_product_history_basic_shape():
    path = Path("data/product-history.json")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    assert isinstance(data, dict), "product-history.json must be a JSON object"
    assert isinstance(data.get("months"), list) and data["months"], "months list missing or empty"
    assert isinstance(data.get("groups"), list) and data["groups"], "groups list missing or empty"

    first_group = data["groups"][0]
    assert "id" in first_group and "size_id" in first_group and "brands" in first_group, "group schema is incomplete"
    assert isinstance(first_group["brands"], list) and first_group["brands"], "brands list missing or empty"

    first_brand = first_group["brands"][0]
    assert "packaging" in first_brand, "brand packaging field is missing"
    assert isinstance(first_brand["packaging"], str), "brand packaging must be a string"