import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Category, Item, RoomState, Placement } from "./types.ts";
import { Resident } from "./player.ts";
import { canWalk } from "./navigation.ts";
import type { RoomPhysics } from "./physics.ts";
import type { AutoMove } from "@devday/contracts";

type MovingItem = {
  object: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  scale: THREE.Vector3;
  toScale: THREE.Vector3;
  started: number;
  hide: boolean;
};

export class Room {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private objects = new Map<string, THREE.Object3D>();
  private original = new Map<
    string,
    { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }
  >();
  private items: Item[] = [];
  private selected: string | null = null;
  private ring: THREE.Mesh;
  private observer: ResizeObserver;
  private moves: MovingItem[] = [];
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private disposed = false;
  private angle = 0;
  private onState: (state: RoomState) => void;
  private onPlace: (point: Placement) => void;
  private initial = new Map<string, THREE.Vector3>();
  private surfaces: THREE.Mesh[] = [];
  private abort = new AbortController();
  private cursor = document.createElement("span");
  private enemy: THREE.Object3D | null = null;
  private enemyEnabled = false;
  private enemyUntil = 0;
  private enemyFrom = new THREE.Vector3();
  private enemyTo = new THREE.Vector3();
  private resident: Resident | null = null;
  private playerObject: THREE.Object3D | null = null;
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06);
  private physics: RoomPhysics | null = null;
  private rotating = false;

  constructor(
    host: HTMLElement,
    onState: (state: RoomState) => void,
    onPlace: (point: Placement) => void,
    onError: () => void,
    onPlayerStatus: (message: string) => void = () => {},
    private onChanged: () => void = () => {},
  ) {
    this.onState = onState;
    this.onPlace = onPlace;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "操作キャラのいる小さな部屋。床をクリック・タップ、WASDで移動。物を選び、床や家具の上に自由に置いてください。下のボタンからも操作できます。",
    );
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "img");
    host.append(this.renderer.domElement);
    this.cursor.className = "gyro-cursor";
    this.cursor.hidden = true;
    this.cursor.setAttribute("aria-hidden", "true");
    host.append(this.cursor);
    this.positionCamera();

    this.scene.add(new THREE.HemisphereLight(0xfff7df, 0x9eaa8b, 1.8));
    const sun = new THREE.DirectionalLight(0xffedce, 2.6);
    sun.position.set(-3, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc8dfed, 0.8);
    fill.position.set(5, 4, -2);
    this.scene.add(fill);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.43, 0.48, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc77748,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.scene.add(this.ring);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.41;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      const hasSize = width > 0 && height > 0;
      if (!hasSize) return;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.observer.observe(host);
    const canvas = this.renderer.domElement;
    const options = { signal: this.abort.signal };
    let pressed: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        const isPrimary = event.isPrimary && event.button === 0;
        if (!isPrimary) return;
        pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
      },
      options,
    );
    canvas.addEventListener(
      "pointercancel",
      () => {
        pressed = null;
      },
      options,
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        const isTap =
          pressed?.id === event.pointerId &&
          Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 10;
        pressed = null;
        if (!isTap) return;
        const target = this.hit(event);
        const isItem = target?.userData.kind === "item";
        if (isItem && target) this.select(target.name);
        if (isItem) return;
        this.interactWithSurface();
      },
      options,
    );

    const movementKeys = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ]);
    window.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        const isEditing =
          target instanceof HTMLElement &&
          (target.isContentEditable || target.matches("input,textarea,select,button,summary"));
        const isMovement =
          movementKeys.has(event.code) &&
          !isEditing &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey;
        if (!isMovement) return;
        event.preventDefault();
        this.resident?.key(event.code, true);
      },
      options,
    );
    window.addEventListener("keyup", (event) => this.resident?.key(event.code, false), options);
    window.addEventListener("blur", () => this.resident?.stop(), options);
    document.addEventListener(
      "visibilitychange",
      () => {
        const isHidden = document.hidden;
        if (isHidden) this.resident?.stop();
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        canvas.style.cursor = this.hit(event) ? "pointer" : "default";
      },
      options,
    );

    new GLTFLoader().load(
      "/models/room.glb",
      (gltf) => {
        if (this.disposed) return;
        gltf.scene.traverse((object) => {
          const isPlayer = object.userData.kind === "player";
          if (isPlayer) {
            this.playerObject = object;
            this.resident = new Resident(object, onPlayerStatus);
          }
          const isEnemy = object.userData.kind === "enemy";
          if (isEnemy) {
            this.enemy = object;
            object.visible = this.enemyEnabled;
          }
          const isMesh = object instanceof THREE.Mesh;
          if (isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
          const isItem = object.userData.kind === "item";
          if (isItem) {
            this.objects.set(object.name, object);
            this.original.set(object.name, {
              position: object.position.clone(),
              rotation: object.rotation.clone(),
              scale: object.scale.clone(),
            });
            this.items.push({
              id: object.name,
              label: String(object.userData.label),
              category: object.userData.category as Category,
              placed: false,
            });
          }
        });
        this.items.sort((a, b) => a.id.localeCompare(b.id));
        this.scene.add(gltf.scene);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((object) => {
          const isMesh = object instanceof THREE.Mesh;
          if (!isMesh) return;
          let parent: THREE.Object3D | null = object;
          while (parent && !parent.userData.kind) parent = parent.parent;
          const isSurface = !parent || parent.userData.kind === "zone";
          if (isSurface) this.surfaces.push(object);
        });
        for (const item of this.items) {
          const object = this.objects.get(item.id)!;
          this.initial.set(item.id, object.position.clone());
        }
        void import("./physics.ts")
          .then(async ({ RoomPhysics }) => {
            const physics = await RoomPhysics.create(
              this.surfaces,
              [...this.objects.values()],
              () => {
                for (const [id, object] of this.objects) {
                  const origin = this.original.get(id);
                  if (origin) {
                    origin.position.copy(object.position);
                    origin.rotation.copy(object.rotation);
                  }
                }
                onChanged();
              },
            );
            if (this.disposed) {
              physics.dispose();
              return;
            }
            this.physics = physics;
            this.emit();
          })
          .catch(() => onError());
      },
      undefined,
      () => onError(),
    );

    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      this.physics?.update(now);
      this.resident?.update(now, 0.65 + this.angle, this.reducedMotion.matches);
      this.moves = this.moves.filter((move) => {
        const progress = this.reducedMotion.matches ? 1 : Math.min((now - move.started) / 600, 1);
        const eased = 1 - (1 - progress) ** 3;
        move.object.position.lerpVectors(move.from, move.to, eased);
        move.object.position.y += Math.sin(progress * Math.PI) * 1.6;
        move.object.scale.lerpVectors(move.scale, move.toScale, progress);
        const isFinished = progress === 1;
        if (isFinished && move.hide) move.object.visible = false;
        if (isFinished) this.physics?.release(move.object.name);
        return !isFinished;
      });
      if (this.enemy?.visible) {
        const active = now < this.enemyUntil;
        const progress = this.reducedMotion.matches
          ? 1
          : Math.min(1, (now - (this.enemyUntil - 1800)) / 600);
        if (active) this.enemy.position.lerpVectors(this.enemyFrom, this.enemyTo, progress);
        this.enemy.position.y = this.reducedMotion.matches
          ? 0.75
          : 0.75 + Math.sin(now / 280) * 0.12;
      }
      const selected = this.selected ? this.objects.get(this.selected) : undefined;
      if (selected) {
        this.ring.position.copy(selected.position);
        this.ring.position.y = Math.max(0.1, selected.position.y - 0.1);
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  private emit() {
    this.onState({
      items: this.items.map((item) => ({ ...item })),
      selected: this.selected,
      ready: true,
    });
  }

  private positionCamera() {
    const radius = 14.6;
    this.camera.position.set(
      Math.sin(0.65 + this.angle) * radius,
      11.2,
      Math.cos(0.65 + this.angle) * radius,
    );
    this.camera.lookAt(0, 0.75, 0);
  }

  private hit(event: PointerEvent) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    return this.hitPointer();
  }

  private hitPointer() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const available = this.items.flatMap((item) => this.objects.get(item.id) ?? []);
    const hits = this.raycaster.intersectObjects(available, true);
    let object = hits[0]?.object;
    while (object && !object.userData.kind) object = object.parent ?? undefined;
    return object;
  }

  aim(x: number, y: number, activate: boolean) {
    this.pointer.set(x, y);
    this.cursor.hidden = false;
    this.cursor.style.left = `${(x + 1) * 50}%`;
    this.cursor.style.top = `${(1 - y) * 50}%`;
    if (!activate) return;
    const target = this.hitPointer();
    const isItem = target?.userData.kind === "item";
    if (isItem && target) this.select(target.name);
    if (isItem) return;
    this.interactWithSurface();
  }

  private walkOnFloor() {
    const point = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
    const insideRoom = point && Math.abs(point.x) <= 4.4 && Math.abs(point.z) <= 3.4;
    if (!insideRoom || !point) return;
    this.resident?.walkTo(point);
  }

  stepPlayer(x: number, z: number) {
    this.resident?.step(x, z, 0.65 + this.angle);
  }

  stopPlayer() {
    this.resident?.stop();
  }

  disableAim() {
    this.cursor.hidden = true;
  }

  select(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    const canSelect = Boolean(item);
    if (!canSelect) return;
    this.clearSelection();
    this.moves = this.moves.filter((move) => move.object.name !== id);
    this.selected = id;
    this.physics?.grab(id);
    const object = this.objects.get(id);
    const hasObject = Boolean(object);
    if (hasObject && object) this.resident?.walkTo(object.position);
    this.ring.visible = true;
    this.emit();
  }

  private clearSelection() {
    this.finishRotation();
    const previous = this.selected ? this.objects.get(this.selected) : undefined;
    const origin = previous ? this.original.get(previous.name) : undefined;
    if (previous && origin) previous.position.copy(origin.position);
    if (previous) this.physics?.release(previous.name);
    this.selected = null;
    this.ring.visible = false;
  }

  deselect() {
    this.clearSelection();
    this.emit();
  }

  rotateSelected(x: number, y: number, z: number) {
    const object = this.selected ? this.objects.get(this.selected) : undefined;
    if (!object) return;
    const changed = x !== 0 || y !== 0 || z !== 0;
    if (!changed) return;
    const started = !this.rotating;
    this.rotating = true;
    if (started) this.onChanged();
    object.rotateX(x);
    object.rotateY(y);
    object.rotateZ(z);
  }

  finishRotation() {
    const changed = this.rotating;
    this.rotating = false;
    if (changed) this.onChanged();
  }

  isSettling() {
    return this.rotating || this.moves.length > 0 || (this.physics?.isSettling() ?? false);
  }

  place(point: Placement) {
    this.finishRotation();
    const item = this.items.find((candidate) => candidate.id === this.selected);
    const object = item ? this.objects.get(item.id) : undefined;
    const origin = item ? this.original.get(item.id) : undefined;
    const valid =
      item &&
      object &&
      origin &&
      Math.abs(point.x) <= 4.4 &&
      Math.abs(point.z) <= 3.4 &&
      point.y >= 0 &&
      point.y <= 2.7;
    if (!valid || !item || !object || !origin) return false;
    object.updateMatrixWorld(true);
    const bottom = new THREE.Box3().setFromObject(object).min.y;
    const target = new THREE.Vector3(point.x, point.y + object.position.y - bottom + 0.04, point.z);
    this.physics?.grab(item.id);
    this.moves = this.moves.filter((move) => move.object !== object);
    this.moves.push({
      object,
      from: object.position.clone(),
      to: target,
      scale: object.scale.clone(),
      toScale: origin.scale.clone(),
      started: performance.now(),
      hide: false,
    });
    origin.position.copy(target);
    origin.rotation.copy(object.rotation);
    item.placed = true;
    this.resident?.stop();
    this.selected = null;
    this.ring.visible = false;
    this.emit();
    return true;
  }

  dropPoint(): Placement | null {
    const player = this.playerObject;
    if (!player) return null;
    const x = player.position.x + Math.sin(player.rotation.y) * 0.65;
    const z = player.position.z + Math.cos(player.rotation.y) * 0.65;
    const clear = canWalk({ x, z });
    return { x: clear ? x : player.position.x, y: 0.1, z: clear ? z : player.position.z };
  }

  private interactWithSurface() {
    const hasSelection = this.selected !== null;
    if (!hasSelection) {
      this.walkOnFloor();
      return;
    }
    const hit = this.raycaster.intersectObjects(this.surfaces, false)[0];
    const normal = hit?.face?.normal.clone().transformDirection(hit.object.matrixWorld);
    const horizontal = hit && normal && normal.y > 0.6;
    if (!horizontal || !hit) return;
    this.onPlace({ x: hit.point.x, y: hit.point.y + 0.015, z: hit.point.z });
  }

  rotate(direction: number) {
    this.angle = THREE.MathUtils.clamp(this.angle + direction * 0.14, -0.4, 0.35);
    this.positionCamera();
  }

  setEnemyVisible(enabled: boolean) {
    this.enemyEnabled = enabled;
    if (this.enemy) this.enemy.visible = enabled;
  }

  scatter(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    const object = this.objects.get(id);
    const origin = this.original.get(id);
    const home = this.initial.get(id);
    const canScatter = item?.placed && object && origin && home;
    if (!canScatter || !item || !object || !origin || !home) return false;
    origin.position.copy(home);
    const wasSelected = this.selected === id;
    if (wasSelected) this.clearSelection();
    this.physics?.grab(id);
    this.moves = this.moves.filter((move) => move.object !== object);
    object.visible = true;
    item.placed = false;
    this.moves.push({
      object,
      from: object.position.clone(),
      to: origin.position.clone(),
      scale: object.scale.clone(),
      toScale: origin.scale.clone(),
      started: performance.now(),
      hide: false,
    });
    if (this.enemy) {
      this.enemyFrom.copy(this.enemy.position);
      this.enemyTo.copy(origin.position);
      this.enemyUntil = performance.now() + 1800;
    }
    this.emit();
    return true;
  }

  autoPlan() {
    const targets: { point: Placement; label: string }[] = [];
    const ray = new THREE.Raycaster();
    for (const x of [-3.3, 0, 3.3]) {
      for (const z of [-2.8, -1, 0.8, 2.5]) {
        ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObjects(this.surfaces, false)[0];
        const normal = hit?.face?.normal.clone().transformDirection(hit.object.matrixWorld);
        const valid = hit && normal && normal.y > 0.6 && hit.point.y < 2.6;
        if (!valid || !hit) continue;
        targets.push({
          point: { x, y: hit.point.y + 0.015, z },
          label: String.fromCharCode(65 + targets.length),
        });
      }
    }
    const moves: AutoMove[] = [];
    const marks: { point: Placement; label: string }[] = [...targets];
    this.items.forEach((item, index) => {
      const object = this.objects.get(item.id);
      if (!object) return;
      const bounds = new THREE.Box3().setFromObject(object);
      marks.push({
        point: { x: object.position.x, y: bounds.max.y + 0.15, z: object.position.z },
        label: String(index + 1),
      });
      for (const target of targets) {
        const isSame =
          Math.hypot(object.position.x - target.point.x, object.position.z - target.point.z) <
            0.3 && Math.abs(bounds.min.y - target.point.y) < 0.2;
        if (isSame) continue;
        moves.push({
          id: `${item.id}__${target.label}`,
          itemId: item.id,
          point: target.point,
          description: `${index + 1}: ${item.label} (${object.position.x.toFixed(2)},${object.position.y.toFixed(2)},${object.position.z.toFixed(2)}) を ${target.label} (${target.point.x},${target.point.y.toFixed(2)},${target.point.z}) の平面に置く`,
        });
      }
    });
    return { moves, image: this.snapshot(marks) };
  }

  snapshot(marks: { point: Placement; label: string }[] = []) {
    const previous = this.camera.position.clone();
    const ringVisible = this.ring.visible;
    const playerVisible = this.playerObject?.visible ?? false;
    const enemyVisible = this.enemy?.visible ?? false;
    // Characters must not occlude clutter or be mistaken for belongings by the judge.
    if (this.playerObject) this.playerObject.visible = false;
    if (this.enemy) this.enemy.visible = false;
    try {
      this.camera.position.set(Math.sin(0.65) * 14.6, 11.2, Math.cos(0.65) * 14.6);
      this.camera.lookAt(0, 0.75, 0);
      this.ring.visible = false;
      this.renderer.render(this.scene, this.camera);
      const output = document.createElement("canvas");
      const source = this.renderer.domElement;
      const scale = Math.min(768 / source.width, 768 / source.height, 1);
      output.width = Math.round(source.width * scale);
      output.height = Math.round(source.height * scale);
      const context = output.getContext("2d");
      if (!context) throw new Error("画像を作成できませんでした。");
      context.fillStyle = "#f1eee5";
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(source, 0, 0, output.width, output.height);
      context.font = "bold 12px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const mark of marks) {
        const projected = new THREE.Vector3(mark.point.x, mark.point.y + 0.1, mark.point.z).project(
          this.camera,
        );
        const x = ((projected.x + 1) * output.width) / 2;
        const y = ((1 - projected.y) * output.height) / 2;
        context.fillStyle = /^\d+$/.test(mark.label) ? "#345b39" : "#8d4827";
        context.fillRect(x - 10, y - 10, 20, 20);
        context.fillStyle = "#ffffff";
        context.fillText(mark.label, x, y);
      }
      return output.toDataURL("image/jpeg", 0.85);
    } finally {
      this.camera.position.copy(previous);
      this.camera.lookAt(0, 0.75, 0);
      this.ring.visible = ringVisible;
      if (this.playerObject) this.playerObject.visible = playerVisible;
      if (this.enemy) this.enemy.visible = enemyVisible;
    }
  }

  reset() {
    this.resident?.reset();
    this.enemyUntil = 0;
    if (this.enemy) this.enemy.position.set(2.8, 0.75, 2.6);
    this.moves = [];
    this.clearSelection();
    for (const item of this.items) {
      item.placed = false;
      const object = this.objects.get(item.id);
      const origin = this.original.get(item.id);
      const home = this.initial.get(item.id);
      if (object && origin && home) {
        origin.position.copy(home);
        object.position.copy(origin.position);
        object.rotation.copy(origin.rotation);
        object.scale.copy(origin.scale);
        object.visible = true;
      }
    }
    this.physics?.reset();
    this.angle = 0;
    this.positionCamera();
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.physics?.dispose();
    this.scene.traverse((object) => {
      const isMesh = object instanceof THREE.Mesh;
      if (!isMesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.cursor.remove();
  }
}
