import { useCallback, useEffect, useRef, useState } from "react";
import { enemyEfforts, enemyModels } from "@devday/contracts";
import type { EnemySettings } from "@devday/contracts";
import { DuelArena } from "./DuelArena.tsx";
import { duelDuration, duelWinner, emptyDuelScore } from "./duel.ts";
import type { DuelSide, DuelScore } from "./duel.ts";

type Phase = "ready" | "countdown" | "playing" | "finished";

export function DuelGame({ onPractice }: { onPractice: () => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState({ human: false, ai: false });
  const [scores, setScores] = useState({ human: emptyDuelScore(), ai: emptyDuelScore() });
  const [result, setResult] = useState("");
  const [settings, setSettings] = useState<EnemySettings>({ model: "gpt-6-luna", effort: "low" });
  const live = useRef({ phase, startAt, scores });
  live.current = { phase, startAt, scores };
  const locked = phase === "playing" || phase === "countdown";

  const finish = useCallback((winner: DuelSide | "draw" | null, interrupted = false) => {
    const message = interrupted
      ? "対戦を中断しました。勝敗はつきません。"
      : winner === "human"
        ? "YOU WIN! あなたの勝ち！"
        : winner === "ai"
          ? "AI WINS! AIの勝ち！もう一度挑もう。"
          : "DRAW! 引き分け。";
    live.current.phase = "finished";
    setResult(message);
    setPhase("finished");
  }, []);
  const update = useCallback(
    (side: DuelSide, score: DuelScore) => {
      const current = live.current;
      const stopped = current.phase === "finished";
      if (stopped) return;
      const next = { ...current.scores, [side]: score };
      live.current.scores = next;
      setScores(next);
      const playing = current.phase === "playing";
      if (!playing) return;
      const winner = duelWinner(next.human, next.ai, false);
      if (winner) finish(winner);
    },
    [finish],
  );
  const markReady = useCallback((side: DuelSide, isReady: boolean) => {
    setReady((previous) => ({ ...previous, [side]: isReady }));
  }, []);

  useEffect(() => {
    if (!locked || startAt === null) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const starting = live.current.phase === "countdown" && time >= startAt;
      if (starting) {
        live.current.phase = "playing";
        setPhase("playing");
      }
      const expired = live.current.phase === "playing" && time >= startAt + duelDuration;
      if (expired) finish(duelWinner(live.current.scores.human, live.current.scores.ai, true));
    };
    tick();
    const timer = setInterval(tick, 200);
    const hidden = () => {
      if (document.hidden) finish(null, true);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [locked, startAt, finish]);

  const start = () => {
    const time = Date.now();
    const fresh = { human: emptyDuelScore(), ai: emptyDuelScore() };
    live.current = { phase: "countdown", startAt: time + 3000, scores: fresh };
    setScores(fresh);
    setStartAt(time + 3000);
    setNow(time);
    setResult("");
    setRound((value) => value + 1);
    setPhase("countdown");
  };
  const seconds = Math.max(
    0,
    Math.ceil((duelDuration - Math.max(0, now - (startAt ?? now))) / 1000),
  );
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const countdown = Math.max(1, Math.ceil(((startAt ?? now) - now) / 1000));

  return (
    <div className="duel-page">
      <header className="duel-header">
        <a href="/">ひと息、片づけ。</a>
        <button disabled={locked} onClick={onPractice}>
          ひとり練習
        </button>
      </header>
      <main>
        <div className="duel-intro">
          <p>HUMAN vs AI · ROOM CLEANUP BATTLE</p>
          <h1>片付け、AIよりうまい？</h1>
          <p>左はあなた、右はAI。同じ部屋、同じ散らかりから、よーいスタート。</p>
        </div>
        <section className="duel-match" aria-label="対戦ルールとスコア">
          <div className="duel-match-top">
            <div>
              <span className="duel-kicker">3分間の片付け対決</span>
              <h2>
                {phase === "countdown"
                  ? `${countdown}…`
                  : phase === "playing"
                    ? "先に80%を目指そう！"
                    : phase === "finished"
                      ? result
                      : "あなた vs 画像を見て考えるAI"}
              </h2>
            </div>
            <div className="duel-clock" aria-label="残り時間">
              {clock}
            </div>
          </div>
          <p>
            先に画像判定80%で勝利。時間切れは最高確率で勝負。同点なら引き分け。物を置いた回数が手数です。
          </p>
          <div className="duel-match-actions">
            <button
              className="duel-start"
              disabled={locked || !ready.human || !ready.ai}
              onClick={start}
            >
              {phase === "finished"
                ? "同じ部屋でもう一勝負"
                : ready.human && ready.ai
                  ? "対戦スタート"
                  : "2つの部屋を準備中…"}
            </button>
            {locked && <button onClick={() => finish(null, true)}>対戦を中断</button>}
          </div>
          {phase === "finished" && (
            <div className="duel-result" role="status">
              <strong>{result}</strong>
              <span>
                あなた 最高{Math.round(scores.human.best * 100)}%・{scores.human.moves}手　/　AI
                最高{Math.round(scores.ai.best * 100)}%・{scores.ai.moves}手
              </span>
            </div>
          )}
          <details className="duel-rules">
            <summary>相手の作戦・あそびかた</summary>
            <div className="duel-settings">
              <label>
                AIのモデル
                <select
                  value={settings.model}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      model: event.target.value as EnemySettings["model"],
                    }))
                  }
                >
                  {enemyModels.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </label>
              <label>
                AIのeffort
                <select
                  value={settings.effort}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      effort: event.target.value as EnemySettings["effort"],
                    }))
                  }
                >
                  {enemyEfforts.map((effort) => (
                    <option key={effort}>{effort}</option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              物を選び、床や机などの平面へ置こう。決まった収納先はありません。配置を工夫して確率を上げるとコンボと得点！
            </p>
            <p>
              AIは自分の部屋の画像をOpenAI Agents APIに送り、配置を判断。審判は両者とも同じDecisions
              APIです。最高確率は返ってきた最新状態の有効な判定から記録します。終了後に届いた結果は勝敗に使いません。
            </p>
            <p>
              両者の部屋は独立し、同じGLBの初期状態から毎回リセットします。対戦中は敵・自動操作の手動介入なし。タブを隠すと公平のため対戦を中断します。AIが停滞・エラーで中断しても、あなたは時間内で挑戦できます。
            </p>
          </details>
        </section>
        <div className="duel-rooms">
          <DuelArena
            side="human"
            round={round}
            startAt={startAt}
            playing={phase === "playing"}
            settings={settings}
            onScore={update}
            onReady={markReady}
          />
          <DuelArena
            side="ai"
            round={round}
            startAt={startAt}
            playing={phase === "playing"}
            settings={settings}
            onScore={update}
            onReady={markReady}
          />
        </div>
        <footer className="duel-footer">
          Agentsが考える。Decisionsが画像で判定する。あなたは、どう片付ける？
          <br />
          ゲーム画面と配置・判定履歴をOpenAIに送信します。
        </footer>
      </main>
    </div>
  );
}
