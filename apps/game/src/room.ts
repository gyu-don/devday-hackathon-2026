import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Category, Item, RoomState } from "./types.ts";

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
  private zones = new Map<Category, THREE.Object3D>();
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
  private onAttempt: (category: Category) => void;
  private abort = new AbortController();
  private cursor = document.createElement("span");
  private enemy: THREE.Object3D | null = null;
  private enemyEnabled = false;
  private enemyUntil = 0;
  private enemyFrom = new THREE.Vector3();
  private enemyTo = new THREE.Vector3();

  constructor(
    host: HTMLElement,
    onState: (state: RoomState) => void,
    onAttempt: (category: Category) => void,
    onError: () => void,
  ) {
    this.onState = onState;
    this.onAttempt = onAttempt;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "小さな部屋。物を選び、本棚・バスケット・ごみ箱へ戻してください。下の一覧からも操作できます。",
    );
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
        const isZone = target?.userData.kind === "zone";
        if (isItem && target) this.select(target.name);
        if (isZone && target) this.onAttempt(target.userData.category as Category);
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
          const isZone = object.userData.kind === "zone";
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
              stored: false,
            });
          }
          if (isZone) this.zones.set(object.userData.category as Category, object);
        });
        this.items.sort((a, b) => a.id.localeCompare(b.id));
        this.scene.add(gltf.scene);
        this.emit();
      },
      undefined,
      () => onError(),
    );

    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      this.moves = this.moves.filter((move) => {
        const progress = this.reducedMotion.matches ? 1 : Math.min((now - move.started) / 600, 1);
        const eased = 1 - (1 - progress) ** 3;
        move.object.position.lerpVectors(move.from, move.to, eased);
        move.object.position.y += Math.sin(progress * Math.PI) * 1.6;
        move.object.scale.lerpVectors(move.scale, move.toScale, progress);
        const isFinished = progress === 1;
        if (isFinished && move.hide) move.object.visible = false;
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
        const origin = this.original.get(selected.name);
        if (origin)
          selected.position.y =
            origin.position.y +
            (this.reducedMotion.matches ? 0.16 : 0.2 + Math.sin(now / 220) * 0.04);
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
    const available = this.items
      .filter((item) => !item.stored)
      .flatMap((item) => this.objects.get(item.id) ?? []);
    const hits = this.raycaster.intersectObjects([...available, ...this.zones.values()], true);
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
    const isZone = target?.userData.kind === "zone";
    if (isItem && target) this.select(target.name);
    if (isZone && target) this.onAttempt(target.userData.category as Category);
  }

  disableAim() {
    this.cursor.hidden = true;
  }

  select(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    const canSelect = item && !item.stored;
    if (!canSelect) return;
    this.clearSelection();
    this.moves = this.moves.filter((move) => move.object.name !== id);
    this.selected = id;
    this.ring.visible = true;
    this.emit();
  }

  private clearSelection() {
    const previous = this.selected ? this.objects.get(this.selected) : undefined;
    const origin = previous ? this.original.get(previous.name) : undefined;
    if (previous && origin) previous.position.copy(origin.position);
    this.selected = null;
    this.ring.visible = false;
  }

  store(category: Category) {
    const item = this.items.find((candidate) => candidate.id === this.selected);
    const isCorrect = item && !item.stored && item.category === category;
    if (!isCorrect || !item) return false;
    const object = this.objects.get(item.id);
    if (!object) return false;
    const count = this.items.filter(
      (candidate) => candidate.stored && candidate.category === category,
    ).length;
    const destinations = {
      books: new THREE.Vector3(-2.9 + count * 0.24, 1.65, -2.96),
      laundry: new THREE.Vector3(3.45, 0.62 + count * 0.07, 1.9),
      trash: new THREE.Vector3(-3.5, 0.35, 1.85),
      dolls: new THREE.Vector3(-1.9, 2.33, -2.96),
    };
    this.moves.push({
      object,
      from: object.position.clone(),
      to: destinations[category],
      scale: object.scale.clone(),
      toScale: (this.original.get(item.id)?.scale.clone() ?? object.scale.clone()).multiplyScalar(
        0.65,
      ),
      started: performance.now(),
      hide: category === "trash",
    });
    item.stored = true;
    this.selected = null;
    this.ring.visible = false;
    this.emit();
    return true;
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
    const canScatter = item?.stored && object && origin;
    if (!canScatter || !item || !object || !origin) return false;
    this.moves = this.moves.filter((move) => move.object !== object);
    object.visible = true;
    item.stored = false;
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

  snapshot() {
    const previous = this.camera.position.clone();
    const ringVisible = this.ring.visible;
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
    this.camera.position.copy(previous);
    this.camera.lookAt(0, 0.75, 0);
    this.ring.visible = ringVisible;
    return output.toDataURL("image/jpeg", 0.85);
  }

  reset() {
    this.enemyUntil = 0;
    if (this.enemy) this.enemy.position.set(2.8, 0.75, 2.6);
    this.moves = [];
    this.clearSelection();
    for (const item of this.items) {
      item.stored = false;
      const object = this.objects.get(item.id);
      const origin = this.original.get(item.id);
      if (object && origin) {
        object.position.copy(origin.position);
        object.rotation.copy(origin.rotation);
        object.scale.copy(origin.scale);
        object.visible = true;
      }
    }
    this.angle = 0;
    this.positionCamera();
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
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
