"""
Blender headless: assemble a closed building from a Poly Haven facade kit.
  blender -b --factory-startup -P building.py -- <kit.gltf> <out.glb> <nx> <ny> <floors> <style> <seed>
style: 'apt' (urban apartments) or 'factory'.
Footprint nx × ny modules of 3 m, `floors` storeys of 3 m. Window storeys are
picked at random per floor; the front ground floor gets a door. Corner piers,
a belt cornice and a crown finish it; a lit-rooms box sits behind the glass.
"""
import bpy, bmesh, sys, random, math
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index('--') + 1:]
kit, dst, NX, NY, FL, style, seed = a[0], a[1], int(a[2]), int(a[3]), int(a[4]), a[5], int(a[6])
rnd = random.Random(seed)
M = 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=kit)
scene = bpy.context.scene
src = {o.name: o for o in scene.objects if o.type == 'MESH'}

def bbox(o):
    w = o.matrix_world
    pts = [w @ Vector(c) for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])

def world_mesh(o):
    """Copy of o's mesh in world space, lightly reduced."""
    me = o.data.copy()
    me.transform(o.matrix_world)
    return me

def reduce(me, planar):
    bm = bmesh.new(); bm.from_mesh(me)
    if planar:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts, edges=bm.edges,
                                 delimit={'UV', 'MATERIAL'})
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return me

# --- module library: a wall piece plus the frames that sit in its cell ---
def module(wall_name):
    w = src[wall_name]
    lo, hi = bbox(w)
    parts = [w]
    for n, o in src.items():
        if o is w or n.startswith(('wall_', 'dado_', 'base_', 'cornice', 'crown')):
            continue
        l2, h2 = bbox(o)
        if lo.x - 0.05 <= l2.x and h2.x <= hi.x + 0.05 and lo.z - 0.05 <= l2.z and h2.z <= hi.z + 0.3 and abs(l2.y) < 1:
            parts.append(o)
    off = Matrix.Translation(Vector((-lo.x, 0, -lo.z)))
    meshes = []
    for o in parts:
        me = world_mesh(o)
        me.transform(off)
        reduce(me, o is w)
        meshes.append(me)
    return meshes

def strip(name):
    o = src[name]
    lo, _ = bbox(o)
    me = world_mesh(o)
    me.transform(Matrix.Translation(Vector((-lo.x, 0, -lo.z))))
    return [reduce(me, False)]

def corner(name):
    """Corner pieces: centred on their own x/y so they sit over the corner."""
    o = src[name]
    lo, hi = bbox(o)
    me = world_mesh(o)
    me.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    return [reduce(me, False)]

names = set(src)
if style == 'apt':
    windows = [n for n in ['wall_window_centered_large_01', 'wall_window_centered_large_02', 'wall_window_centered_double_01',
                           'wall_window_centered_double_02', 'wall_window_centered_small_01', 'wall_window_centered_small_02'] if n in names]
    doors = ['wall_door_centered_large_01']
    plain = 'wall_standard_standard_01'
    crown_n, cornice_n = 'crown_standard_standard_01', 'cornice_standard_standard_01'
    pier_n, pier_crown_n = 'wall_pier_corner_01', 'crown_pier_corner_01'
else:
    windows = [n for n in ['wall_window_tall_large_01', 'wall_window_tall_large_02', 'wall_window_tall_large_03',
                           'wall_window_centered_large_01', 'wall_window_centered_medium_01', 'wall_window_centered_double_01'] if n in names]
    doors = ['wall_door_centered_large_01', 'wall_door_recessed_large_01']
    plain = 'wall_standard_standard_01'
    crown_n, cornice_n = 'crown_standard_standard_01', 'cornice01_standard_standard_01'
    pier_n = next((n for n in names if n.startswith('wall_pier_corner')), None)
    pier_crown_n = next((n for n in names if n.startswith('crown_pier_corner')), None)

lib = {}
def get(kind, name):
    key = (kind, name)
    if key not in lib:
        lib[key] = module(name) if kind == 'm' else strip(name) if kind == 's' else corner(name)
    return lib[key]

out = bmesh.new()
uvl = out.loops.layers.uv.verify()
mats = []  # material order in the output

def put(meshes, mat):
    for me in meshes:
        tmp = me.copy()
        tmp.transform(mat)
        # remap material indices into the output's list
        idx = []
        for m in tmp.materials:
            if m not in mats:
                mats.append(m)
            idx.append(mats.index(m))
        for p in tmp.polygons:
            p.material_index = idx[p.material_index] if idx else 0
        out.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

W, D, H = NX * M, NY * M, FL * M
# faces: (origin, yaw, modules). yaw turns the -y outward side to face out.
faces = [
    (Vector((0, 0, 0)), 0, NX),
    (Vector((W, 0, 0)), math.pi / 2, NY),
    (Vector((W, D, 0)), math.pi, NX),
    (Vector((0, D, 0)), -math.pi / 2, NY),
]
plan = [[rnd.choice(windows) for _ in range(max(NX, NY))] for _ in range(FL)]
for fi, (o, yaw, n) in enumerate(faces):
    R = Matrix.Rotation(yaw, 4, 'Z')
    for f in range(FL):
        for i in range(n):
            if f == 0:
                name = rnd.choice(doors) if fi == 0 and i == n // 2 else (plain if style == 'factory' and i % 2 else plan[0][i])
            else:
                name = plan[f][i]  # the same window per column on every face reads as designed
            if name not in names:
                name = plain
            T = Matrix.Translation(o + R @ Vector((i * M, 0, f * M)))
            put(get('m', name), T @ R)
        # belt cornice above the ground floor and crown on top
        for i in range(n):
            T = Matrix.Translation(o + R @ Vector((i * M, 0, 0)))
            if cornice_n in names:
                put(get('s', cornice_n), Matrix.Translation(Vector((0, 0, M - 0.1))) @ T @ R)
            if crown_n in names:
                put(get('s', crown_n), Matrix.Translation(Vector((0, 0, H))) @ T @ R)
# corner piers
for c in [Vector((0, 0, 0)), Vector((W, 0, 0)), Vector((W, D, 0)), Vector((0, D, 0))]:
    if pier_n:
        for f in range(FL):
            put(get('c', pier_n), Matrix.Translation(c + Vector((0, 0, f * M))))
    if pier_crown_n:
        put(get('c', pier_crown_n), Matrix.Translation(c + Vector((0, 0, H))))

# --- lit rooms behind the glass, and a roof ---
rooms = bpy.data.images.new('rooms', 256, 256)
px = [0.0] * (256 * 256 * 4)
cells = 8
for cy in range(cells):
    for cx in range(cells):
        r = rnd.random()
        if r < 0.45:
            col = (0.03, 0.03, 0.04)
        elif r < 0.8:
            col = (1.0, 0.72, 0.42)
        else:
            col = (0.6, 0.78, 1.0)
        k = 0.35 + rnd.random() * 0.65 if r >= 0.45 else 1
        for y in range(cy * 32, cy * 32 + 32):
            for x in range(cx * 32, cx * 32 + 32):
                # darker ceiling band and frame edge so it reads as a room
                e = 0.55 if (y - cy * 32) > 24 or (x - cx * 32) < 2 or (x - cx * 32) > 29 else 1.0
                i4 = (y * 256 + x) * 4
                px[i4:i4 + 4] = [col[0] * k * e, col[1] * k * e, col[2] * k * e, 1]
rooms.pixels = px
rooms.pack()
rm = bpy.data.materials.new('MI_FakeInterior_rooms')
rm.use_nodes = True
bsdf = rm.node_tree.nodes['Principled BSDF']
tex = rm.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = rooms; tex.interpolation = 'Closest'
rm.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 1
mats.append(rm)
ri = len(mats) - 1
roof_mat = next((m for m in mats if 'plaster' in m.name or 'concrete' in m.name or 'brick' in m.name), mats[0])
fi_roof = mats.index(roof_mat)

inset = 0.35
x0, y0, x1, y1 = inset, inset, W - inset, D - inset
def quad(ps, uvs, mi):
    vs = [out.verts.new(p) for p in ps]
    f = out.faces.new(vs)
    f.material_index = mi
    for l, uv in zip(f.loops, uvs):
        l[uvl].uv = uv
# four inner walls, facing out, one room cell per 3 m × 3 m
sides = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
for si, (p, q) in enumerate(sides):
    L = math.hypot(q[0] - p[0], q[1] - p[1])
    u0 = si * 0.37
    quad([Vector((p[0], p[1], 0)), Vector((q[0], q[1], 0)), Vector((q[0], q[1], H)), Vector((p[0], p[1], H))],
         [(u0, 0), (u0 + L / M / cells, 0), (u0 + L / M / cells, FL / cells), (u0, FL / cells)], ri)
quad([Vector((0, 0, H - 0.05)), Vector((W, 0, H - 0.05)), Vector((W, D, H - 0.05)), Vector((0, D, H - 0.05))],
     [(0, 0), (W / M, 0), (W / M, D / M), (0, D / M)], fi_roof)

me = bpy.data.meshes.new('building')
out.to_mesh(me); out.free()
for m in mats:
    me.materials.append(m)
ob = bpy.data.objects.new('building', me)
for o in list(scene.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene.collection.objects.link(ob)
# centre on the footprint
for v in me.vertices:
    v.co.x -= W / 2; v.co.y -= D / 2
me.update()

target = int(a[7]) if len(a) > 7 else 20000
tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > target:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    d = ob.modifiers.new('d', 'DECIMATE')
    d.ratio = target / tris
    d.use_collapse_triangulate = True
    d.delimit = {'UV', 'MATERIAL'} if hasattr(d, 'delimit') else set()
    bpy.ops.object.modifier_apply(modifier='d')

for img in bpy.data.images:
    if img.name != 'rooms' and (img.size[0] > 512 or img.size[1] > 512):
        img.scale(512, 512)

tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f'[bld] {dst}: {W:.0f}x{D:.0f}x{H:.0f} m, {tris} tris, {len(mats)} materials')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='WEBP', export_yup=True,
                          export_apply=True, export_animations=False, export_cameras=False, export_lights=False)
import os
print(f'[bld] wrote {os.path.getsize(dst)/1e6:.2f} MB')
