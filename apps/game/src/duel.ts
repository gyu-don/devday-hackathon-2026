export const duelDuration = 180_000;
export type DuelSide = "human" | "ai";
export type DuelScore = {
  current: number | null;
  best: number;
  moves: number;
  clearAt: number | null;
  points: number;
  combo: number;
  status: string;
};
export const emptyDuelScore = (): DuelScore => ({
  current: null,
  best: 0,
  moves: 0,
  clearAt: null,
  points: 0,
  combo: 0,
  status: "準備中",
});

export function duelWinner(
  human: DuelScore,
  ai: DuelScore,
  expired: boolean,
): DuelSide | "draw" | null {
  const humanClear = human.clearAt !== null;
  const aiClear = ai.clearAt !== null;
  if (humanClear && aiClear) {
    const tie = human.clearAt === ai.clearAt;
    if (tie) return "draw";
    return human.clearAt! < ai.clearAt! ? "human" : "ai";
  }
  if (humanClear) return "human";
  if (aiClear) return "ai";
  if (!expired) return null;
  const left = Math.round(human.best * 100);
  const right = Math.round(ai.best * 100);
  const tie = left === right;
  if (tie) return "draw";
  return left > right ? "human" : "ai";
}
