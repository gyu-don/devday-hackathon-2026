import { autoResultSchema } from "@devday/contracts";
import type { AutoMove, AutoRequest } from "@devday/contracts";

type Frame = { version: number; image: string; moves: AutoMove[]; tidyProbability: number };
export type AutoProgress = {
  turns: number;
  requests: number;
  bestProbability: number;
  stagnant: number;
  phase: "playing" | "clear" | "unfinished";
};
export const autoRequestLimit = 60;
const stagnationLimit = 8;
class ConnectionInterrupted extends Error {}
type Controls = {
  frame: () => Frame | null;
  version: () => number;
  complete: () => boolean;
  probability: () => number;
  visible: () => boolean;
  act: (move: AutoMove, signal: AbortSignal) => boolean | Promise<boolean>;
  status: (message: string) => void;
  end: () => void;
  progress?: (progress: AutoProgress) => void;
};

export class AutoPlayer {
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private history: string[] = [];
  private used = new Set<string>();
  private count = 0;
  private waits = 0;
  private requests = 0;
  private stagnant = 0;
  private best = -1;
  private progressMark = -1;
  private declines = 0;
  private pending: { move: AutoMove; before: number } | null = null;
  private reconnects = 0;

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

  private publish(phase: AutoProgress["phase"] = "playing") {
    this.controls.progress?.({
      turns: this.count,
      requests: this.requests,
      bestProbability: Math.max(0, this.best),
      stagnant: this.stagnant,
      phase,
    });
  }

  private remember(message: string) {
    this.history.push(message.slice(0, 400));
    this.history = this.history.slice(-10);
  }

  private observe(probability: number) {
    const improved = probability > this.progressMark + 0.01;
    if (improved) this.progressMark = probability;
    this.best = Math.max(this.best, probability);
    const pending = this.pending;
    if (pending) {
      this.stagnant = improved ? 0 : this.stagnant + 1;
      const delta = Math.round((probability - pending.before) * 100);
      this.remember(
        `${pending.move.id}: ${pending.move.description} / 判定 ${Math.round(pending.before * 100)}% → ${Math.round(probability * 100)}% (${delta > 0 ? "+" : ""}${delta}pt)`,
      );
      this.pending = null;
    }
    this.publish();
  }

  private finish(message: string, phase: AutoProgress["phase"] = "unfinished") {
    this.dispose();
    this.publish(phase);
    this.controls.status(message);
    this.controls.end();
  }

  private async turn() {
    if (this.stopped) return;
    const complete = this.controls.complete();
    if (complete) {
      this.observe(this.controls.probability());
      this.finish(`画像判定でクリア！ ${this.count}手で片付きました。`, "clear");
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
    this.observe(frame.tidyProbability);
    const stalled = this.stagnant >= stagnationLimit;
    if (stalled) {
      this.finish(
        "8手続けて最高確率を更新できませんでした。未クリアで中断。別の配置やモデルで再挑戦できます。",
      );
      return;
    }
    const overBudget = this.requests >= autoRequestLimit;
    if (overBudget) {
      this.finish(
        "自動判断60回の上限に到達しました。未クリアで中断。続けるには再挑戦してください。",
      );
      return;
    }
    const moves = frame.moves.filter((move) => !this.used.has(move.id));
    const hasMoves = moves.length > 0;
    if (!hasMoves) {
      this.finish("操作できる候補がなくなりました。");
      return;
    }
    this.controls.status(
      `クリアを目指して、次の配置を考えています… ${this.count}手 / 現在${Math.round(frame.tidyProbability * 100)}%`,
    );
    try {
      this.requests += 1;
      this.publish();
      const fetcher = this.fetcher;
      const response = await fetcher("/api/autoplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...this.config,
          image: frame.image,
          moves,
          history: this.history,
          tidyProbability: frame.tidyProbability,
        }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(50_000)]),
      });
      const interrupted = response.status === 503 || response.status === 504;
      if (interrupted) {
        await response.body?.cancel();
        throw new ConnectionInterrupted("自動操作の接続が一時的に中断されました。");
      }
      const data: unknown = await response.json().catch(() => {
        throw new ConnectionInterrupted("自動操作の応答を受信できませんでした。");
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
      const completed = this.controls.complete();
      if (completed) {
        this.observe(this.controls.probability());
        this.finish(`画像判定でクリア！ ${this.count}手で片付きました。`, "clear");
        return;
      }
      const stale = frame.version !== this.controls.version() || !this.controls.visible();
      if (stale) {
        this.finish("部屋の状態が変わったため、古い判断を破棄して停止しました。");
        return;
      }
      const result = autoResultSchema.parse(data);
      this.reconnects = 0;
      const stop = result.action === "stop";
      if (stop) {
        this.declines += 1;
        const unable = this.declines >= 3;
        if (unable) {
          this.finish("AI が3回続けて改善案を出せませんでした。未クリアで中断しました。");
          return;
        }
        this.remember(
          `未クリア (${Math.round(frame.tidyProbability * 100)}%) で stop を選択。別の物や配置で改善する操作を検討する。`,
        );
        this.controls.status("まだ未クリアです。別の片付け方を考え直します…");
        this.schedule();
        return;
      }
      const move = moves.find((candidate) => candidate.id === result.action);
      if (move) this.controls.status(`物の近くまで歩いて、配置します… ${move.description}`);
      const applied = move && (await this.controls.act(move, this.abort.signal));
      if (this.stopped) return;
      if (!applied || !move) throw new Error("選ばれた操作を実行できませんでした。");
      this.used.add(move.id);
      this.pending = { move, before: frame.tidyProbability };
      this.declines = 0;
      this.count += 1;
      this.publish();
      this.controls.status(
        `${this.count}手目: ${move.description} / 次の画像判定で効果を確認します。`,
      );
      this.schedule();
    } catch (cause) {
      if (this.stopped) return;
      const temporary = cause instanceof ConnectionInterrupted || cause instanceof TypeError;
      const retry = temporary && this.reconnects < 2;
      if (retry) {
        this.reconnects += 1;
        this.controls.status(
          `AIとの接続を再確認しています… ${this.reconnects}/2回。あなたはそのまま遊べます。`,
        );
        this.schedule(this.reconnects * 5000);
        return;
      }
      this.finish(cause instanceof Error ? cause.message : "自動操作を停止しました。");
    }
  }

  dispose() {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
  }
}
