import { useCallback, useEffect, useRef, useState } from "react";
import { assessmentSchema, tidyThreshold } from "@devday/contracts";
import type { EnemySettings, AutoDecision } from "@devday/contracts";
import { DecisionMap } from "./DecisionMap.tsx";
import { Room } from "./room.ts";
import { AutoPlayer } from "./autoplay.ts";
import { LiveJudge } from "./live-judge.ts";
import { ProController } from "./pro-controller.ts";
import { duelDuration, emptyDuelScore } from "./duel.ts";
import type { DuelSide, DuelScore } from "./duel.ts";
import type { Placement, RoomState } from "./types.ts";

type Props = {
  side: DuelSide;
  round: number;
  startAt: number | null;
  playing: boolean;
  settings: EnemySettings;
  mode: "decisions" | "agents";
  onScore: (side: DuelSide, score: DuelScore) => void;
  onReady: (side: DuelSide, ready: boolean) => void;
};

export function DuelArena(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const room = useRef<Room | null>(null);
  const score = useRef(emptyDuelScore());
  const version = useRef(0);
  const assessed = useRef(-1);
  const request = useRef<AbortController | null>(null);
  const judging = useRef(false);
  const queue = useRef<LiveJudge | null>(null);
  const judgeRef = useRef<() => Promise<void>>(async () => {});
  const controller = useRef<ProController | null>(null);
  const ready = useRef(false);
  const lastAward = useRef(-1);
  const lastGain = useRef(0);
  const action = useRef<AbortController | null>(null);
  const [view, setView] = useState(emptyDuelScore());
  const [state, setState] = useState<RoomState>({ items: [], selected: null, ready: false });
  const [note, setNote] = useState("部屋を準備しています…");
  const [deviceNote, setDeviceNote] = useState("Switch ProCon1（USB接続）に対応");
  const [connected, setConnected] = useState(false);
  const [decision, setDecision] = useState<AutoDecision | null>(null);
  const human = props.side === "human";
  const active = props.playing && view.clearAt === null;

  const publish = useCallback((patch: Partial<DuelScore>) => {
    score.current = { ...score.current, ...patch };
    setView(score.current);
    latest.current.onScore(latest.current.side, score.current);
  }, []);
  const changed = useCallback(() => {
    version.current += 1;
    assessed.current = -1;
    queue.current?.request();
  }, []);
  const place = useCallback(
    async (point: Placement, signal?: AbortSignal) => {
      const allowed = latest.current.playing && score.current.clearAt === null;
      if (!allowed) return false;
      const current = room.current;
      if (!current || action.current) return false;
      const abort = new AbortController();
      action.current = abort;
      setNote("取りに行って、置き場所まで運んでいます…");
      const success = await current.deliver(
        point,
        signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
      );
      const same = action.current === abort;
      if (same) action.current = null;
      const active = success && !abort.signal.aborted && latest.current.playing;
      if (!active) return false;
      publish({ moves: score.current.moves + 1 });
      changed();
      setNote("配置したよ！物が落ち着いたら画像で判定します。");
      return true;
    },
    [changed, publish],
  );
  const drop = useCallback(() => {
    const point = room.current?.dropPoint();
    if (point) void place(point);
  }, [place]);

  judgeRef.current = async () => {
    const current = room.current;
    const canJudge =
      current &&
      ready.current &&
      !judging.current &&
      latest.current.playing &&
      assessed.current !== version.current;
    if (!canJudge || !current) return;
    const settling = current.isSettling();
    if (settling) return;
    const snapshotVersion = version.current;
    const abort = new AbortController();
    request.current = abort;
    judging.current = true;
    publish({ status: "画像で判定中" });
    try {
      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: current.snapshot() }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35_000)]),
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error("画像の判定に失敗しました。");
      const valid =
        !abort.signal.aborted &&
        latest.current.playing &&
        snapshotVersion === version.current &&
        Date.now() <= (latest.current.startAt ?? 0) + duelDuration;
      if (!valid) return;
      const result = assessmentSchema.parse(data);
      assessed.current = snapshotVersion;
      const probability = result.tidyProbability;
      const gain = Math.round((probability - (score.current.current ?? probability)) * 100);
      const reward = gain > 0 && lastAward.current !== snapshotVersion;
      const combo = reward
        ? Date.now() - lastGain.current < 30_000
          ? score.current.combo + 1
          : 1
        : gain < 0
          ? 0
          : score.current.combo;
      const points = score.current.points + (reward ? gain * 10 * Math.min(combo, 5) : 0);
      if (reward) lastGain.current = Date.now();
      lastAward.current = snapshotVersion;
      const clear = probability >= tidyThreshold;
      publish({
        current: probability,
        best: Math.max(score.current.best, probability),
        combo,
        points,
        clearAt: clear ? Date.now() : null,
        status: clear ? "CLEAR!" : "判定済み",
      });
      setNote(
        clear
          ? "画像判定80%達成！"
          : `片付いている確率 ${Math.round(probability * 100)}%${gain > 0 ? ` · +${gain}pt!` : ""}`,
      );
    } catch {
      if (abort.signal.aborted) return;
      publish({ status: "判定を再試行" });
      setNote("画像判定に接続できませんでした。少し待って再試行します。");
    } finally {
      const sameRequest = request.current === abort;
      if (sameRequest) {
        request.current = null;
        judging.current = false;
      }
    }
  };

  useEffect(() => {
    const judgeQueue = new LiveJudge(() => judgeRef.current());
    queue.current = judgeQueue;
    const element = host.current;
    if (!element) return;
    const current = new Room(
      element,
      (next) => {
        setState(next);
        const firstReady = next.ready && !ready.current;
        if (!firstReady) return;
        ready.current = true;
        latest.current.onReady(latest.current.side, true);
        publish({ status: "準備OK" });
        setNote(
          human ? "物を選んで、好きな平面に置こう。" : "あなたと同じ部屋で、AIが片付けます。",
        );
      },
      place,
      () => {
        setNote("部屋を読み込めませんでした。再読み込みしてください。");
        latest.current.onReady(latest.current.side, false);
      },
      (message) => {
        if (!human) setNote(message);
      },
      changed,
    );
    current.setInteractive(false);
    room.current = current;
    const poll = window.setInterval(() => {
      const needsJudgment =
        latest.current.playing && assessed.current !== version.current && !current.isSettling();
      if (needsJudgment) judgeQueue.request();
    }, 1500);
    return () => {
      clearInterval(poll);
      request.current?.abort();
      action.current?.abort();
      judgeQueue.dispose();
      current.dispose();
      room.current = null;
      void controller.current?.disconnect();
    };
  }, [changed, human, place, publish]);

  useEffect(() => {
    request.current?.abort();
    action.current?.abort();
    action.current = null;
    request.current = null;
    judging.current = false;
    room.current?.reset();
    version.current += 1;
    assessed.current = -1;
    lastAward.current = -1;
    lastGain.current = 0;
    score.current = emptyDuelScore();
    publish({ status: "準備OK" });
    setNote("同じ初期配置から、よーい…");
  }, [props.round, publish]);

  useEffect(() => {
    room.current?.setInteractive(human && active);
    queue.current?.setEnabled(props.playing);
    if (props.playing) queue.current?.request();
    if (!props.playing) {
      request.current?.abort();
      action.current?.abort();
      const ended = props.startAt !== null && Date.now() >= props.startAt;
      if (ended) setNote("対戦終了。次の勝負は、同じ初期配置から始まります。");
    }
  }, [active, human, props.playing, props.startAt]);

  useEffect(() => {
    setDecision(null);
  }, [props.round, props.mode]);

  useEffect(() => {
    const runAI = !human && props.playing;
    if (!runAI) return;
    const player = new AutoPlayer(
      { mode: props.mode, ...props.settings },
      {
        frame: () => {
          const current = room.current;
          const canAct =
            current &&
            ready.current &&
            !current.isSettling() &&
            !judging.current &&
            assessed.current === version.current &&
            score.current.current !== null;
          if (!canAct || !current) return null;
          return {
            version: version.current,
            tidyProbability: score.current.current!,
            ...current.autoPlan(),
          };
        },
        version: () => version.current,
        complete: () => score.current.clearAt !== null,
        probability: () => score.current.current ?? 0,
        visible: () => !document.hidden,
        act: async (move, signal) => {
          const current = room.current;
          if (!current) return false;
          const arrived = await current.approachItem(move.itemId, signal);
          const allowed = arrived && !signal.aborted && latest.current.playing;
          if (!allowed) return false;
          return place(move.point, signal);
        },
        status: setNote,
        decision: setDecision,
        end: () => {},
      },
    );
    return () => player.dispose();
  }, [human, props.playing, props.round, props.settings, props.mode, place]);

  useEffect(() => {
    if (!human) return;
    const key = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof HTMLElement &&
        event.target.matches("button,input,select,textarea,summary");
      const allowed = latest.current.playing && !editing && !event.repeat;
      if (!allowed) return;
      const isDrop = event.code === "Space";
      if (isDrop) {
        event.preventDefault();
        drop();
      }
      const isCancel = event.code === "Escape";
      if (isCancel) room.current?.deselect();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [human, drop]);

  const connect = async () => {
    if (connected) {
      await controller.current?.disconnect();
      setConnected(false);
      return;
    }
    const device = new ProController(
      (x, y, activate) => {
        if (latest.current.playing) room.current?.aim(x, y, activate);
      },
      drop,
      (message, isConnected) => {
        setDeviceNote(message);
        setConnected(isConnected);
      },
      (x, y, z, finished) => {
        if (!latest.current.playing) return;
        room.current?.rotateSelected(x, y, z);
        if (finished) room.current?.finishRotation();
      },
    );
    controller.current = device;
    try {
      await device.connect();
    } catch {
      setDeviceNote("ChromeでSwitch ProCon1を選択してください。");
    }
  };
  const selected = state.items.find((item) => item.id === state.selected);
  const rotate = (angle: number) => {
    room.current?.rotateSelected(0, angle, 0);
    room.current?.finishRotation();
  };

  return (
    <section
      className={`duel-arena duel-${props.side}`}
      aria-label={human ? "あなたの部屋" : "AIの部屋"}
    >
      <div className="duel-arena-heading">
        <h2>{human ? "YOU · あなた" : "AI · 対戦相手"}</h2>
        <strong>
          {view.current === null ? "—" : Math.round(view.current * 100)}
          <small> %</small>
        </strong>
      </div>
      <progress
        max={100}
        value={(view.current ?? 0) * 100}
        aria-label={human ? "あなたの片付いている確率" : "AIの片付いている確率"}
      />
      <div className="duel-stats">
        <span>最高 {Math.round(view.best * 100)}%</span>
        <span>{view.moves}手</span>
        <span>{view.points} pts</span>
        <span>{view.combo > 0 ? `${view.combo} COMBO!` : "目標80%"}</span>
      </div>
      <div className="duel-canvas" ref={host} />
      <p className="duel-note" role="status">
        {note}
      </p>
      {!human && (
        <p className="duel-ai-caption">
          {props.mode === "decisions"
            ? "Decisions API · 200区画の確率から判断 · gpt-6-luna"
            : `Agents API · ${props.settings.model} / ${props.settings.effort}`}
          <br />
          自分の部屋の画像を見て、次の配置を考えます。
        </p>
      )}
      {!human && props.mode === "decisions" && decision && <DecisionMap decision={decision} />}
      {human && (
        <>
          <p className="duel-selection">
            {selected
              ? `${selected.label} を選択中 → 床や家具の上をクリック`
              : "物をクリック → 床や家具の平面に置く"}
          </p>
          <div className="duel-actions">
            <button disabled={!active || !selected} onClick={drop}>
              足元に置く · Space
            </button>
            <button disabled={!active || !selected} onClick={() => rotate(-0.3)}>
              左回転
            </button>
            <button disabled={!active || !selected} onClick={() => rotate(0.3)}>
              右回転
            </button>
            <button disabled={!active || !selected} onClick={() => room.current?.deselect()}>
              選択解除
            </button>
          </div>
          <details>
            <summary>部屋のものから選ぶ · {state.items.length}こ</summary>
            <div className="duel-items">
              {state.items.map((item) => (
                <button
                  key={item.id}
                  disabled={!active}
                  aria-pressed={item.id === state.selected}
                  onClick={() => room.current?.select(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </details>
          <div className="duel-movement" role="group" aria-label="あなたの住人の移動">
            {[
              [0, -1, "↑"],
              [-1, 0, "←"],
              [0, 0, "■"],
              [1, 0, "→"],
              [0, 1, "↓"],
            ].map(([x, z, label]) => (
              <button
                key={String(label)}
                disabled={!active}
                aria-label={`住人を${label}に移動`}
                onClick={() => {
                  const moving = x !== 0 || z !== 0;
                  if (moving) room.current?.stepPlayer(Number(x), Number(z));
                  else room.current?.stopPlayer();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <small>床クリック・WASDで移動。置き先を選ぶと、取りに行って運びます。</small>
          <details>
            <summary>Switch ProCon1で遊ぶ</summary>
            <button onClick={() => void connect()} disabled={!state.ready}>
              {connected ? "Switch ProCon1を切断" : "Switch ProCon1を接続"}
            </button>
            <p>{deviceNote}</p>
            <small>スティックで照準、Aで選択・配置、Xで足元へ。ZR＋ジャイロで物を回転。</small>
          </details>
        </>
      )}
    </section>
  );
}
