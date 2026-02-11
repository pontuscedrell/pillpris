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
    pv_files = [
        f for f in glob.glob(os.path.join(pv_folder, "*.xlsx"))
        if not os.path.basename(f).startswith("~$")
    ]
    pv_files.sort(key=os.path.basename, reverse=True)

    vnr_to_group_data = {}
    group_metadata = {}

    print(f"--- ANALYSERAR {len(pv_files)} PV-FILER ---")

    for file in pv_files:
        fname = os.path.basename(file)
        if "2403" in fname: continue # Vi skippar denna helt enligt önskemål
        
        try:
            df = pd.read_excel(file)
            df = df.rename(columns={'Utbytesgrupp': 'Utbytesgrupps ID', 'Beredning': 'Beredningsform'})
            
            for _, row in df.iterrows():
                # Säker hantering av ID och VNR
                try:
                    raw_vnr = str(row['Varunummer']).strip()
                    if not raw_vnr or raw_vnr == 'nan': continue
                    vnr = str(int(float(raw_vnr)))
                    
                    raw_gid = str(row['Utbytesgrupps ID']).strip()
                    if not raw_gid or raw_gid == 'nan': continue
                    gid = str(int(float(raw_gid)))
                    
                    size_code = str(row['Förpackningsstorleksgrupp']).strip()
                    vnr_to_group_data[vnr] = {'gid': gid, 'size_code': size_code}
                    
                    key = (gid, size_code)
                    if key not in group_metadata:
                        group_metadata[key] = {
                            'sub': str(row['Substans']).strip(),
                            'form': str(row['Beredningsform']).strip()
                        }
                except: continue
        except Exception as e:
            print(f"⚠️ Hoppar över {fname} pga fel.")

    # 2. Läs MEDPrice
    print(f"\n--- LÄSER MEDPRICE: {medprice_file} ---")
    try:
        df_med = pd.read_excel(medprice_file)
        final_data = {} 

        for _, row in df_med.iterrows():
            try:
                # FIX: Hantera tomma strängar och skräp-tecken i Varunummer
                raw_vnr_field = str(row['Varunummer']).strip()
                if not raw_vnr_field or raw_vnr_field == 'nan' or not any(c.isdigit() for c in raw_vnr_field):
                    continue
                
                vnr = str(int(float(raw_vnr_field)))
                
                if vnr in vnr_to_group_data:
                    mapping = vnr_to_group_data[vnr]
                    key = (mapping['gid'], mapping['size_code'])
                    
                    if key not in final_data:
                        final_data[key] = {
                            'names': set(),
                            'vnr': set(),
                            'str': str(row['Styrka']).strip(),
                            'packaging': set(),
                            'packaging_by_vnr': {}
                        }

                    final_data[key]['names'].add(str(row['Produktnamn']).strip())
                    final_data[key]['vnr'].add(vnr)

                    packaging_type = extract_packaging_type(row.get('Förpackning'))
                    if packaging_type:
                        final_data[key]['packaging'].add(packaging_type)
                        final_data[key]['packaging_by_vnr'][vnr] = packaging_type
            except:
                continue # Hoppa över rader som inte går att tolka (t.ex. tomma rader längst ner)
            
    except Exception as e:
        print(f"❌ KRITISKT FEL i MEDPrice: {e}")
        return

    # 3. Bygg JSON
    print("\n--- GENERERAR SEARCH-INDEX.JSON ---")
    search_index = []
    for (gid, size_code), data in final_data.items():
        meta = group_metadata.get((gid, size_code))
        if meta:
            search_index.append({
                "id": gid,
                "size_id": size_code,
                "sub": meta['sub'],
                "form": meta['form'],
                "str": data['str'],
                "size": get_natural_size(size_code),
                "names": sorted(list(data['names'])),
                "vnr": sorted(list(data['vnr'])),
                "packaging": sorted(list(data['packaging'])) if data.get('packaging') else [],
                "packagingMap": data.get('packaging_by_vnr', {})
            })

    search_index.sort(key=lambda x: x['sub'])
    with open('search-index.json', 'w', encoding='utf-8') as f:
        json.dump(search_index, f, ensure_ascii=False, indent=2)

# --- NY DEL: Skapa months.json automatiskt ---
    # Extrahera siffrorna från filnamnen (t.ex. '2512' från '2512.xlsx' eller '2512.json')
    month_codes = set()
    for f in pv_files:
        name = os.path.basename(f).replace('.xlsx', '')
        if name.isdigit():
            month_codes.add(int(name))

    json_files = glob.glob(os.path.join(pv_folder, "*.json"))
    for f in json_files:
        name = os.path.basename(f).replace('.json', '')
        if name.isdigit():
            month_codes.add(int(name))

    month_codes = sorted(month_codes, reverse=True) # Nyast först
    
    with open('months.json', 'w', encoding='utf-8') as f:
        json.dump(month_codes, f)
    print(f"✅ Skapade months.json med {len(month_codes)} månader.")

    print(f"✅ KLART! Skapade {len(search_index)} unika sökbara entiteter.")

if __name__ == "__main__":
    create_global_search_index()
