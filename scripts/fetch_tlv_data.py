#!/usr/bin/env python3
"""
Script to automatically fetch the latest XLSX files from TLV website
and save them with proper month codes (e.g., 2601 for January 2026, 2602 for February 2026)
"""

import requests
from bs4 import BeautifulSoup
import os
import re
from datetime import datetime
from pathlib import Path

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
    # Look for Swedish month names
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
        print(f"✅ Downloaded: {os.path.basename(filename)} ({file_size:.1f} MB)")
        return True
    
    except requests.RequestException as e:
        print(f"❌ Error downloading {url}: {e}")
        return False

def main():
    print("🔍 Fetching TLV website for latest XLSX files...")
    
    # Create tmp folder if it doesn't exist
    tmp_folder = Path("tmp")
    tmp_folder.mkdir(exist_ok=True)
    print(f"📁 Created/verified tmp folder: {tmp_folder.absolute()}")
    
    # Get download links
    links = get_download_links()
    if not links:
        print("❌ No files found")
        return
    
    print(f"\n📥 Found {len(links)} file(s):\n")
    
    # Download and rename files
    for link in links:
        text = link['text']
        url = link['url']
        
        # Extract month code
        month_code, month_name, year = extract_month_code(text)
        
        if not month_code:
            print(f"⚠️  Skipping: {text} (could not parse month/year)")
            continue
        
        # Create new filename
        new_filename = f"{month_code}.xlsx"
        filepath = tmp_folder / new_filename
        
        print(f"   {text}")
        print(f"   → Saving as: {new_filename}")
        print(f"   → URL: {url}\n")
        
        # Download file
        download_file(url, filepath)
    
    print(f"\n✨ Done! Files saved to: {tmp_folder.absolute()}")

if __name__ == "__main__":
    main()
