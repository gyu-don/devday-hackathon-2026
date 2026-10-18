import type { Category } from "./types.ts";

interface HidDevice extends EventTarget {
  opened: boolean;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(id: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
}
type InputReport = Event & { reportId: number; data: DataView };
type HidApi = EventTarget & {
  requestDevice(options: {
    filters: { vendorId: number; productId: number }[];
  }): Promise<HidDevice[]>;
};

export function parseProReport(reportId: number, data: DataView) {
  const isFullReport = reportId === 0x30 && data.byteLength >= 48;
  if (!isFullReport) return null;
  const gyro = [18, 30, 42].reduce(
    (sum, offset) => ({
      x: sum.x + data.getInt16(offset, true) / 3,
      z: sum.z + data.getInt16(offset + 4, true) / 3,
    }),
    { x: 0, z: 0 },
  );
  const rawX = data.getUint8(5) | ((data.getUint8(6) & 0x0f) << 8);
  const rawY = (data.getUint8(6) >> 4) | (data.getUint8(7) << 4);
  const axis = (value: number) => {
    const normalized = Math.max(-1, Math.min(1, (value - 2048) / 1800));
    return Math.abs(normalized) < 0.15
      ? 0
      : (Math.sign(normalized) * (Math.abs(normalized) - 0.15)) / 0.85;
  };
  return {
    buttons: data.getUint8(2),
    plus: Boolean(data.getUint8(3) & 0x02),
    gyro,
    stick: { x: axis(rawX), y: axis(rawY) },
  };
}

export class ProController {
  private device: HidDevice | null = null;
  private abort = new AbortController();
  private counter = 0;
  private previousButtons = 0;
  private previousPlus = false;
  private pointer = { x: 0, y: 0 };
  private lastTime = 0;
  private lastReport = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private onPoint: (x: number, y: number, activate: boolean) => void;
  private onStore: (category: Category) => void;
  private onStatus: (message: string, connected: boolean) => void;

  constructor(
    onPoint: (x: number, y: number, activate: boolean) => void,
    onStore: (category: Category) => void,
    onStatus: (message: string, connected: boolean) => void,
  ) {
    this.onPoint = onPoint;
    this.onStore = onStore;
    this.onStatus = onStatus;
  }

  async connect() {
    const hid = (navigator as Navigator & { hid?: HidApi }).hid;
    if (!hid)
      throw new Error("プロコン操作はデスクトップ版 Chrome の HTTPS または localhost で使えます。");
    const [device] = await hid.requestDevice({
      filters: [{ vendorId: 0x057e, productId: 0x2009 }],
    });
    if (!device) return false;
    this.device = device;
    try {
      if (!device.opened) await device.open();
      this.onStatus("プロコンを初期化しています…", false);
      // USB handshakes are required; Bluetooth-only setup leaves the Pro Controller asleep.
      for (const command of [0x01, 0x02, 0x03, 0x02]) {
        const bytes = new Uint8Array(63);
        bytes[0] = command;
        await this.exchange(
          0x80,
          bytes,
          (report) =>
            report.reportId === 0x81 &&
            report.data.byteLength > 0 &&
            report.data.getUint8(0) === command,
        );
      }
      const usbOnly = new Uint8Array(63);
      usbOnly[0] = 0x04;
      await device.sendReport(0x80, usbOnly);
      await this.subcommand(0x40, 0x01);
      await this.subcommand(0x03, 0x30);
      this.recenter();
      device.addEventListener("inputreport", (event) => this.handle(event as InputReport), {
        signal: this.abort.signal,
      });
      hid.addEventListener(
        "disconnect",
        (event) => {
          const isOurs = "device" in event && event.device === device;
          if (!isOurs) return;
          this.onStatus("プロコンが外れました。マウス・タッチ操作を続けられます。", false);
          void this.disconnect();
        },
        { signal: this.abort.signal },
      );
      this.lastReport = performance.now();
      this.watchdog = setInterval(() => {
        const timedOut = performance.now() - this.lastReport > 3000;
        if (!timedOut) return;
        this.onStatus(
          "プロコンの入力が止まりました。USB ケーブルを確認して再接続してください。",
          false,
        );
        void this.disconnect();
      }, 1000);
      this.onStatus(
        "左スティックで照準、A で選択。X：本棚 / Y：服 / B：ごみ / R：人形。＋で照準を中央に戻せます。",
        true,
      );
      return true;
    } catch {
      await this.disconnect();
      throw new Error(
        "USB の初期化に失敗しました。データ対応ケーブルでつなぎ直し、Steam などコントローラーを使うアプリを閉じて試してください。",
      );
    }
  }

  private exchange(
    id: number,
    bytes: Uint8Array<ArrayBuffer>,
    matches: (report: InputReport) => boolean,
  ) {
    const device = this.device;
    if (!device) return Promise.reject(new Error("Not connected"));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        device.removeEventListener("inputreport", listener);
      };
      const listener = (event: Event) => {
        const report = event as InputReport;
        const isExpected = matches(report);
        if (!isExpected) return;
        cleanup();
        resolve();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Controller handshake timeout"));
      }, 1800);
      device.addEventListener("inputreport", listener);
      device.sendReport(id, bytes).catch((error: unknown) => {
        cleanup();
        reject(error);
      });
    });
  }

  private subcommand(command: number, value: number) {
    const bytes = new Uint8Array(63);
    bytes.set([this.counter++ & 0x0f, 0, 1, 0x40, 0x40, 0, 1, 0x40, 0x40, command, value]);
    return this.exchange(
      0x01,
      bytes,
      (report) =>
        report.reportId === 0x21 &&
        report.data.byteLength >= 14 &&
        report.data.getUint8(13) === command &&
        Boolean(report.data.getUint8(12) & 0x80),
    );
  }

  recenter() {
    this.pointer = { x: 0, y: 0 };
    this.lastTime = 0;
    this.onPoint(0, 0, false);
  }

  private handle(event: InputReport) {
    const packet = parseProReport(event.reportId, event.data);
    if (!packet) return;
    this.lastReport = performance.now();
    const now = performance.now();
    const elapsed = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;
    this.pointer.x = Math.max(
      -0.92,
      Math.min(0.92, this.pointer.x + packet.stick.x * elapsed * 1.15),
    );
    this.pointer.y = Math.max(
      -0.85,
      Math.min(0.85, this.pointer.y + packet.stick.y * elapsed * 1.15),
    );
    const pressed = packet.buttons & ~this.previousButtons;
    this.previousButtons = packet.buttons;
    const activate = Boolean(pressed & 0x08);
    this.onPoint(this.pointer.x, this.pointer.y, activate);
    const toBooks = Boolean(pressed & 0x02);
    const toLaundry = Boolean(pressed & 0x01);
    const toTrash = Boolean(pressed & 0x04);
    const toDolls = Boolean(pressed & 0x40);
    if (toBooks) this.onStore("books");
    if (toLaundry) this.onStore("laundry");
    if (toTrash) this.onStore("trash");
    if (toDolls) this.onStore("dolls");
    const recenterPressed = packet.plus && !this.previousPlus;
    this.previousPlus = packet.plus;
    if (recenterPressed) this.recenter();
  }

  async disconnect() {
    this.abort.abort();
    if (this.watchdog) clearInterval(this.watchdog);
    const device = this.device;
    this.device = null;
    if (!device?.opened) return;
    try {
      const restoreUsbTimeout = new Uint8Array(63);
      restoreUsbTimeout[0] = 0x05;
      await device.sendReport(0x80, restoreUsbTimeout);
    } catch {
      /* A physically disconnected controller cannot receive the restore command. */
    }
    await device.close().catch(() => {});
  }
}
