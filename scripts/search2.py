import pandas as pd
import json
import re
import glob
import os

def extract_packaging_type(val):
    """Return the text before the first comma from Förpackning, or None if empty."""
    if val is None:
        return None
    txt = str(val).strip()
    if not txt or txt.lower() == 'nan':
        return None
    return txt.split(',')[0].strip() or None

def get_natural_size(code):
    code = str(code).strip().upper()
    t_mapping = {
        "T14": "ca 14", 
        "T15": "18", 
        "T16": "ca 20", 
        "T17": "ca 25",
        "T18": "ca 30",
        "T19": "ca 43",
        "T20": "ca 52",
        "T21": "ca 60",
        "T22": "ca 82",
        "T23": "ca 90",
        "T24": "ca 113",
        "T25": "ca 128",
        "T26": "ca 159",
        "T27": "ca 195",
        "T28": "ca 261",
        "T29": "ca 318",
        "T30": "ca 382",
        "T31": "ca 492"
    }
    if code in t_mapping: return f"{t_mapping[code]} st"
    t_match = re.match(r"^T(\d+)$", code)
    if t_match:
        num = int(t_match.group(1))
        if 1 <= num <= 13: return f"{num} st"
    clean_val = code.replace('D', '.')
    if any(p in code for p in ['TT', 'TN']):
        val = re.sub(r"[^\d.]", "", clean_val)
        return f"{val} st"
    if any(p in code for p in ['M', 'MN']):
        val = re.sub(r"[^\d.]", "", clean_val)
        return f"{val} ml"
    if any(p in code for p in ['G', 'GN']):
        val = re.sub(r"[^\d.]", "", clean_val)
        return f"{val} g"
    return code

def create_global_search_index():
    pv_folder = "data"
    
    print(f"--- BUILDING SEARCH INDEX FROM LATEST MONTH DATA ---")

    # 3. Bygg JSON ENDAST från senaste månadens data
    print("\n--- GENERERAR SEARCH-INDEX.JSON ---")
    
    # Hitta senaste månadens JSON-fil
    json_files = sorted(glob.glob(os.path.join(pv_folder, "*.json")))
    json_files = [f for f in json_files if 'search-index' not in f and os.path.basename(f)[0:4].isdigit()]
    
    if not json_files:
        print("❌ Ingen månadsfil funnen!")
        return
    
    latest_month_file = json_files[-1]
    print(f"Använder senaste månad: {os.path.basename(latest_month_file)}")
    
    try:
        with open(latest_month_file, 'r', encoding='utf-8') as f:
            latest_data = json.load(f)
    except Exception as e:
        print(f"❌ Kunde inte läsa {latest_month_file}: {e}")
        return
    
    # Bygg search-index ENDAST från vad som finns i senaste månaden
    search_index = []
    entries_added = 0
    
    # Gruppera data efter ID och storlek
    grouped = {}
    for item in latest_data:
        try:
            gid = str(int(float(item.get('Utbytesgrupps ID', 0))))
            size_code = str(item.get('Förpackningsstorleksgrupp', '')).strip()
            sub = str(item.get('Substans', '')).strip()
            form = str(item.get('Beredningsform', '')).strip()
            strength = str(item.get('Styrka', '')).strip()
            prod_name = str(item.get('Produktnamn', '')).strip()
            vnr = str(item.get('Varunummer', '')).strip()
            packaging = str(item.get('Förpackning', '')).strip()
            
            # Endast inkludera om vi har både ID och storlek
            if not gid or not size_code or size_code.upper() == 'NONE' or size_code.upper() == 'NAN':
                continue
            
            key = (gid, size_code)
            if key not in grouped:
                grouped[key] = {
                    'sub': sub,
                    'form': form,
                    'str': strength,
                    'names': set(),
                    'vnr': set(),
                    'packaging': set(),
                    'packaging_by_vnr': {}
                }
            
            if prod_name:
                grouped[key]['names'].add(prod_name)
            if vnr:
                grouped[key]['vnr'].add(vnr)
            
            # Extract packaging type (text before first comma)
            if packaging and packaging.lower() != 'nan':
                pkg_type = packaging.split(',')[0].strip()
                if pkg_type:
                    grouped[key]['packaging'].add(pkg_type)
                    if vnr:
                        grouped[key]['packaging_by_vnr'][vnr] = pkg_type
        except:
            continue
    
    # Konvertera till lista
    for (gid, size_code), data in grouped.items():
        search_index.append({
            "id": gid,
            "size_id": size_code,
            "sub": data['sub'],
            "form": data['form'],
            "str": data['str'],
            "size": get_natural_size(size_code),
            "names": sorted(list(data['names'])),
            "vnr": sorted(list(data['vnr'])),
            "packaging": sorted(list(data['packaging'])),
            "packagingMap": data.get('packaging_by_vnr', {})
        })
        entries_added += 1
    
    search_index.sort(key=lambda x: x['sub'])
    with open(os.path.join(pv_folder, 'search-index.json'), 'w', encoding='utf-8') as f:
        json.dump(search_index, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Skapade search-index med {entries_added} unika läkemedelskombinationer")


# --- NY DEL: Skapa months.json automatiskt ---
    # Extrahera siffrorna från filnamnen (t.ex. '2512' från '2512.xlsx' eller '2512.json')
    month_codes = set()
    
    xlsx_files = glob.glob(os.path.join(pv_folder, "*.xlsx"))
    for f in xlsx_files:
        name = os.path.basename(f).replace('.xlsx', '')
        if name.isdigit():
            month_codes.add(int(name))

    json_files = glob.glob(os.path.join(pv_folder, "*.json"))
    for f in json_files:
        name = os.path.basename(f).replace('.json', '')
        if name.isdigit():
            month_codes.add(int(name))

    month_codes = sorted(month_codes, reverse=True) # Nyast först
    
    with open(os.path.join(pv_folder, 'months.json'), 'w', encoding='utf-8') as f:
        json.dump(month_codes, f)
    print(f"✅ Skapade months.json med {len(month_codes)} månader.")

    print(f"✅ KLART! Skapade {len(search_index)} unika sökbara entiteter.")

if __name__ == "__main__":
    create_global_search_index()
