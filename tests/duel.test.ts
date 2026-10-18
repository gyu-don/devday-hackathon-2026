import { describe, expect, it } from "vitest";
import { duelWinner, emptyDuelScore } from "../apps/game/src/duel.ts";

describe("同じ部屋の片付け対決", () => {
  it("開始前のスコアを共有せず、物の移動数だけでは勝敗を決めない", () => {
    const human = emptyDuelScore();
    const ai = emptyDuelScore();
    human.moves = 13;
    expect(ai.moves).toBe(0);
    expect(duelWinner(human, ai, false)).toBeNull();
  });
  it("先に画像でクリアした側を勝者にし、同時なら引き分ける", () => {
    const human = { ...emptyDuelScore(), clearAt: 1000 };
    const ai = emptyDuelScore();
    expect(duelWinner(human, ai, false)).toBe("human");
    expect(duelWinner(ai, human, false)).toBe("ai");
    expect(duelWinner(human, { ...ai, clearAt: 1001 }, false)).toBe("human");
    expect(duelWinner(human, { ...ai, clearAt: 1000 }, false)).toBe("draw");
  });
  it("時間切れは表示と同じ整数の最高確率で比較し、得点や手数を勝率に見せない", () => {
    const human = { ...emptyDuelScore(), current: 0.2, best: 0.6, points: 0 };
    const ai = { ...emptyDuelScore(), current: 0.5, best: 0.5, points: 9999 };
    expect(duelWinner(human, ai, false)).toBeNull();
    expect(duelWinner(human, ai, true)).toBe("human");
    expect(duelWinner(ai, human, true)).toBe("ai");
    expect(duelWinner(human, { ...ai, best: 0.601 }, true)).toBe("draw");
  });
});
