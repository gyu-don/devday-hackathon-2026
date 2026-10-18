import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { enemyEfforts, enemyModels, enemySettingsSchema } from "@devday/contracts";
import type { AutoMove, EnemySettings, AutoDecision } from "@devday/contracts";
import { DecisionMap } from "./DecisionMap.tsx";
import type { AutoProgress } from "./autoplay.ts";
import type { Room } from "./room.ts";
import { AutoPlayer } from "./autoplay.ts";

type Props = {
  room: RefObject<Room | null>;
  ready: boolean;
  judging: boolean;
  assessedVersion: number;
  version: RefObject<number>;
  complete: boolean;
  tidyProbability: number;
  onStart: () => void;
  onAction: () => void;
  stopRef: RefObject<() => void>;
};

export function AutoPlayPanel(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const panel = useRef<HTMLDivElement>(null);
  const director = useRef<AutoPlayer | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"decisions" | "agents">("decisions");
  const [settings, setSettings] = useState<EnemySettings>({ model: "gpt-6-luna", effort: "low" });
  const [message, setMessage] = useState("AI に画像を見せて、片付けを任せてみよう。");
  const [progress, setProgress] = useState<AutoProgress | null>(null);
  const [decision, setDecision] = useState<AutoDecision | null>(null);

  const stop = () => {
    const current = director.current;
    const active = current !== null;
    if (!active) return;
    current.dispose();
    director.current = null;
    latest.current.room.current?.stopPlayer();
    setRunning(false);
    setProgress((previous) => (previous ? { ...previous, phase: "unfinished" } : null));
    setMessage("自動操作を停止しました。手動で操作できます。");
  };
  props.stopRef.current = stop;

  useEffect(() => {
    if (!running) return;
    const player = new AutoPlayer(
      { mode, ...settings },
      {
        frame: () => {
          const current = latest.current;
          const room = current.room.current;
          const ready =
            current.ready &&
            room &&
            !room.isSettling() &&
            !current.judging &&
            current.assessedVersion === current.version.current;
          if (!ready || !room) return null;
          return {
            version: current.version.current,
            tidyProbability: current.tidyProbability,
            ...room.autoPlan(),
          };
        },
        version: () => latest.current.version.current,
        complete: () => latest.current.complete,
        probability: () => latest.current.tidyProbability,
        visible: () => !document.hidden,
        act: async (move: AutoMove, signal) => {
          const room = latest.current.room.current;
          if (!room) return false;
          const arrived = await room.approachItem(move.itemId, signal);
          const allowed = arrived && !signal.aborted;
          if (!allowed) return false;
          const success = await room.deliver(move.point, signal);
          if (success) latest.current.onAction();
          return success;
        },
        status: setMessage,
        end: () => setRunning(false),
        progress: setProgress,
        decision: setDecision,
      },
    );
    director.current = player;
    const manual = (event: Event) => {
      const target = event.target;
      const inPanel = target instanceof Node && panel.current?.contains(target);
      if (inPanel) return;
      stop();
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("pointerdown", manual, true);
    window.addEventListener("keydown", manual, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      player.dispose();
      director.current = null;
      window.removeEventListener("pointerdown", manual, true);
      window.removeEventListener("keydown", manual, true);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [running, mode, settings]);

  return (
    <div className="autoplay-card" ref={panel}>
      <div className="enemy-heading">
        <h2>AI 片付けチャレンジ</h2>
        <button
          type="button"
          disabled={!running && (!props.ready || props.complete)}
          onClick={() => {
            if (running) {
              stop();
              return;
            }
            props.onStart();
            setProgress(null);
            setDecision(null);
            setRunning(true);
          }}
        >
          {running ? "自動操作を停止" : "自動操作を開始"}
        </button>
      </div>
      <p>ミッション：画像判定80%を目指そう。AIは配置の結果を振り返り、次の一手を変えます。</p>
      <details className="autoplay-settings">
        <summary>
          AIの作戦設定 ·{" "}
          {mode === "decisions" ? "Decisions" : `${settings.model} / ${settings.effort}`}
        </summary>
        <label htmlFor="autoplay-mode">操作を決める API</label>
        <select
          id="autoplay-mode"
          value={mode}
          disabled={running}
          onChange={(event) => setMode(event.target.value === "agents" ? "agents" : "decisions")}
        >
          <option value="decisions">Decisions API · 200区画の確率で判断</option>
          <option value="agents">Agents API · 画像と状態から判断</option>
        </select>
        {mode === "agents" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setSettings(
                enemySettingsSchema.parse({ model: form.get("model"), effort: form.get("effort") }),
              );
            }}
          >
            <label htmlFor="autoplay-model">自動操作のモデル</label>
            <select
              id="autoplay-model"
              name="model"
              disabled={running}
              defaultValue={settings.model}
            >
              {enemyModels.map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
            <label htmlFor="autoplay-effort">自動操作の effort</label>
            <select
              id="autoplay-effort"
              name="effort"
              disabled={running}
              defaultValue={settings.effort}
            >
              {enemyEfforts.map((effort) => (
                <option key={effort}>{effort}</option>
              ))}
            </select>
            <button type="submit" disabled={running}>
              自動操作の設定を反映
            </button>
            <small>
              適用中: {settings.model} / {settings.effort}
            </small>
          </form>
        )}
      </details>
      <p role="status">{message}</p>
      {mode === "decisions" && decision && <DecisionMap decision={decision} />}
      {progress && (
        <div className="autoplay-progress" aria-label="AIチャレンジの記録">
          <span>{progress.turns}手</span>
          <span>最高 {Math.round(progress.bestProbability * 100)}%</span>
          <span>判断 {progress.requests}/60回</span>
          <strong>
            {progress.phase === "clear"
              ? "CLEAR!"
              : progress.phase === "unfinished"
                ? "未クリアで中断"
                : "挑戦中"}
          </strong>
        </div>
      )}
      <small>
        10手では止まらず、クリアまで改善を試します。8手停滞・改善案なし3回・判断60回・通信エラーで未クリアのまま中断。
        画像・候補・判定履歴を OpenAI
        に送信。配置後は物理と画像判定を待ち、手動操作・タブ非表示で停止します。
      </small>
    </div>
  );
}
