import pandas as pd
import glob
import os

data_folder = 'data'

if not os.path.exists(data_folder):
    os.makedirs(data_folder)

# Hitta alla xlsx-filer
files = glob.glob(os.path.join(data_folder, "*.xlsx"))

for file in files:
    # Ignorera temporära filer som börjar med ~$ (skapas ofta av Excel)
    if os.path.basename(file).startswith("~$"):
        continue

    try:
        # Läs excel-filen - lade till engine='openpyxl' för stabilitet
        df = pd.read_excel(file, engine='openpyxl')
        
        # Generera JSON-namn
        output_path = os.path.splitext(file)[0] + ".json"
        
        # Spara JSON
        df.to_json(output_path, orient='records', indent=4, force_ascii=False)
        print(f"✅ Konverterade: {file} -> {output_path}")

    except Exception as e:
        print(f"❌ Kunde inte konvertera {file}. Fel: {e}")

print("\nKlar!")