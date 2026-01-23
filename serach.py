import pandas as pd
import json
import re
import glob
import os

def get_natural_size(code):
    code = str(code).strip().upper()
    t_mapping = {
        "T14": "14–16", "T15": "18", "T16": "20–21", "T17": "24–25",
        "T18": "28–32", "T19": "40–45", "T20": "48–56", "T21": "57–63",
        "T22": "80–84", "T23": "90–105", "T24": "106–120", "T25": "126–130",
        "T26": "150–168", "T27": "180–210", "T28": "250–273", "T29": "300–336",
        "T30": "364–400", "T31": "480–504"
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
    medprice_file = "MEDPrice.xlsx"

    pv_files = glob.glob(os.path.join(pv_folder, "*.xlsx"))
    pv_files.sort(key=os.path.basename, reverse=True)

    if not pv_files:
        print("❌ FEL: Inga PV-filer hittades i mappen 'data/'.")
        return

    # Kartor för att hålla reda på data
    vnr_to_groupid = {}  # Varunummer -> Utbytesgrupps ID
    group_metadata = {}  # Utbytesgrupps ID -> {sub, form, size_code}

    print(f"--- ANALYSERAR {len(pv_files)} PV-FILER ---")

    for file in pv_files:
        fname = os.path.basename(file)
        try:
            df = pd.read_excel(file)
            # Kolumnnamn i PV-filerna
            # Varunummer, Substans, Beredningsform, Förpackningsstorleksgrupp, Utbytesgrupps ID
            
            for _, row in df.iterrows():
                vnr = str(row['Varunummer']).strip()
                gid = str(row['Utbytesgrupps ID']).strip()
                
                # Koppla varunummer till grupp-ID
                vnr_to_groupid[vnr] = gid
                
                # Spara metadata för gruppen (om vi inte redan har den från en nyare fil)
                if gid not in group_metadata:
                    group_metadata[gid] = {
                        'sub': str(row['Substans']).strip(),
                        'form': str(row['Beredningsform']).strip(),
                        'size_code': str(row['Förpackningsstorleksgrupp']).strip()
                    }
        except Exception as e:
            print(f"❌ FEL vid läsning av {fname}: {e}")

    # 2. Läs MEDPrice
    print(f"\n--- LÄSER MEDPRICE: {medprice_file} ---")
    try:
        df_med = pd.read_excel(medprice_file)
        # I MEDPrice heter det 'Varunummer' (enligt din snippet)
        
        # Samla info per Utbytesgrupp
        final_groups = {} # GroupID -> {names: set, vnr: set, str: str}

        for _, row in df_med.iterrows():
            vnr = str(row['Varunummer']).strip()
            
            # Kolla om vi vet vilken grupp detta varunummer tillhör (via PV-filerna)
            if vnr in vnr_to_groupid:
                gid = vnr_to_groupid[vnr]
                
                if gid not in final_groups:
                    final_groups[gid] = {
                        'names': set(),
                        'vnr': set(),
                        'str': str(row['Styrka']).strip()
                    }
                
                final_groups[gid]['names'].add(str(row['Produktnamn']).strip())
                final_groups[gid]['vnr'].add(vnr)
            
    except Exception as e:
        print(f"❌ FEL vid bearbetning av MEDPrice: {e}")
        return

    # 3. Bygg JSON
    print("\n--- GENERERAR SEARCH-INDEX.JSON ---")
    search_index = []
    for gid, data in final_groups.items():
        meta = group_metadata.get(gid)
        if meta:
            search_index.append({
                "id": gid,
                "sub": meta['sub'],
                "form": meta['form'],
                "str": data['str'],
                "size": get_natural_size(meta['size_code']),
                "names": sorted(list(data['names'])),
                "vnr": sorted(list(data['vnr']))
            })

    with open('search-index.json', 'w', encoding='utf-8') as f:
        json.dump(search_index, f, ensure_ascii=False, indent=2)

    print(f"✅ KLART! Skapade {len(search_index)} grupper.")

if __name__ == "__main__":
    create_global_search_index()
