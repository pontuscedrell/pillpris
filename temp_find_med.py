import json

with open('data/2603.json') as f:
    data = json.load(f)

# Find medicine with VNR 138421 (Cylinderampull - ABASAGLAR)
med = next((item for item in data if str(item.get('Varunummer', '')) == '138421'), None)
if med:
    print('Found medicine with Cylinderampull:')
    print(f"Product: {med.get('Produktnamn')}")
    print(f"Substance: {med.get('Substans')}")
    print(f"Form: {med.get('Beredningsform')}")
    print(f"Strength: {med.get('Styrka')}")
    print(f"Size: {med.get('Storlek')}")
    print(f"Price: {med.get('Försäljningspris')} kr")
    print(f"VNR: {med.get('Varunummer')}")
else:
    print("Medicine not found in 2603.json")
