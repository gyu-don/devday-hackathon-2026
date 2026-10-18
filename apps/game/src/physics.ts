import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const initialized = RAPIER.init();

export class RoomPhysics {
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private bodies = new Map<
    string,
    {
      object: THREE.Object3D;
      body: RAPIER.RigidBody;
      position: THREE.Vector3;
      rotation: THREE.Quaternion;
    }
  >();
  private last = 0;
  private accumulator = 0;
  private active = false;

  static async create(surfaces: THREE.Mesh[], objects: THREE.Object3D[], settled: () => void) {
    await initialized;
    return new RoomPhysics(surfaces, objects, settled);
  }

  private constructor(
    surfaces: THREE.Mesh[],
    objects: THREE.Object3D[],
    private settled: () => void,
  ) {
    for (const mesh of surfaces) {
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const positions = geometry.getAttribute("position");
      const vertices = Float32Array.from(positions.array);
      const indices = geometry.index
        ? Uint32Array.from(geometry.index.array)
        : Uint32Array.from({ length: positions.count }, (_, i) => i);
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.85));
      geometry.dispose();
    }
    for (const object of objects) {
      const position = object.getWorldPosition(new THREE.Vector3());
      const rotation = object.getWorldQuaternion(new THREE.Quaternion());
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(position.x, position.y, position.z)
          .setRotation(rotation)
          .setCcdEnabled(true)
          .setLinearDamping(1.5)
          .setAngularDamping(2),
      );
      const bounds = new THREE.Box3();
      const inverse = object.matrixWorld.clone().invert();
      object.traverse((part) => {
        const isMesh = part instanceof THREE.Mesh;
        if (!isMesh) return;
        part.geometry.computeBoundingBox();
        const box = part.geometry.boundingBox;
        const hasBounds = Boolean(box);
        if (hasBounds && box)
          bounds.union(box.clone().applyMatrix4(inverse.clone().multiply(part.matrixWorld)));
      });
      const half = bounds
        .getSize(new THREE.Vector3())
        .multiplyScalar(0.5)
        .max(new THREE.Vector3(0.025, 0.025, 0.025));
      const center = bounds.getCenter(new THREE.Vector3());
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setTranslation(center.x, center.y, center.z)
          .setFriction(0.8)
          .setRestitution(0.08),
        body,
      );
      this.bodies.set(object.name, { object, body, position, rotation });
    }
    this.world.timestep = 1 / 60;
  }

  grab(id: string) {
    this.bodies.get(id)?.body.setEnabled(false);
  }

  release(id: string) {
    const entry = this.bodies.get(id);
    if (!entry) return;
    entry.body.setTranslation(entry.object.position, true);
    entry.body.setRotation(entry.object.quaternion, true);
    entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    entry.body.setEnabled(true);
    this.active = true;
  }

  isSettling() {
    return this.active;
  }

  update(now: number) {
    const delta = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    this.accumulator += delta;
    while (this.accumulator >= 1 / 60) {
      this.world.step();
      this.accumulator -= 1 / 60;
    }
    let awake = false;
    for (const { object, body } of this.bodies.values()) {
      const dynamic = body.isEnabled() && body.isDynamic();
      if (!dynamic) continue;
      object.position.copy(body.translation());
      object.quaternion.copy(body.rotation());
      const fallen = object.position.y < -1;
      if (fallen) {
        object.position.set(0, 1.8, 2.5);
        body.setTranslation(object.position, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      awake ||= !body.isSleeping();
    }
    const stopped = this.active && !awake;
    if (stopped) {
      this.active = false;
      this.settled();
    }
  }

  reset() {
    this.active = false;
    this.last = 0;
    this.accumulator = 0;
    for (const { object, body, position, rotation } of this.bodies.values()) {
      object.position.copy(position);
      object.quaternion.copy(rotation);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      body.setTranslation(position, false);
      body.setRotation(rotation, false);
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      body.setEnabled(true);
    }
  }

  dispose() {
    this.world.free();
  }
}
