#!/usr/bin/env python3
"""
Master script to fetch TLV XLSX files and convert them to JSON
This script:
1. Downloads latest XLSX files from TLV website to tmp/
2. Converts XLSX to JSON and saves to data/
3. Cleans up tmp folder
"""

import requests
from bs4 import BeautifulSoup
import os
import re
from pathlib import Path
import pandas as pd
import shutil
from datetime import datetime
import unicodedata

# TLV website URL
TLV_URL = "https://www.tlv.se/apotek/generiskt-utbyte/periodens-varor.html"
BASE_DOWNLOAD_URL = "https://www.tlv.se"

# Months in Swedish to month number mapping
MONTHS_SE = {
    "januari": "01",
    "februari": "02",
    "mars": "03",
    "april": "04",
    "maj": "05",
    "juni": "06",
    "juli": "07",
    "augusti": "08",
    "september": "09",
    "oktober": "10",
    "november": "11",
    "december": "12"
}

def get_download_links():
    """Fetch and parse the TLV website to get download links"""
    try:
        response = requests.get(TLV_URL, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the ul with class "sv-defaultlist"
        ul = soup.find('ul', class_='sv-defaultlist')
        if not ul:
            print("❌ Could not find download list on TLV website")
            return []
        
        # Extract all links
        links = []
        for li in ul.find_all('li'):
            a = li.find('a')
            if a and a.get('href') and '.xlsx' in a.get('href'):
                text = a.get_text()
                href = a.get('href')
                links.append({
                    'text': text,
                    'url': href if href.startswith('http') else BASE_DOWNLOAD_URL + href
                })
        
        return links
    
    except requests.RequestException as e:
        print(f"❌ Error fetching TLV website: {e}")
        return []

def extract_month_code(text):
    """Extract month name and year from text like 'Periodens varor januari 2026'"""
    for month_name, month_num in MONTHS_SE.items():
        if month_name in text.lower():
            # Extract year (4 digits)
            year_match = re.search(r'20\d{2}', text)
            if year_match:
                year = year_match.group()
                year_short = year[-2:]  # Get last 2 digits (26 from 2026)
                month_code = year_short + month_num  # e.g., "2601" for January 2026
                return month_code, month_name.capitalize(), year
    
    return None, None, None

def download_file(url, filename):
    """Download file from URL and save it"""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        file_size = os.path.getsize(filename) / 1024 / 1024  # Size in MB
        print(f"   ✅ Downloaded: {os.path.basename(filename)} ({file_size:.1f} MB)")
        return True
    
    except requests.RequestException as e:
        print(f"   ❌ Error downloading: {e}")
        return False

def convert_xlsx_to_json(xlsx_path, json_path):
    """Convert XLSX file to JSON"""
    try:
        df = pd.read_excel(xlsx_path, engine='openpyxl')

        def _norm_col(name: str) -> str:
            txt = str(name).strip().lower()
            txt = unicodedata.normalize("NFKD", txt)
            txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
            return "".join(ch for ch in txt if ch.isalnum())

        normalized_map = {
            "produktnamn": "Produktnamn",
            "varunummer": "Varunummer",
            "styrka": "Styrka",
            "forpackningsstorleksgrupp": "Förpackningsstorleksgrupp",
            "substans": "Substans",
            "beredningsform": "Beredningsform",
            "storlek": "Storlek",
            "apotekensinkopspris": "Apotekens inköpspris",
            "forsaljningspris": "Försäljningspris",
            "inkopsprisperminstaenhet": "Inköpspris per minsta enhet",
            "forsaljningsprisperminstaenhet": "Försäljningspris per minsta enhet",
            "nplid": "NPL ID",
            "nplpackid": "NPL pack ID",
            "ursprung": "Ursprung",
            "foretag": "Företag",
            "utbytesgruppsid": "Utbytesgrupps ID",
            "marknadsfors": "Marknadsförs",
            "rang": "Rang",
            "status": "Status",
            "forpackning": "Förpackning",
        }

        rename_cols = {}
        for col in df.columns:
            norm = _norm_col(col)
            if norm in normalized_map:
                rename_cols[col] = normalized_map[norm]
        if rename_cols:
            df = df.rename(columns=rename_cols)

        if "Status" not in df.columns and "Rang" in df.columns:
            def _rank_to_status(val):
                try:
                    rank = int(float(val))
                except Exception:
                    return ""
                if rank == 1:
                    return "PV"
                if rank == 2:
                    return "R1"
                if rank == 3:
                    return "R2"
                return ""

            df["Status"] = df["Rang"].apply(_rank_to_status)
        df.to_json(json_path, orient='records', indent=4, force_ascii=False)
        
        file_size = os.path.getsize(json_path) / 1024  # Size in KB
        print(f"   ✅ Converted: {os.path.basename(xlsx_path)} → {os.path.basename(json_path)} ({file_size:.0f} KB)")
        return True
    
    except Exception as e:
        print(f"   ❌ Error converting {os.path.basename(xlsx_path)}: {e}")
        return False

def main():
    print("=" * 60)
    print("🚀 TLV Data Pipeline: Download XLSX → Convert to JSON")
    print("=" * 60)
    
    # Create folders
    tmp_folder = Path("tmp")
    data_folder = Path("data")
    tmp_folder.mkdir(exist_ok=True)
    data_folder.mkdir(exist_ok=True)
    
    print(f"\n📁 Working directories:")
    print(f"   Download folder: {tmp_folder.absolute()}")
    print(f"   Output folder: {data_folder.absolute()}")
    
    # Step 1: Fetch files
    print(f"\n{'─' * 60}")
    print("📥 STEP 1: Downloading XLSX files from TLV...")
    print(f"{'─' * 60}")
    
    links = get_download_links()
    if not links:
        print("❌ No files found on TLV website")
        return
    
    downloaded_files = []
    
    for link in links:
        text = link['text']
        url = link['url']
        
        # Extract month code
        month_code, month_name, year = extract_month_code(text)
        
        if not month_code:
            print(f"⚠️  Skipping: {text} (could not parse month/year)")
            continue
        
        # Create filename
        filename = f"{month_code}.xlsx"
        filepath = tmp_folder / filename
        
        print(f"\n   {month_name} {year} ({filename})")
        
        # Download file
        if download_file(url, filepath):
            data_xlsx_path = data_folder / filename
            use_path = filepath
            try:
                shutil.copy2(filepath, data_xlsx_path)
                use_path = data_xlsx_path
            except Exception as e:
                print(f"   ⚠️  Could not copy to data/: {e}")
            downloaded_files.append((use_path, month_code))
    
    if not downloaded_files:
        print("\n❌ No files were downloaded")
        return
    
    # Step 2: Convert to JSON
    print(f"\n{'─' * 60}")
    print("🔄 STEP 2: Converting XLSX to JSON...")
    print(f"{'─' * 60}\n")
    
    converted_count = 0
    
    for xlsx_path, month_code in downloaded_files:
        json_path = data_folder / f"{month_code}.json"
        
        if convert_xlsx_to_json(xlsx_path, json_path):
            converted_count += 1
    
    # Step 3: Cleanup
    print(f"\n{'─' * 60}")
    print("🧹 STEP 3: Cleaning up temporary files...")
    print(f"{'─' * 60}\n")
    
    # Remove tmp folder
    if tmp_folder.exists():
        shutil.rmtree(tmp_folder)
        print(f"   ✅ Removed tmp folder")
    
    # Summary
    print(f"\n{'=' * 60}")
    print("✨ Pipeline Complete!")
    print(f"{'=' * 60}")
    print(f"📊 Summary:")
    print(f"   Downloaded: {len(downloaded_files)} file(s)")
    print(f"   Converted: {converted_count} file(s)")
    print(f"   Output folder: {data_folder.absolute()}")
    print(f"\n✅ All done!")

if __name__ == "__main__":
    main()
