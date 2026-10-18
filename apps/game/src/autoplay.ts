import { autoResultSchema } from "@devday/contracts";
import type { AutoMove, AutoRequest } from "@devday/contracts";

type Frame = { version: number; image: string; moves: AutoMove[] };
type Controls = {
  frame: () => Frame | null;
  version: () => number;
  complete: () => boolean;
  visible: () => boolean;
  act: (move: AutoMove) => boolean;
  status: (message: string) => void;
  end: () => void;
};

export class AutoPlayer {
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private history: string[] = [];
  private used = new Set<string>();
  private count = 0;
  private waits = 0;

  constructor(
    private config: Pick<AutoRequest, "mode" | "model" | "effort">,
    private controls: Controls,
    private fetcher: typeof fetch = fetch,
  ) {
    this.schedule(0);
  }

  private schedule(delay = 5000) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.turn(), delay);
  }

  private finish(message: string) {
    this.dispose();
    this.controls.status(message);
    this.controls.end();
  }

  private async turn() {
    if (this.stopped) return;
    const complete = this.controls.complete();
    if (complete) {
      this.finish("画像判定でクリア！自動操作を終了しました。");
      return;
    }
    const visible = this.controls.visible();
    if (!visible) {
      this.finish("タブが非表示になったため自動操作を停止しました。");
      return;
    }
    const frame = this.controls.frame();
    if (!frame) {
      this.waits += 1;
      const timedOut = this.waits >= 45;
      if (timedOut) {
        this.finish("物理や画像判定の待ち時間が長いため停止しました。");
        return;
      }
      this.controls.status("物理と画像判定が落ち着くのを待っています…");
      this.schedule(1000);
      return;
    }
    this.waits = 0;
    const moves = frame.moves.filter((move) => !this.used.has(move.id));
    const hasMoves = moves.length > 0;
    if (!hasMoves) {
      this.finish("操作できる候補がなくなりました。");
      return;
    }
    this.controls.status(`AI が画像を見て次の配置を選んでいます… ${this.count}/10手`);
    try {
      const fetcher = this.fetcher;
      const response = await fetcher("/api/autoplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.config, image: frame.image, moves, history: this.history }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(50_000)]),
      });
      const data: unknown = await response.json().catch(() => {
        throw new Error("自動操作の接続が中断されました。もう一度開始してください。");
      });
      if (this.stopped) return;
      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "自動操作の接続に失敗しました。";
        throw new Error(message);
      }
      const stale =
        frame.version !== this.controls.version() ||
        this.controls.complete() ||
        !this.controls.visible();
      if (stale) {
        this.finish("部屋の状態が変わったため、古い判断を破棄して停止しました。");
        return;
      }
      const result = autoResultSchema.parse(data);
      const stop = result.action === "stop";
      if (stop) {
        this.finish("AI が操作を終了しました。クリアは画像の確率判定で確認します。");
        return;
      }
      const move = moves.find((candidate) => candidate.id === result.action);
      const applied = move && this.controls.act(move);
      if (!applied || !move) throw new Error("選ばれた操作を実行できませんでした。");
      this.used.add(move.id);
      this.history.push(`${move.id}: ${move.description}`.slice(0, 400));
      this.count += 1;
      this.controls.status(`${this.count}/10手: ${move.description}`);
      const exhausted = this.count >= 10;
      if (exhausted) {
        this.finish("10手の自動操作が終わりました。最新の画像判定を確認してください。");
        return;
      }
      this.schedule();
    } catch (cause) {
      if (this.stopped) return;
      this.finish(cause instanceof Error ? cause.message : "自動操作を停止しました。");
    }
  }

  dispose() {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
  }
}
