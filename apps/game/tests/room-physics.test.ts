import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomPhysics } from "../src/physics.ts";

it("実際の部屋でAIの連続配置が静止し、別の部屋の物を変更しない", async () => {
  const file = await readFile(new URL("../public/models/room.glb", import.meta.url));
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const loader = new GLTFLoader();
  const left = (await loader.parseAsync(bytes, "")).scene;
  const right = (await loader.parseAsync(bytes.slice(0), "")).scene;
  left.updateMatrixWorld(true);
  right.updateMatrixWorld(true);
  const surfaces: THREE.Mesh[] = [];
  const objects: THREE.Object3D[] = [];
  right.traverse((object) => {
    const isItem = object.userData.kind === "item";
    if (isItem) objects.push(object);
    const mesh = object instanceof THREE.Mesh;
    if (!mesh) return;
    let parent: THREE.Object3D | null = object;
    while (parent && !parent.userData.kind) parent = parent.parent;
    const surface = !parent || parent.userData.kind === "zone";
    if (surface) surfaces.push(object);
  });
  const item = right.getObjectByName("item_laundry_3")!;
  const humanItem = left.getObjectByName("item_laundry_3")!;
  const initial = humanItem.position.clone();
  const settled = vi.fn();
  const physics = await RoomPhysics.create(surfaces, objects, settled);
  let time = 0;
  try {
    for (const [x, z] of [
      [0, -2.8],
      [-3.3, 2.5],
      [0, 0.8],
    ]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(surfaces, false)[0]!;
      expect(hit).toBeDefined();
      item.updateMatrixWorld(true);
      const bottom = new THREE.Box3().setFromObject(item).min.y;
      const y = hit.point.y + 0.015 + item.position.y - bottom + 0.04;
      physics.grab(item.name);
      item.position.set(x, y, z);
      physics.release(item.name);
      for (let step = 0; step < 1800; step += 1) {
        time += 1000 / 60;
        physics.update(time);
      }
      expect(physics.isSettling(), `配置 (${x}, ${z}) の静止`).toBe(false);
      expect(humanItem.position.equals(initial)).toBe(true);
    }
    expect(settled).toHaveBeenCalledTimes(3);
  } finally {
    physics.dispose();
  }
}, 20_000);
