"""Guinea pig rig v3 (Blender, headless):  blender -b -P rig_pig3.py -- raw.glb out.glb
v3 adds three jiggle bones driven by springs in the game: belly (under the body), pack (the backpack) and bib (the chest fur).
Full-detail Meshy mesh (no decimation), 28 cm long, feet on the ground.
Skeleton: root > hips > spine > chest > neck > head > nose
          head > earL1 > earL2 (and R)            two-bone ears so they flop and never tear off the head
          chest > fUpL > fLoL > fPawL (and R)     front legs with an elbow/knee
          hips > hThL > hShL > hFtL (and R)       hind legs: thigh, shin, foot
Weights: distance-to-bone falloff inside region masks, then smoothed over the mesh.
Textures: 2K base colour + normal exported beside the GLB as JPEG; the GLB itself carries none."""
import bpy, bmesh, sys, math
from mathutils import Vector
from mathutils.geometry import intersect_point_line
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[-2:]
IN, OUT = argv[0], argv[1]
DEC = float(argv[2]) if len(argv) > 2 else 1.0; TEX = int(argv[3]) if len(argv) > 3 else 2048; PREFIX = argv[4] if len(argv) > 4 else 'guineapig2-'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008); bm.to_mesh(me); bm.free()
if DEC < 1:
    md0 = ob.modifiers.new('dec', 'DECIMATE'); md0.decimate_type = 'COLLAPSE'; md0.ratio = DEC; md0.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
s = 0.28 / (max(ys) - min(ys)); cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
for v in me.vertices: v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - z0) * s))
me.update()
print('verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

arm = bpy.data.armatures.new('PigRig'); rig = bpy.data.objects.new('PigRig', arm); bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
B = {}
def bone(n, h, t, p=None, deform=True):
    b = arm.edit_bones.new(n); b.head = Vector(h); b.tail = Vector(t); b.use_deform = deform
    if p: b.parent = arm.edit_bones[p]; b.use_connect = False
    B[n] = (Vector(h), Vector(t)); return b
# front is -Y (becomes +Z in glTF/three), x>0 is his left
bone('root', (0, 0, 0), (0, 0, .02), deform=False)
bone('hips', (0, .11, .09), (0, .05, .11), 'root')
bone('spine', (0, .05, .11), (0, -.005, .125), 'hips')
bone('chest', (0, -.005, .125), (0, -.045, .14), 'spine')
bone('neck', (0, -.045, .14), (0, -.07, .165), 'chest')
bone('head', (0, -.07, .165), (0, -.115, .18), 'neck')
bone('nose', (0, -.115, .176), (0, -.142, .18), 'head')
for S, k in (('L', 1), ('R', -1)):
    bone('ear' + S + '1', (k * .050, -.05, .212), (k * .068, -.05, .207), 'head')
    bone('ear' + S + '2', (k * .068, -.05, .207), (k * .090, -.05, .192), 'ear' + S + '1')
    bone('fUp' + S, (k * .030, -.045, .100), (k * .032, -.058, .050), 'chest')
    bone('fLo' + S, (k * .032, -.058, .050), (k * .032, -.062, .012), 'fUp' + S)
    bone('fPaw' + S, (k * .032, -.062, .012), (k * .032, -.082, .004), 'fLo' + S)
    bone('hTh' + S, (k * .045, .070, .090), (k * .047, .045, .035), 'hips')
    bone('hSh' + S, (k * .047, .045, .035), (k * .047, .095, .010), 'hTh' + S)
    bone('hFt' + S, (k * .047, .095, .010), (k * .047, .030, .004), 'hSh' + S)
# jiggle bones (secondary motion; the game moves them on springs)
bone('belly', (0, .045, .070), (0, .045, .035), 'spine')
bone('pack', (0, .055, .115), (0, .055, .180), 'spine')
bone('bib', (0, -.070, .140), (0, -.090, .090), 'chest')
bpy.ops.object.mode_set(mode='OBJECT')

BODY = ['hips', 'spine', 'chest', 'neck', 'head']
def seg_d(p, n):
    a, b = B[n]; t = intersect_point_line(p, a, b)[1]; t = max(0.0, min(1.0, t)); return (p - (a + (b - a) * t)).length
def region(p):
    x, y, z = p; S = 'L' if x >= 0 else 'R'; ax = abs(x)
    if ax > .050 and z > .186 and -.078 < y < -.022:              # ears
        return {'ear' + S + '1': 1, 'ear' + S + '2': 1, 'head': .35}
    if z < .075 and y < -.018 and ax < .062:                      # front legs
        return {'fUp' + S: 1, 'fLo' + S: 1, 'fPaw' + S: 1, 'chest': .5, 'spine': .25}
    if z < .06 and y > -.012:                                     # hind legs and haunch bottom
        return {'hTh' + S: 1, 'hSh' + S: 1, 'hFt' + S: 1, 'hips': .6, 'spine': .3}
    r = {n: 1 for n in BODY}
    if y < -.112: r['nose'] = 1.4
    if z < .10 and y > .01 and ax > .02: r['hTh' + S] = .3                  # haunches follow the thighs a little
    if z < .085 and -.085 < y < -.03 and ax > .015: r['fUp' + S] = .15           # shoulders follow the upper front legs
    return r
W = []
for v in me.vertices:
    p = v.co.copy(); r = region(p)
    w = {n: f / (seg_d(p, n) ** 2 + 1e-5) ** 2 for n, f in r.items()}
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]; tot = sum(val for _, val in top)
    W.append({n: val / tot for n, val in top if val / tot > .02})
# smooth weights over mesh neighbours (keeps the fur bending, not tearing)
nb = [[] for _ in me.vertices]
for e in me.edges: a, b = e.vertices; nb[a].append(b); nb[b].append(a)
for it in range(3):
    NW = []
    for i, w in enumerate(W):
        acc = dict(w); cnt = 1
        for j in nb[i]:
            for n, val in W[j].items(): acc[n] = acc.get(n, 0) + val
            cnt += 1
        tot = sum(acc.values()); top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]; t2 = sum(v for _, v in top)
        NW.append({n: val / t2 for n, val in top if val / t2 > .02})
    W = NW
# ---- jiggle weights: made from position and texture colour, smoothed, then blended over the body weights ----
import colorsys
img = [n.image for n in me.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and not any(k in n.image.name.lower() for k in ('normal', 'metal', 'rough'))][0]
IW, IH = img.size; PX = list(img.pixels[:]); uvl = me.uv_layers.active.data
col = [[0, 0, 0, 0] for _ in me.vertices]
for l in me.loops:
    u, v = uvl[l.index].uv; i = (min(IH - 1, int(v % 1 * IH)) * IW + min(IW - 1, int(u % 1 * IW))) * 4
    c = col[l.vertex_index]; c[0] += PX[i]; c[1] += PX[i + 1]; c[2] += PX[i + 2]; c[3] += 1
cl = lambda a: max(0.0, min(1.0, a))
J = []
for vi, v in enumerate(me.vertices):
    x, y, z = v.co; ax = abs(x); c = col[vi]; n = max(1, c[3])
    h, sat, val = colorsys.rgb_to_hsv(cl(c[0] / n), cl(c[1] / n), cl(c[2] / n))
    dark = val < .42 and sat < .55                                     # the leather pack and straps (the fur is orange or white)
    pk = 1.0 if dark and ((y > -.01 and z > .085) or (ax > .05 and y > -.005 and z > .07)) else 0.0
    bl = cl((.062 - z) / .035) * cl((.068 - ax) / .02) * cl((y + .025) / .02) * cl((.115 - y) / .03)
    bb = .75 * cl((-.05 - y) / .025) * cl((z - .07) / .02) * cl((.15 - z) / .02) * cl((.05 - ax) / .015)
    J.append({'pack': pk, 'belly': .8 * bl, 'bib': bb})
for it in range(3):
    NJ = []
    for i, w in enumerate(J):
        acc = dict(w); cnt = 1
        for j in nb[i]:
            for k2, val in J[j].items(): acc[k2] += val
            cnt += 1
        NJ.append({k2: val / cnt for k2, val in acc.items()})
    J = NJ
for i in range(len(W)):
    jw = {k2: val for k2, val in J[i].items() if val > .02}; tot = sum(jw.values())
    if tot <= 0: continue
    if tot > 1: jw = {k2: val / tot for k2, val in jw.items()}; tot = 1
    m = {n: val * (1 - tot) for n, val in W[i].items()}; m.update(jw)
    top = sorted(m.items(), key=lambda kv: -kv[1])[:4]; t2 = sum(val for _, val in top)
    W[i] = {n: val / t2 for n, val in top if val / t2 > .02}
print('jiggle verts', sum(1 for j in J if j['pack'] > .5), 'pack,', sum(1 for j in J if j['belly'] > .2), 'belly,', sum(1 for j in J if j['bib'] > .2), 'bib')
G = {}
for i, w in enumerate(W):
    t = sum(w.values())
    for n, val in w.items():
        if n not in G: G[n] = ob.vertex_groups.new(name=n)
        G[n].add([i], val / t, 'REPLACE')
ob.parent = rig; md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = rig
# textures: export 2K base + normal as JPEG beside the GLB, strip images from the material
import os
mat = me.materials[0]; nt = mat.node_tree; bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
outdir = os.path.dirname(os.path.abspath(OUT))
for n in list(nt.nodes):
    if n.type == 'TEX_IMAGE':
        img = n.image; nm = img.name.lower()
        kind = 'normal' if 'normal' in nm else ('metal' if ('metal' in nm or 'rough' in nm) else 'skin')
        if kind != 'metal':
            if max(img.size) > TEX: img.scale(TEX, TEX)
            img.filepath_raw = os.path.join(outdir, PREFIX + kind + '.jpg'); img.file_format = 'JPEG'
            bpy.context.scene.render.image_settings.quality = 88; img.save_render(img.filepath_raw)
            print('saved', kind, img.size[:])
        nt.nodes.remove(n)
bsdf.inputs['Metallic'].default_value = 0.0; bsdf.inputs['Roughness'].default_value = 0.88
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
