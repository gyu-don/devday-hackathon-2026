import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Resident } from "../src/player.ts";
import { canWalk, findWalkPath, playerHome } from "../src/navigation.ts";
import { RoomPhysics } from "../src/physics.ts";

describe("操作キャラ", () => {
  it("テーブル・ソファ・棚・部屋の外を避け、家具上の指定点には近づける床まで歩く", () => {
    expect(canWalk({ x: 0.1, z: 0 })).toBe(false);
    expect(canWalk({ x: 2, z: -2 })).toBe(false);
    expect(canWalk({ x: 5, z: 0 })).toBe(false);
    for (const target of [
      { x: 2, z: 2.5 },
      { x: -2.9, z: -2.9 },
      { x: 0, z: 0 },
    ]) {
      const route = findWalkPath(playerHome, target);
      expect(route.length).toBeGreaterThan(0);
      expect(route.every(canWalk)).toBe(true);
      for (let index = 1; index < route.length; index += 1) {
        const a = route[index - 1]!;
        const b = route[index]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(0.25);
      }
    }
  });
  it("移動を停止したら歩き続けず、リセットで開始位置と手足の姿勢に戻る", () => {
    const model = new THREE.Object3D();
    const leg = new THREE.Object3D();
    leg.userData.stridePhase = 1;
    model.add(leg);
    const actor = new Resident(model, vi.fn());
    actor.walkTo({ x: 2, z: 2.5 });
    for (let t = 0; t < 1000; t += 16) actor.update(t, 0, false);
    expect(model.position.x).toBeGreaterThan(playerHome.x);
    actor.stop();
    const stopped = model.position.clone();
    for (let t = 1000; t < 2000; t += 16) actor.update(t, 0, false);
    expect(model.position.distanceTo(stopped)).toBeLessThan(0.05);
    actor.reset();
    expect(model.position.x).toBe(playerHome.x);
    expect(model.position.z).toBe(playerHome.z);
    expect(leg.rotation.x).toBe(0);
  });
  it("キーを離した後は停止し、reduced motion では手足を揺らさない", () => {
    const model = new THREE.Object3D();
    const arm = new THREE.Object3D();
    arm.userData.stridePhase = -1;
    model.add(arm);
    const actor = new Resident(model, vi.fn());
    actor.key("KeyD", true);
    for (let t = 0; t < 500; t += 16) actor.update(t, 0, true);
    expect(arm.rotation.x).toBe(0);
    actor.key("KeyD", false);
    const position = model.position.clone();
    actor.update(520, 0, true);
    expect(model.position.equals(position)).toBe(true);
  });
});

describe("Rapier の配置物", () => {
  it("重力で家具の上に落ち、衝突して止まり、リセットすると初期状態に戻る", async () => {
    const table = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4));
    table.position.y = 1;
    table.updateMatrixWorld(true);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.5));
    book.name = "book";
    book.position.set(0, 2, 0);
    book.updateMatrixWorld(true);
    const settled = vi.fn();
    const physics = await RoomPhysics.create([table], [book], settled);
    physics.grab("book");
    physics.release("book");
    for (let t = 0; t < 8000; t += 1000 / 60) physics.update(t);
    expect(book.position.y).toBeGreaterThan(1.1);
    expect(book.position.y).toBeLessThan(1.2);
    expect(settled).toHaveBeenCalled();
    expect(physics.isSettling()).toBe(false);
    physics.reset();
    expect(book.position.y).toBe(2);
    physics.dispose();
    table.geometry.dispose();
    book.geometry.dispose();
  });
});
