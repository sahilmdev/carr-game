"""
Blender headless: shrink one Poly Haven scan into a game-ready GLB.
  blender -b --factory-startup -P bake.py -- <in.gltf> <out.glb> <tri_budget> <tex_px> [keep]
`keep` is a substring of the object names to keep (one variant of a set, or
a few kit pieces separated by '|'); kept objects are centred on the origin.
Each mesh is split by material. Opaque parts are decimated (collapse, keeps
UVs); leaf/blade parts lose whole cards at random instead, and the cards
left are scaled up so the canopy keeps most of its coverage.
"""
import bpy, bmesh, sys, random, os
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
src, dst, budget, tex = a[0], a[1], int(a[2]), int(a[3])
keep_names = a[4].split('|') if len(a) > 4 and a[4] != 'all' else None
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

if keep_names:
    for o in list(scene.objects):
        if o.type == 'MESH' and not any(k in o.name for k in keep_names):
            bpy.data.objects.remove(o, do_unlink=True)

# bake transforms and split by material
for o in [o for o in scene.objects if o.type == 'MESH']:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(o.material_slots) > 1:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='MATERIAL')
        bpy.ops.object.mode_set(mode='OBJECT')
for o in [o for o in scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)

meshes = [o for o in scene.objects if o.type == 'MESH']

# centre the kept set on the origin (x/y in Blender), ground stays where it was
if keep_names:
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for v in o.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
    c = (lo + hi) / 2
    for o in meshes:
        for v in o.data.vertices:
            v.co.x -= c.x; v.co.y -= c.y
        o.data.update()

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

def islands_of(bm):
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(isl)
    return out

def is_alpha(o):
    m = o.material_slots[0].material if o.material_slots else None
    if not m:
        return False
    if getattr(m, 'surface_render_method', '') == 'BLENDED':
        return True
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED' and n.inputs['Alpha'].is_linked:
                return True
    return False

info = []
for o in meshes:
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    n_isl = len(islands_of(bm)) if is_alpha(o) else 0
    bm.free()
    info.append((o, tris(o), n_isl > 30))

total = sum(t for _, t, _ in info)
solid = sum(t for _, t, c in info if not c)
cards = total - solid
# opaque parts get up to 45% of the budget, cards the rest
solid_budget = min(solid, budget * (0.45 if cards else 1.0))
card_budget = budget - solid_budget
print(f'[bake] {os.path.basename(src)}: {len(meshes)} parts, {total} tris (cards {cards}) -> {budget}')

for o, t, card in info:
    if card:
        keep = min(1.0, card_budget / max(1, cards))
        if keep >= 0.999:
            continue
        grow = min(float(os.environ.get("GROW_CAP", "3")), keep ** -0.5)
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        drop = []
        for isl in islands_of(bm):
            if random.random() > keep:
                drop.extend(isl)
                continue
            verts = list({v for f in isl for v in f.verts})
            c = verts[0].co.copy()
            for v in verts[1:]:
                c += v.co
            c /= len(verts)
            for v in verts:
                v.co = c + (v.co - c) * grow
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        bm.to_mesh(o.data); bm.free()
    else:
        r = solid_budget / max(1, solid)
        if r < 0.999:
            m = o.modifiers.new('d', 'DECIMATE')
            m.ratio = max(0.002, r)
            m.use_collapse_triangulate = True
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='d')

for img in bpy.data.images:
    if img.size[0] > tex or img.size[1] > tex:
        k = tex / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))

after = sum(tris(o) for o in meshes)
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for v in o.data.vertices:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
print(f'[bake] result {after} tris, size {tuple(round(x, 1) for x in (hi - lo))}')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='WEBP',
                          export_yup=True, export_apply=True, export_animations=False,
                          export_extras=False, export_cameras=False, export_lights=False)
print(f'[bake] wrote {os.path.getsize(dst)/1e6:.2f} MB')
