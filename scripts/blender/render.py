import bpy,sys,math
from mathutils import Vector
a=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
sc=bpy.context.scene
lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
for o in sc.objects:
    if o.type!='MESH': continue
    for c in o.bound_box:
        p=o.matrix_world@Vector(c)
        for i in range(3): lo[i]=min(lo[i],p[i]); hi[i]=max(hi[i],p[i])
ctr=(lo+hi)/2; r=(hi-lo).length/2
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
d=Vector((math.cos(-0.9),math.sin(-0.9),0.45)).normalized()
cam.location=ctr+d*r*2.6; cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.lens=40
sun=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); sun.data.energy=4; sun.rotation_euler=(0.8,0.3,0.6); sc.collection.objects.link(sun)
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs['Color'].default_value=(0.45,0.55,0.7,1); w.node_tree.nodes['Background'].inputs['Strength'].default_value=0.8
sc.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x=640; sc.render.resolution_y=480
sc.render.filepath=a[1]
bpy.ops.render.render(write_still=True)
print('[r] ok',a[1])
