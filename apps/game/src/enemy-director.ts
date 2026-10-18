import { enemyActionSchema } from "@devday/contracts";
import type { EnemySettings } from "@devday/contracts";
import type { Item } from "./types.ts";

export class EnemyDirector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort = new AbortController();
  private disposed = false;

  constructor(
    private settings: EnemySettings,
    private snapshot: () => { items: Item[]; combo: number; complete: boolean },
    private act: (itemId: string, quip: string, remaining: number) => void,
    private status: (message: string) => void,
    private fail: (message: string) => void,
    private remaining = 5,
    private fetcher: typeof fetch = fetch,
  ) {
    this.schedule();
  }

  private schedule() {
    if (this.disposed) return;
    this.timer = setTimeout(() => void this.turn(), 12_000);
  }

  private async turn() {
    const { items, combo, complete } = this.snapshot();
    const hasBudget = this.remaining > 0;
    if (this.disposed || complete || !hasBudget) return;
    const hasTargets = items.some((item) => item.placed);
    const canRun = hasTargets && !document.hidden;
    if (!canRun) {
      this.schedule();
      return;
    }
    this.status("ちらかしが作戦を考えています…");
    try {
      const fetcher = this.fetcher;
      const response = await fetcher("/api/enemy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.settings, items, combo, attacksLeft: this.remaining }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(50_000)]),
      });
      const data: unknown = await response.json();
      if (this.disposed) return;
      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "敵に接続できませんでした。";
        throw new Error(message);
      }
      const action = enemyActionSchema.parse(data);
      const { items: current, complete: isComplete } = this.snapshot();
      const isCurrentTarget = current.some((item) => item.id === action.itemId && item.placed);
      const canApply = !isComplete && isCurrentTarget && !document.hidden;
      if (canApply) {
        this.remaining -= 1;
        this.act(action.itemId, action.quip, this.remaining);
      }
      this.schedule();
    } catch (cause) {
      if (this.disposed) return;
      this.fail(cause instanceof Error ? cause.message : "敵の行動を取得できませんでした。");
    }
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
  }
}
