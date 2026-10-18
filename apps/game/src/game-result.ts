import type { GameResultSubmission } from "@devday/contracts";
import { duelDuration } from "./duel.ts";
import type { DuelScore, DuelSide } from "./duel.ts";

export function duelResultSubmission(
  eventId: string,
  winner: DuelSide | "draw",
  scores: { human: DuelScore; ai: DuelScore },
  startAt: number,
  endedAt: number,
): GameResultSubmission {
  const outcome = winner === "human" ? "AIに勝利" : winner === "ai" ? "AIに敗北" : "AIと引き分け";
  const clear = scores.human.clearAt !== null || scores.ai.clearAt !== null;
  const reason = clear ? "画像判定80%以上達成で決着" : "3分の時間切れ、最高確率で決着";
  const record = (score: DuelScore) =>
    `${score.current === null ? "未判定" : `最高${Math.round(score.best * 100)}%`}・${score.moves}手`;
  const seconds = Math.round(Math.max(0, Math.min(duelDuration, endedAt - startAt)) / 1000);
  return {
    eventId,
    timestamp: new Date(endedAt).toISOString(),
    summary: `片付け対戦で${outcome}。${reason}。あなたは${record(scores.human)}、AIは${record(scores.ai)}。経過${seconds}秒。`,
  };
}

export async function sendGameResult(result: GameResultSubmission): Promise<void> {
  // 試合IDをeventIdとして再利用し、ブラウザーの再試行でも同じ結果を二重登録しない。
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch("/api/game-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(10_000),
        keepalive: true,
      });
      if (response.ok) return;
    } catch {
      // タイムアウト・通信エラーは同じイベントIDで再試行する。
    }
    const permanent = response && response.status < 500 && response.status !== 429;
    if (permanent || attempt === 2) throw new Error("ゲーム結果を通知できませんでした。");
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}
