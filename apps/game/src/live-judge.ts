export class LiveJudge {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pending = false;
  private enabled = true;
  private lastRun = Number.NEGATIVE_INFINITY;

  constructor(private run: () => Promise<void>) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) return;
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  request() {
    if (!this.enabled) return;
    this.pending = true;
    if (this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(850, 5000 - (Date.now() - this.lastRun));
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.enabled) return;
      this.pending = false;
      this.running = true;
      this.lastRun = Date.now();
      try {
        await this.run();
      } finally {
        this.running = false;
        if (this.pending && this.enabled) this.request();
      }
    }, delay);
  }

  dispose() {
    this.setEnabled(false);
  }
}
