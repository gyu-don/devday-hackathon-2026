# /// script
# requires-python = ">=3.11"
# ///
"""Run with blender --background --python scripts/build-room.py."""

import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/game/public/models/room.glb"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def material(name, color, roughness=0.78):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    result.node_tree.nodes.clear()
    shader = result.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    output = result.node_tree.nodes.new("ShaderNodeOutputMaterial")
    result.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return result


M = {
    "wood": material("Honey oak", (0.63, 0.41, 0.24)),
    "floor": material("Pale oak", (0.82, 0.65, 0.45)),
    "floor2": material("Pale oak light", (0.87, 0.71, 0.52)),
    "wall": material("Warm plaster", (0.91, 0.86, 0.74)),
    "sage": material("Sage linen", (0.48, 0.62, 0.43)),
    "cream": material("Ivory cotton", (0.96, 0.90, 0.76)),
    "peach": material("Apricot", (0.86, 0.47, 0.31)),
    "blue": material("Dusty blue", (0.37, 0.54, 0.62)),
    "yellow": material("Ochre", (0.88, 0.65, 0.28)),
    "paper": material("Paper", (0.96, 0.94, 0.86)),
    "dark": material("Espresso", (0.20, 0.22, 0.16)),
    "leaf": material("Plant leaf", (0.25, 0.43, 0.26)),
    "leaf2": material("Plant leaf light", (0.42, 0.59, 0.30)),
    "sky": material("Window sky", (0.63, 0.79, 0.77)),
    "rug": material("Woven sand", (0.84, 0.73, 0.57)),
    "metal": material("Satin aluminum", (0.63, 0.70, 0.69), 0.35),
}


def empty(name, position=(0, 0, 0), **extras):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = (position[0], -position[2], position[1])
    for key, value in extras.items():
        obj[key] = value
    return obj


def finish(obj, name, mat, parent, position):
    obj.name = name
    obj.data.materials.append(M[mat])
    obj.parent = parent
    obj.location = (position[0], -position[2], position[1])
    return obj


def box(name, position, size, mat, parent=None, bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat, parent, position)


def cylinder(name, position, radius, depth, mat, parent=None, top=None, hollow=False):
    bpy.ops.mesh.primitive_cone_add(
        vertices=32,
        radius1=radius,
        radius2=radius if top is None else top,
        depth=depth,
        end_fill_type="NOTHING" if hollow else "NGON",
    )
    obj = bpy.context.object
    modifier = obj.modifiers.new("Rounded rim", "BEVEL")
    modifier.width = 0.025
    modifier.segments = 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat, parent, position)


def sphere(name, position, size, mat, parent=None, ico=False):
    if ico:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    return finish(obj, name, mat, parent, position)


box("Room foundation", (0, -0.20, 0), (9.2, 0.38, 7.2), "wood", bevel=0.10)
for row in range(18):
    box(
        f"Floor plank {row}",
        (0, 0.018, -3.4 + row * 0.39),
        (9, 0.06, 0.375),
        "floor" if row % 3 else "floor2",
        bevel=0.008,
    )
box("Back wall", (0, 1.7, -3.55), (9.2, 3.4, 0.16), "wall")
box("Left wall", (-4.55, 1.7, 0), (0.16, 3.4, 7.2), "cream")
box("Back skirting", (0, 0.15, -3.43), (9, 0.23, 0.10), "cream")
box("Left skirting", (-4.43, 0.15, 0), (0.10, 0.23, 7), "cream")

# The cutaway keeps every playable object visible from the front camera.
box("Window frame", (1.45, 2.1, -3.41), (2.45, 1.85, 0.13), "wood")
box("Window view", (1.45, 2.1, -3.32), (2.23, 1.63, 0.06), "sky")
box("Window cross vertical", (1.45, 2.1, -3.25), (0.07, 1.7, 0.07), "cream")
box("Window cross horizontal", (1.45, 2.1, -3.25), (2.3, 0.07, 0.07), "cream")
box("Window sill", (1.45, 1.25, -3.2), (2.65, 0.12, 0.38), "cream")
for side in [-1, 1]:
    for fold in range(4):
        cylinder(
            "Curtain fold",
            (1.45 + side * (1.25 + fold * 0.10), 2.05, -3.13),
            0.09,
            1.95,
            "cream",
        )

shelf = empty(
    "zone_books", (-2.65, 0, -3.02), kind="zone", category="books", label="本棚"
)
box("Shelf back", (0, 1.1, -0.30), (2.6, 2.2, 0.11), "wood", shelf)
for x in [-1.3, 1.3]:
    box("Shelf side", (x, 1.1, 0), (0.13, 2.2, 0.72), "wood", shelf)
for y in [0.16, 0.82, 1.5, 2.2]:
    box("Shelf board", (0, y, 0), (2.65, 0.11, 0.76), "wood", shelf)
for index, color in enumerate(["blue", "peach", "sage", "yellow", "cream"]):
    box(
        "Shelved book",
        (-1 + index * 0.19, 1.10, 0.05),
        (0.14, 0.45 + (index % 2) * 0.1, 0.42),
        color,
        shelf,
        0.015,
    )
box("Storage box", (0.60, 0.49, 0.02), (0.82, 0.48, 0.55), "cream", shelf)
box("Storage label", (0.60, 0.52, 0.31), (0.27, 0.12, 0.01), "wood", shelf, 0.005)

for x in [0.9, 3.5]:
    for z in [-2.8, -1.7]:
        cylinder("Sofa foot", (x, 0.18, z), 0.08, 0.3, "wood")
box("Sofa base", (2.2, 0.48, -2.25), (3.05, 0.5, 1.5), "sage", bevel=0.17)
box("Sofa back", (2.2, 1.02, -2.87), (3.05, 1.15, 0.32), "sage", bevel=0.15)
for x in [0.68, 3.72]:
    box("Sofa arm", (x, 0.79, -2.2), (0.29, 0.78, 1.55), "sage", bevel=0.12)
for x in [1.45, 2.95]:
    box("Sofa seat", (x, 0.79, -2.13), (1.35, 0.24, 1.12), "sage", bevel=0.13)
box("Linen cushion", (1.08, 1.12, -2.48), (0.58, 0.59, 0.20), "cream", bevel=0.13)
box("Ochre cushion", (3.18, 1.12, -2.48), (0.52, 0.55, 0.20), "yellow", bevel=0.12)

box("Woven rug", (0.45, 0.075, 0.2), (4.8, 0.035, 3.55), "rug", bevel=0.2)
for x in [-1.65, 2.55]:
    box("Rug woven border", (x, 0.097, 0.2), (0.055, 0.008, 3.1), "cream", bevel=0)
for x, z in [(-0.4, -0.45), (0.65, -0.45), (0.12, 0.6)]:
    cylinder("Coffee table leg", (x, 0.34, z), 0.06, 0.52, "wood")
cylinder("Coffee table top", (0.1, 0.66, 0), 1.0, 0.13, "wood")
cylinder("Coffee cup", (0.45, 0.86, -0.2), 0.13, 0.24, "cream")
cylinder("Coffee surface", (0.45, 0.985, -0.2), 0.105, 0.008, "dark")

laundry = empty(
    "zone_laundry",
    (3.45, 0, 1.9),
    kind="zone",
    category="laundry",
    label="ランドリーバスケット",
)
cylinder(
    "Basket inside", (0, 0.36, 0), 0.53, 0.69, "dark", laundry, top=0.62, hollow=True
)
cylinder("Basket bottom", (0, 0.045, 0), 0.53, 0.06, "dark", laundry)
for index in range(24):
    angle = index * math.tau / 24
    cylinder(
        "Wicker strand",
        (math.cos(angle) * 0.56, 0.40, math.sin(angle) * 0.56),
        0.035,
        0.75,
        "wood",
        laundry,
    )
for height in [0.1, 0.25, 0.40, 0.55, 0.74]:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.565, minor_radius=0.035, major_segments=32, minor_segments=6
    )
    finish(bpy.context.object, "Basket weave", "floor", laundry, (0, height, 0))

trash = empty(
    "zone_trash", (-3.5, 0, 1.85), kind="zone", category="trash", label="ごみ箱"
)
cylinder(
    "Wastebasket body", (0, 0.40, 0), 0.39, 0.78, "blue", trash, top=0.46, hollow=True
)
cylinder("Wastebasket bottom", (0, 0.04, 0), 0.39, 0.06, "dark", trash)
bpy.ops.mesh.primitive_torus_add(
    major_radius=0.445, minor_radius=0.025, major_segments=32, minor_segments=6
)
finish(bpy.context.object, "Wastebasket rim", "blue", trash, (0, 0.80, 0))
for index in range(12):
    angle = index * math.tau / 12
    cylinder(
        "Bin detail",
        (math.cos(angle) * 0.41, 0.42, math.sin(angle) * 0.41),
        0.014,
        0.65,
        "cream",
        trash,
    )


def plant(position, scale=1):
    x, y, z = position
    cylinder(
        "Terracotta planter",
        (x, y + 0.25 * scale, z),
        0.27 * scale,
        0.5 * scale,
        "peach",
        top=0.34 * scale,
    )
    cylinder("Plant stem", (x, y + 0.77 * scale, z), 0.025 * scale, 0.8 * scale, "leaf")
    for index in range(7):
        angle = index * 2.4
        leaf = sphere(
            "Plant leaf",
            (
                x + math.cos(angle) * 0.21 * scale,
                y + (0.55 + index * 0.1) * scale,
                z + math.sin(angle) * 0.21 * scale,
            ),
            (0.26 * scale, 0.09 * scale, 0.12 * scale),
            "leaf" if index % 2 else "leaf2",
        )
        leaf.rotation_euler[2] = angle


plant((-3.25, 2.27, -3.0), 0.55)
plant((3.8, 0.05, -0.4), 1.15)
cylinder("Lamp base", (3.87, 0.09, -1.8), 0.30, 0.08, "dark")
cylinder("Lamp stem", (3.87, 1.18, -1.8), 0.025, 2.25, "dark")
cylinder("Lamp shade", (3.87, 2.27, -1.8), 0.43, 0.50, "cream", top=0.25)
box("Wall art frame", (-4.43, 2.08, -0.3), (0.10, 1.3, 1.06), "wood")
box("Wall art paper", (-4.36, 2.08, -0.3), (0.03, 1.14, 0.90), "paper")
sphere("Art sun", (-4.32, 2.27, -0.35), (0.025, 0.25, 0.25), "yellow")
box("Art landscape", (-4.31, 1.83, -0.3), (0.025, 0.3, 0.78), "sage")

BOOKS = [(-2.7, 0.16, 0.3), (1.15, 0.16, 1.1), (-0.2, 0.79, 0.1), (-2.1, 0.16, 2.2)]
CLOTHES = [(2.2, 0.16, 0.55), (-1.45, 0.18, -0.6), (0.2, 0.16, 2.4), (2.1, 0.99, -2.05)]
RUBBISH = [
    (-0.9, 0.18, 1.55),
    (2.45, 0.18, 2.55),
    (-2.8, 0.18, -1.1),
    (0.15, 0.84, -0.48),
]
for category, positions in [("books", BOOKS), ("laundry", CLOTHES), ("trash", RUBBISH)]:
    for index, position in enumerate(positions):
        label = {
            "books": ["読みかけの小説", "青いノート", "旅の本", "レシピブック"],
            "laundry": [
                "しましまシャツ",
                "ピンクのTシャツ",
                "青いタオル",
                "脱ぎっぱなしの靴下",
            ],
            "trash": ["丸めた紙くず", "空き缶", "紙くず", "飲み終わった缶"],
        }[category][index]
        root = empty(
            f"item_{category}_{index}",
            position,
            kind="item",
            category=category,
            label=label,
        )
        root.rotation_euler[2] = [0.25, -0.5, 0.9, -0.15][index]
        color = ["peach", "blue", "yellow", "sage"][index]
        if category == "books":
            box("Book pages", (0, 0, 0), (0.47, 0.11, 0.62), "paper", root, 0.012)
            for height in [-0.075, 0.075]:
                box(
                    "Book cover", (0, height, 0), (0.51, 0.025, 0.66), color, root, 0.01
                )
            box("Book spine", (-0.25, 0, 0), (0.045, 0.17, 0.66), color, root, 0.01)
        elif category == "laundry":
            box("Shirt body", (0, 0.03, 0), (0.58, 0.12, 0.65), color, root, 0.07)
            for side in [-1, 1]:
                box(
                    "Shirt sleeve",
                    (side * 0.36, 0.02, -0.17),
                    (0.26, 0.13, 0.27),
                    color,
                    root,
                    0.055,
                )
            box(
                "Shirt collar",
                (0, 0.105, -0.27),
                (0.19, 0.02, 0.08),
                "cream",
                root,
                0.025,
            )
            if index == 0:
                for stripe in [-0.15, 0.05, 0.25]:
                    box(
                        "Cotton stripe",
                        (0, 0.1, stripe),
                        (0.56, 0.012, 0.045),
                        "cream",
                        root,
                        0.005,
                    )
        elif index % 2 == 0:
            sphere(
                "Crumpled paper", (0, 0, 0), (0.22, 0.22, 0.2), "paper", root, ico=True
            )
        else:
            cylinder("Empty soda can", (0, 0.10, 0), 0.12, 0.36, color, root)
            cylinder("Can top", (0, 0.29, 0), 0.115, 0.018, "metal", root)
            box("Can label", (0, 0.12, 0.119), (0.12, 0.14, 0.01), "cream", root, 0.01)

M["doll_skin"] = material("Doll porcelain peach", (0.98, 0.72, 0.55))
M["doll_pink"] = material("Cure Black ribbon pink", (0.95, 0.13, 0.38))
M["doll_black"] = material("Cure Black costume", (0.065, 0.045, 0.08))
M["doll_hair"] = material("Nagisa orange brown hair", (0.73, 0.28, 0.07))
M["doll_eye"] = material("Amber eyes", (0.35, 0.10, 0.035))

stand = empty(
    "zone_dolls",
    (-1.9, 2.29, -2.96),
    kind="zone",
    category="dolls",
    label="人形の飾り台",
)
cylinder("Pink display plinth", (0, 0, 0), 0.30, 0.07, "doll_pink", stand)
cylinder("Display plinth top", (0, 0.045, 0), 0.26, 0.025, "cream", stand)

doll = empty(
    "item_dolls_0",
    (-1.8, 0.13, 1.2),
    kind="item",
    category="dolls",
    label="キュアブラックの人形",
)
doll.rotation_euler[2] = -0.25
for side in [-1, 1]:
    sphere(
        "Black doll boot",
        (side * 0.12, 0.13, 0.05),
        (0.10, 0.13, 0.14),
        "doll_black",
        doll,
    )
    cylinder("Boot pink cuff", (side * 0.12, 0.23, 0), 0.10, 0.06, "doll_pink", doll)
    cylinder("Doll leg", (side * 0.12, 0.33, 0), 0.065, 0.20, "doll_skin", doll)
cylinder("Pink skirt frill", (0, 0.43, 0), 0.27, 0.09, "doll_pink", doll, top=0.22)
cylinder("Black flared skirt", (0, 0.49, 0), 0.24, 0.16, "doll_black", doll, top=0.14)
box("Doll bodice", (0, 0.68, 0), (0.31, 0.28, 0.23), "doll_black", doll, 0.08)
box("Pink waist ribbon", (0, 0.565, 0.02), (0.33, 0.06, 0.25), "doll_pink", doll, 0.025)
for side in [-1, 1]:
    sphere(
        "Pink shoulder ribbon",
        (side * 0.20, 0.76, 0),
        (0.10, 0.08, 0.14),
        "doll_pink",
        doll,
    )
    arm = cylinder(
        "Doll arm", (side * 0.26, 0.62, 0.02), 0.055, 0.23, "doll_skin", doll
    )
    arm.rotation_euler[1] = side * 0.35
    sphere(
        "Black glove",
        (side * 0.30, 0.49, 0.03),
        (0.07, 0.085, 0.07),
        "doll_black",
        doll,
    )
    sphere(
        "Glove heart ribbon",
        (side * 0.30, 0.50, 0.09),
        (0.045, 0.04, 0.015),
        "doll_pink",
        doll,
    )
cylinder("Doll neck", (0, 0.84, 0), 0.075, 0.11, "doll_skin", doll)
sphere("Orange bob haircut", (0, 1.11, -0.025), (0.33, 0.33, 0.28), "doll_hair", doll)
sphere("Doll face", (0, 1.055, 0.115), (0.26, 0.26, 0.22), "doll_skin", doll)
for side in [-1, 1]:
    sphere(
        "Amber doll eye",
        (side * 0.098, 1.09, 0.315),
        (0.047, 0.064, 0.024),
        "doll_eye",
        doll,
    )
    sphere(
        "Eye sparkle",
        (side * 0.098 - 0.012, 1.115, 0.336),
        (0.015, 0.021, 0.008),
        "paper",
        doll,
    )
    sphere(
        "Doll rosy cheek",
        (side * 0.16, 1.015, 0.295),
        (0.04, 0.018, 0.014),
        "doll_pink",
        doll,
    )
    sphere(
        "Hair flick", (side * 0.29, 1.07, -0.015), (0.10, 0.19, 0.12), "doll_hair", doll
    )
    sphere(
        "Pink hair ribbon",
        (side * 0.28, 1.24, 0.05),
        (0.09, 0.045, 0.06),
        "doll_pink",
        doll,
    )
for index in range(5):
    fringe = sphere(
        "Side swept fringe",
        (-0.19 + index * 0.08, 1.25 - index * 0.013, 0.21),
        (0.09, 0.15, 0.08),
        "doll_hair",
        doll,
    )
    fringe.rotation_euler[1] = -0.5
sphere("Doll smile", (0, 0.955, 0.321), (0.038, 0.016, 0.012), "doll_pink", doll)
for side in [-1, 1]:
    sphere(
        "Chest bow",
        (side * 0.065, 0.745, 0.14),
        (0.065, 0.045, 0.035),
        "doll_pink",
        doll,
    )
sphere("Chest heart", (0, 0.735, 0.17), (0.04, 0.045, 0.022), "cream", doll)

M["resident_skin"] = material("Resident warm skin", (0.90, 0.64, 0.45))
M["resident_hair"] = material("Resident chestnut hair", (0.24, 0.12, 0.075))
M["resident_apron"] = material("Resident sage apron", (0.32, 0.49, 0.36))
M["resident_denim"] = material("Resident indigo trousers", (0.22, 0.32, 0.39))
player = empty("player_resident", (-1.75, 0.06, 2.5), kind="player", label="小さな住人")
sphere("Resident sweater", (0, 0.84, 0), (0.27, 0.34, 0.20), "cream", player)
box("Apron skirt", (0, 0.65, 0.11), (0.49, 0.38, 0.26), "resident_apron", player, 0.07)
box("Apron bib", (0, 0.92, 0.20), (0.31, 0.31, 0.055), "resident_apron", player, 0.04)
box("Apron pocket", (0, 0.66, 0.255), (0.22, 0.12, 0.03), "sage", player, 0.025)
for side in [-1, 1]:
    box(
        "Apron strap",
        (side * 0.14, 1.04, 0.12),
        (0.055, 0.20, 0.16),
        "resident_apron",
        player,
        0.015,
    )
    sphere(
        "Apron brass button",
        (side * 0.11, 0.99, 0.24),
        (0.025, 0.025, 0.014),
        "yellow",
        player,
    )
    leg = empty(f"resident_leg_{side}", (side * 0.13, 0.49, 0), stridePhase=side)
    leg.parent = player
    box("Trouser leg", (0, -0.17, 0), (0.18, 0.34, 0.20), "resident_denim", leg, 0.07)
    sphere("Resident slipper", (0, -0.37, 0.06), (0.12, 0.08, 0.18), "peach", leg)
    arm = empty(f"resident_arm_{side}", (side * 0.29, 1.02, 0), stridePhase=-side)
    arm.parent = player
    sphere("Sweater sleeve", (side * 0.015, -0.16, 0), (0.10, 0.23, 0.11), "cream", arm)
    sphere(
        "Resident hand",
        (side * 0.02, -0.36, 0.015),
        (0.085, 0.10, 0.08),
        "resident_skin",
        arm,
    )
cylinder("Resident neck", (0, 1.14, 0), 0.085, 0.12, "resident_skin", player)
sphere("Chestnut bob", (0, 1.43, -0.035), (0.32, 0.33, 0.28), "resident_hair", player)
sphere("Resident face", (0, 1.39, 0.105), (0.265, 0.27, 0.22), "resident_skin", player)
for side in [-1, 1]:
    sphere(
        "Resident ear",
        (side * 0.255, 1.36, 0.03),
        (0.055, 0.08, 0.06),
        "resident_skin",
        player,
    )
    sphere(
        "Resident eye",
        (side * 0.10, 1.43, 0.306),
        (0.033, 0.047, 0.022),
        "dark",
        player,
    )
    sphere(
        "Resident eye glint",
        (side * 0.10 - 0.008, 1.45, 0.325),
        (0.009, 0.013, 0.006),
        "paper",
        player,
    )
    sphere(
        "Resident blush",
        (side * 0.17, 1.33, 0.29),
        (0.04, 0.022, 0.012),
        "peach",
        player,
    )
for index in range(5):
    sphere(
        "Swept chestnut fringe",
        (-0.19 + index * 0.085, 1.61 - index * 0.02, 0.215),
        (0.08, 0.13, 0.07),
        "resident_hair",
        player,
    )
sphere(
    "Resident nose", (0, 1.37, 0.324), (0.033, 0.027, 0.032), "resident_skin", player
)
sphere(
    "Resident smile", (0, 1.28, 0.288), (0.055, 0.018, 0.012), "resident_hair", player
)
box(
    "Resident hair clip",
    (-0.25, 1.53, 0.14),
    (0.08, 0.03, 0.035),
    "yellow",
    player,
    0.012,
)

M["dust"] = material("Lilac dust", (0.61, 0.46, 0.70))
enemy = empty("enemy_chirakashi", (2.8, 0.75, 2.6), kind="enemy")
sphere("Dust body", (0, 0, 0), (0.48, 0.40, 0.43), "dust", enemy)
for index in range(9):
    angle = index * math.tau / 9
    sphere(
        "Dust fluff",
        (math.cos(angle) * 0.4, math.sin(angle) * 0.29, -0.04),
        (0.18, 0.18, 0.18),
        "dust",
        enemy,
    )
for side in [-1, 1]:
    sphere(
        "Dust eye white", (side * 0.17, 0.09, 0.36), (0.115, 0.14, 0.06), "paper", enemy
    )
    sphere(
        "Dust pupil", (side * 0.17, 0.07, 0.415), (0.048, 0.065, 0.025), "dark", enemy
    )
    sphere("Dust foot", (side * 0.25, -0.35, 0.14), (0.16, 0.09, 0.20), "dust", enemy)
sphere("Mischievous smile", (0, -0.15, 0.39), (0.14, 0.065, 0.035), "dark", enemy)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    export_extras=True,
    export_apply=True,
    export_animations=False,
)
print(f"Generated {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
