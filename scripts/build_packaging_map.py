#!/usr/bin/env python3
"""
Build a packaging map from MEDPrice.xlsx to use in the frontend
Maps VNR (Varunummer) to Förpackning (packaging type)
"""

import pandas as pd
import json
from pathlib import Path

def build_packaging_map():
    """Extract packaging data from MEDPrice.xlsx"""
    medprice_file = Path("data/MEDPrice.xlsx")
    
    if not medprice_file.exists():
        print(f"❌ MEDPrice.xlsx not found at {medprice_file.absolute()}")
        return {}
    
    try:
        df = pd.read_excel(medprice_file)
        
        # Create mapping from Varunummer to Förpackning
        packaging_map = {}
        
        for _, row in df.iterrows():
            vnr = row.get('Varunummer')
            forpackning = row.get('Förpackning')
            
            if pd.notna(vnr) and pd.notna(forpackning):
                # Convert VNR to string and strip whitespace
                vnr_str = str(int(vnr)) if isinstance(vnr, (int, float)) else str(vnr).strip()
                forpackning_str = str(forpackning).strip()
                
                # Only add if we have a valid packaging description
                if forpackning_str and forpackning_str.lower() != 'nan':
                    packaging_map[vnr_str] = forpackning_str
        
        print(f"✅ Built packaging map with {len(packaging_map)} entries")
        
        # Save to JSON
        output_file = Path("data/packaging-map.json")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(packaging_map, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Saved to {output_file}")
        return packaging_map
        
    except Exception as e:
        print(f"❌ Error building packaging map: {e}")
        return {}

if __name__ == "__main__":
    build_packaging_map()
