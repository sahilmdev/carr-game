"""Download Poly Haven 1k glTF models (CC0) into a raw folder given as argv[1]."""
import json, os, sys, subprocess

IDS = """fir_sapling_medium island_tree_01 island_tree_02
grass_medium_01 grass_medium_02 grass_bermuda_01 moss_01 celandine_01 dandelion_01 shrub_03
coast_rocks_01 coastal_cliff_02 sand_rocks_small_01 dutch_ship_large_01 modular_fort_01
namaqualand_boulder_03 namaqualand_rocks_01 searsia_lucida
modular_urban_apartments_facade modular_factory_facade modular_electricity_poles street_lamp_01""".split()

UA = 'kart-asset-fetch'
out = sys.argv[1]

def get(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    subprocess.run(['curl', '-sfL', '-A', UA, '-o', dest, url], check=True)

total = 0
for i in IDS:
    meta = json.loads(subprocess.run(['curl', '-sf', '-A', UA, f'https://api.polyhaven.com/files/{i}'],
                                     capture_output=True, check=True).stdout)
    g = meta['gltf']['1k']['gltf']
    base = os.path.join(out, i)
    get(g['url'], os.path.join(base, os.path.basename(g['url'])))
    total += g['size']
    for rel, f in g.get('include', {}).items():
        get(f['url'], os.path.join(base, rel))
        total += f['size']
    print(f'{i} ok', flush=True)
print(f'done {total/1e6:.1f} MB')
