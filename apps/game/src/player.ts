import type { Object3D } from "three";
import { canWalk, findWalkPath, playerHome } from "./navigation.ts";
import type { FloorPoint } from "./navigation.ts";

export class Resident {
  private path: FloorPoint[] = [];
  private joints: { object: Object3D; phase: number; base: number }[] = [];
  private keys = new Set<string>();
  private lastTime = 0;
  private stride = 0;
  private moving = false;

  constructor(
    private object: Object3D,
    private announce: (message: string) => void,
  ) {
    object.traverse((part) => {
      const isJoint = typeof part.userData.stridePhase === "number";
      if (isJoint)
        this.joints.push({
          object: part,
          phase: part.userData.stridePhase as number,
          base: part.rotation.x,
        });
    });
    this.reset();
  }

  walkTo(target: FloorPoint) {
    this.path = findWalkPath(this.object.position, target);
  }

  step(x: number, z: number, cameraAngle: number) {
    const length = Math.hypot(x, z);
    const hasDirection = length > 0;
    if (!hasDirection) return;
    const dx = (x * Math.cos(cameraAngle) + z * Math.sin(cameraAngle)) / length;
    const dz = (-x * Math.sin(cameraAngle) + z * Math.cos(cameraAngle)) / length;
    this.walkTo({ x: this.object.position.x + dx * 0.8, z: this.object.position.z + dz * 0.8 });
  }

  key(code: string, pressed: boolean) {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  stop() {
    this.keys.clear();
    this.path = [];
    this.lastTime = 0;
    this.setMoving(false);
  }

  private setMoving(moving: boolean) {
    const changed = moving !== this.moving;
    this.moving = moving;
    if (changed) this.announce(moving ? "住人が歩いています。" : "住人が到着しました。");
  }

  update(now: number, cameraAngle: number, reducedMotion: boolean) {
    const elapsed = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;
    const horizontal =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const vertical =
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const manual = horizontal !== 0 || vertical !== 0;
    const position = this.object.position;
    const before = { x: position.x, z: position.z };
    const speed = elapsed * 2.2;
    if (manual) {
      this.path = [];
      const length = Math.hypot(horizontal, vertical);
      const x =
        ((horizontal * Math.cos(cameraAngle) + vertical * Math.sin(cameraAngle)) / length) * speed;
      const z =
        ((-horizontal * Math.sin(cameraAngle) + vertical * Math.cos(cameraAngle)) / length) * speed;
      const freeX = canWalk({ x: position.x + x, z: position.z });
      if (freeX) position.x += x;
      const freeZ = canWalk({ x: position.x, z: position.z + z });
      if (freeZ) position.z += z;
    } else {
      let budget = speed;
      while (this.path.length > 0 && budget > 0) {
        const next = this.path[0]!;
        const dx = next.x - position.x;
        const dz = next.z - position.z;
        const distance = Math.hypot(dx, dz);
        const arrived = distance <= budget;
        if (arrived) {
          position.x = next.x;
          position.z = next.z;
          budget -= distance;
          this.path.shift();
        } else {
          position.x += (dx / distance) * budget;
          position.z += (dz / distance) * budget;
          budget = 0;
        }
      }
    }
    const dx = position.x - before.x;
    const dz = position.z - before.z;
    const moving = Math.hypot(dx, dz) > 0.0001;
    this.setMoving(moving);
    if (moving) {
      this.object.rotation.y = Math.atan2(dx, dz);
      this.stride += speed * 6;
    }
    const swing = moving && !reducedMotion ? Math.sin(this.stride) * 0.35 : 0;
    for (const joint of this.joints) joint.object.rotation.x = joint.base + swing * joint.phase;
    position.y = moving && !reducedMotion ? 0.06 + Math.abs(Math.sin(this.stride)) * 0.035 : 0.06;
  }

  reset() {
    this.stop();
    this.object.position.set(playerHome.x, 0.06, playerHome.z);
    this.object.rotation.y = 0.65;
    this.stride = 0;
    for (const joint of this.joints) joint.object.rotation.x = joint.base;
  }
}
