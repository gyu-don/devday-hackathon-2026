import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveJudge } from "../apps/game/src/live-judge.ts";

afterEach(() => vi.useRealTimers());

describe("ライブ診断", () => {
  it("連続操作をまとめ、前回の送信から5秒以上空ける", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const judge = new LiveJudge(run);
    judge.request();
    await vi.advanceTimersByTimeAsync(400);
    judge.request();
    await vi.advanceTimersByTimeAsync(849);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    judge.request();
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    judge.dispose();
  });

  it("判定中の操作は最新状態の1回へまとめ、同時リクエストを出さない", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const judge = new LiveJudge(run);
    judge.request();
    await vi.advanceTimersByTimeAsync(850);
    judge.request();
    judge.request();
    await vi.advanceTimersByTimeAsync(8000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(850);
    expect(run).toHaveBeenCalledTimes(2);
    judge.dispose();
  });

  it("OFF または画面終了後に予約した診断を送信しない", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const judge = new LiveJudge(run);
    judge.request();
    judge.setEnabled(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).not.toHaveBeenCalled();
    judge.setEnabled(true);
    judge.request();
    judge.dispose();
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).not.toHaveBeenCalled();
  });
});
