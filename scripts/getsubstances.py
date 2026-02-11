import json
import glob
import os

def clean_size(val):
    """Säkerställer att storleken blir '100' istället för '100.0'"""
    try:
        f_val = float(val)
        return str(int(f_val)) if f_val.is_integer() else str(f_val)
    except:
        return str(val)

def build_substances():
    substance_tree = {}
    available_months = []
    data_folder = 'data'

    # 1. Hitta alla JSON-filer i data-mappen
    # Vi använder os.path.join för att det ska fungera på både Windows och Linux
    file_paths = glob.glob(os.path.join(data_folder, "*.json"))

    for file_path in file_paths:
        file_name = os.path.basename(file_path)
        
        # Hoppa över systemfiler
        if file_name == "substances.json" or file_name == "months.json":
            continue
        
        # Extrahera månads-koden (t.ex. "2601")
        month_code = os.path.splitext(file_name)[0]
        if month_code.isdigit():
            available_months.append(month_code)

        print(f"Bearbetar data från: {month_code}")

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            for item in data:
                sub = item.get('Substans')
                form = item.get('Beredningsform')
                strn = item.get('Styrka')
                # Storleken kan vara både sträng och nummer i källan, vi normaliserar den
                size = clean_size(item.get('Storlek'))

                if not all([sub, form, strn]):
                    continue

                # Bygg upp trädet: Substans -> Form -> Styrka -> [Storlekar]
                if sub not in substance_tree: 
                    substance_tree[sub] = {}
                if form not in substance_tree[sub]: 
                    substance_tree[sub][form] = {}
                if strn not in substance_tree[sub][form]: 
                    substance_tree[sub][form][strn] = set() # Set hindrar dubbletter
                
                substance_tree[sub][form][strn].add(size)
        
        except Exception as e:
            print(f"❌ Kunde inte läsa {file_name}: {e}")

    # 2. Sortering och Formatering
    # Sortera månader så att nyast (t.ex. 2601) kommer först
    available_months.sort(reverse=True)

    # Konvertera Sets till sorterade Listor (viktigt för JSON-export)
    for sub in substance_tree:
        for form in substance_tree[sub]:
            for strn in substance_tree[sub][form]:
                # Sorterar storlekarna numeriskt (t.ex. 28 före 100)
                substance_tree[sub][form][strn] = sorted(list(substance_tree[sub][form][strn]), key=float)

    # 3. Skapa den slutgiltiga JSON-strukturen
    # Det är detta format som script.js förväntar sig!
    final_output = {
        "months": available_months,
        "tree": substance_tree
    }

    # Spara substances.json i data-mappen
    output_path = os.path.join(data_folder, 'substances.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(final_output, f, ensure_ascii=False, indent=4)

    print(f"\n✅ KLAR!")
    print(f"Hittade {len(available_months)} månader: {', '.join(available_months)}")
    print(f"Sparade data till: {output_path}")

if __name__ == "__main__":
    build_substances()