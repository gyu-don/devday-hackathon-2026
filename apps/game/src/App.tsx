import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "./room.ts";
import { ProController } from "./pro-controller.ts";
import { LiveJudge } from "./live-judge.ts";
import { EnemyDirector } from "./enemy-director.ts";
import { AutoPlayPanel } from "./AutoPlayPanel.tsx";
import { DuelGame } from "./DuelGame.tsx";
import type { CSSProperties } from "react";
import {
  assessmentSchema,
  tidyThreshold,
  enemyEfforts,
  enemyModels,
  enemySettingsSchema,
} from "@devday/contracts";
import type { EnemySettings } from "@devday/contracts";
import type { Assessment, Placement, RoomState } from "./types.ts";

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7v11H3Z M9 21v-8h6v8",
    book: "M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H3V3Z M13 6a3 3 0 0 1 3-3h5v16h-5a3 3 0 0 0-3 2",
    basket: "m3 9 2 12h14l2-12H3Z M8 9l4-7 4 7 M9 13v4 M15 13v4",
    trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
    arrow: "M4 12h15 m-6-6 6 6-6 6",
    refresh: "M20 7v5h-5 M20 12a8 8 0 1 0-2 6",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
    check: "m5 12 4 4L19 6",
    clock: "M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    controller: "M7 6h10l3 2 2 10-2 2-5-4H9l-5 4-2-2L4 8Z M7 9v6 M4 12h6 M16 10h.01 M18 13h.01",
    heart: "M12 21 3.8 13a5.5 5.5 0 0 1 8.2-7.2A5.5 5.5 0 0 1 20.2 13Z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function App() {
  const [practice, setPractice] = useState(false);
  if (!practice) return <DuelGame onPractice={() => setPractice(true)} />;
  return (
    <>
      <button className="duel-return" onClick={() => setPractice(false)}>
        ← AIとの対決へ戻る
      </button>
      <PracticeGame />
    </>
  );
}

function PracticeGame() {
  const host = useRef<HTMLDivElement>(null);
  const room = useRef<Room | null>(null);
  const controller = useRef<ProController | null>(null);
  const stopAuto = useRef<() => void>(() => {});
  const attemptRef = useRef<(point: Placement) => void>(() => {});
  const version = useRef(0);
  const [revision, setRevision] = useState(0);
  const completionRef = useRef(false);
  const changeRef = useRef<() => void>(() => {});
  changeRef.current = () => {
    version.current += 1;
    setRevision(version.current);
  };
  const judgeRef = useRef<() => Promise<void>>(async () => {});
  const pendingJudge = useRef(false);
  const rewardedVersion = useRef(-1);
  const liveQueue = useRef<LiveJudge | null>(null);
  const previousAssessment = useRef<Assessment | null>(null);
  const comboRef = useRef({ count: 0, lastAt: 0 });
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef<RoomState>({ items: [], selected: null, ready: false });
  const enemyRemaining = useRef(5);
  const [enemyEnabled, setEnemyEnabled] = useState(false);
  const [enemySettings, setEnemySettings] = useState<EnemySettings>({
    model: "gpt-6-luna",
    effort: "low",
  });
  const [enemyRound, setEnemyRound] = useState(0);
  const [enemyLeft, setEnemyLeft] = useState(5);
  const [enemyMessage, setEnemyMessage] = useState(
    "片付けた物を、こっそり床に戻すおばけ。出現させてみる？",
  );
  const [state, setState] = useState<RoomState>({ items: [], selected: null, ready: false });
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("小さな部屋を、心地よく。");
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [judging, setJudging] = useState(false);
  const [liveAI, setLiveAI] = useState(true);
  const [assessmentVersion, setAssessmentVersion] = useState(-1);
  const [aiGain, setAiGain] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [points, setPoints] = useState(0);
  const [burst, setBurst] = useState<{ id: number; combo: number; points: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [controllerMessage, setControllerMessage] = useState<string | null>(null);
  const [controllerConnected, setControllerConnected] = useState(false);
  const [controllerConnecting, setControllerConnecting] = useState(false);
  const [playerStatus, setPlayerStatus] = useState("床をクリック・タップで、住人が歩きます。");
  latestState.current = state;
  const total = state.items.length;
  const complete =
    assessment !== null &&
    assessmentVersion === version.current &&
    assessment.tidyProbability >= tidyThreshold;
  completionRef.current = complete;
  const selected = state.items.find((item) => item.id === state.selected);
  const progress =
    assessmentVersion === version.current
      ? Math.round((assessment?.tidyProbability ?? 0) * 100)
      : 0;

  useEffect(() => {
    room.current?.setEnemyVisible(enemyEnabled);
    const canStart = enemyEnabled && state.ready && !complete && enemyRemaining.current > 0;
    if (!canStart) return;
    setEnemyMessage("ちらかしが出現！12秒ごとに、次のいたずらを考えます。");
    const director = new EnemyDirector(
      enemySettings,
      () => ({
        items: latestState.current.items,
        combo: comboRef.current.count,
        complete: completionRef.current,
      }),
      (itemId, quip, remaining) => {
        enemyRemaining.current = remaining;
        setEnemyLeft(remaining);
        const scattered = room.current?.scatter(itemId);
        if (!scattered) return;
        version.current += 1;
        setRevision(version.current);
        liveQueue.current?.request();
        const label = latestState.current.items.find((item) => item.id === itemId)?.label ?? "物";
        const note =
          remaining === 0
            ? "いたずらはおしまい。片付いている確率80%以上を目指そう！"
            : `あと${remaining}回のいたずら。`;
        setEnemyMessage(`「${quip}」 ${label}を散らかした！ ${note}`);
        setMessage(`ちらかしが ${label} を床に戻しました。もう一度、居場所へ。`);
      },
      setEnemyMessage,
      (message) => {
        setEnemyMessage(message);
        setEnemyEnabled(false);
      },
      enemyRemaining.current,
    );
    return () => director.dispose();
  }, [enemyEnabled, enemySettings, enemyRound, state.ready, complete]);

  useEffect(() => {
    const queue = new LiveJudge(() => judgeRef.current());
    liveQueue.current = queue;
    return () => {
      queue.dispose();
      if (comboTimer.current) clearTimeout(comboTimer.current);
      if (burstTimer.current) clearTimeout(burstTimer.current);
    };
  }, []);

  useEffect(() => {
    liveQueue.current?.setEnabled(liveAI);
    const shouldJudge = state.ready && liveAI;
    if (shouldJudge) liveQueue.current?.request();
  }, [state.ready, revision, liveAI]);

  useEffect(() => {
    if (!complete) return;
    setMessage("AI が画像を見て、片付いたと判定しました。おつかれさま！");
  }, [complete]);

  const start = useCallback(() => {
    setStarted((previous) => previous ?? Date.now());
  }, []);

  const place = useCallback(
    (point: Placement) => {
      const success = room.current?.place(point);
      if (!success) {
        setMessage("まず物を選び、床や家具の平らな面をクリック・タップしてください。");
        return;
      }
      version.current += 1;
      setRevision(version.current);
      start();
      setMessage("ここに置いてみよう。片付いたかは AI が部屋の画像を見て判定します。");
    },
    [start],
  );
  attemptRef.current = place;

  const drop = useCallback(() => {
    const point = room.current?.dropPoint();
    const hasPoint = Boolean(point);
    if (hasPoint && point) attemptRef.current(point);
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    try {
      room.current = new Room(
        element,
        (next) => {
          setState(next);
          const hasSelected = next.selected !== null;
          if (hasSelected) start();
        },
        (point) => attemptRef.current(point),
        () => setError("部屋を読み込めませんでした。ページを再読み込みしてください。"),
        setPlayerStatus,
        () => {
          changeRef.current();
          const pending = pendingJudge.current;
          if (pending) {
            pendingJudge.current = false;
            void judgeRef.current();
          }
        },
      );
    } catch {
      setError(
        "3D 表示を開始できませんでした。Chrome のグラフィック アクセラレーションを確認してください。",
      );
    }
    return () => {
      room.current?.dispose();
      void controller.current?.disconnect();
    };
  }, [start]);

  useEffect(() => {
    const shouldTick = started !== null && !complete;
    if (!shouldTick) return;
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [started, complete]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isTyping =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (isTyping || event.repeat) return;
      const isDrop =
        event.code === "Space" &&
        !(event.target instanceof HTMLElement && event.target.matches("button,summary,a"));
      if (isDrop) {
        event.preventDefault();
        drop();
      }
      const isCancel = event.code === "Escape";
      if (isCancel) room.current?.deselect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drop]);

  const reset = () => {
    pendingJudge.current = false;
    rewardedVersion.current = -1;
    setPlayerStatus("床をクリック・タップで、住人が歩きます。");
    setEnemyMessage("片付けた物を、こっそり床に戻すおばけ。出現させてみる？");
    enemyRemaining.current = 5;
    setEnemyLeft(5);
    setEnemyRound((previous) => previous + 1);
    version.current += 1;
    setRevision(version.current);
    room.current?.reset();
    setStarted(null);
    setElapsed(0);
    setAssessment(null);
    previousAssessment.current = null;
    setAssessmentVersion(-1);
    setAiGain(0);
    setPoints(0);
    setCombo(0);
    setBestCombo(0);
    setBurst(null);
    comboRef.current = { count: 0, lastAt: 0 };
    if (comboTimer.current) clearTimeout(comboTimer.current);
    if (burstTimer.current) clearTimeout(burstTimer.current);
    setMessage("また、ひとつずつ。自分のペースで。");
  };

  const judge = async () => {
    const current = room.current;
    if (!current || judging || !state.ready) return;
    const settling = current.isSettling();
    if (settling) {
      pendingJudge.current = true;
      setMessage("物が落ち着いたら、部屋の画像を判定します。");
      return;
    }
    pendingJudge.current = false;
    setJudging(true);
    const snapshotVersion = version.current;
    try {
      const image = current.snapshot();
      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(35_000),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "診断に失敗しました。少し待って試してください。";
        throw new Error(message);
      }
      const isCurrent = snapshotVersion === version.current;
      if (!isCurrent) {
        return;
      }
      const result = assessmentSchema.parse(data);
      const gain = Math.round(
        (result.tidyProbability -
          (previousAssessment.current?.tidyProbability ?? result.tidyProbability)) *
          100,
      );
      setAiGain(gain);
      const improved = gain > 0 && rewardedVersion.current !== snapshotVersion;
      if (improved) {
        const now = performance.now();
        const isChain = comboRef.current.count > 0 && now - comboRef.current.lastAt <= 30_000;
        const nextCombo = isChain ? comboRef.current.count + 1 : 1;
        const earned = gain * 10 * Math.min(nextCombo, 5);
        comboRef.current = { count: nextCombo, lastAt: now };
        setCombo(nextCombo);
        setBestCombo((previous) => Math.max(previous, nextCombo));
        setPoints((previous) => previous + earned);
        setBurst({ id: now, combo: nextCombo, points: earned });
        if (comboTimer.current) clearTimeout(comboTimer.current);
        if (burstTimer.current) clearTimeout(burstTimer.current);
        comboTimer.current = setTimeout(() => {
          comboRef.current.count = 0;
          setCombo(0);
        }, 30_000);
        burstTimer.current = setTimeout(() => setBurst(null), 1300);
      }
      const worsened = gain < 0;
      if (worsened) {
        comboRef.current.count = 0;
        setCombo(0);
      }
      previousAssessment.current = result;
      rewardedVersion.current = snapshotVersion;
      setAssessment(result);
      setAssessmentVersion(snapshotVersion);
      setMessage(`AI の画像判定：片付いている確率 ${Math.round(result.tidyProbability * 100)}%。`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "診断に接続できませんでした。");
    } finally {
      setJudging(false);
    }
  };
  judgeRef.current = judge;

  const connectController = async () => {
    if (controllerConnected) {
      await controller.current?.disconnect();
      setControllerConnected(false);
      room.current?.disableAim();
      setControllerMessage("Switch ProCon1の接続を終了しました。");
      return;
    }
    setControllerConnecting(true);
    const device = new ProController(
      (x, y, activate) => {
        if (activate) stopAuto.current();
        room.current?.aim(x, y, activate);
      },
      () => {
        stopAuto.current();
        drop();
      },
      (message, connected) => {
        setControllerMessage(message);
        setControllerConnected(connected);
        if (!connected) {
          room.current?.disableAim();
          room.current?.finishRotation();
        }
      },
      (x, y, z, finished) => {
        const rotating = x !== 0 || y !== 0 || z !== 0;
        if (rotating) stopAuto.current();
        room.current?.rotateSelected(x, y, z);
        if (finished) room.current?.finishRotation();
      },
    );
    controller.current = device;
    try {
      const connected = await device.connect();
      if (!connected) setControllerMessage("接続をキャンセルしました。いつでも、また試せます。");
    } catch (cause) {
      setControllerConnected(false);
      setControllerMessage(
        cause instanceof Error ? cause.message : "Switch ProCon1に接続できませんでした。",
      );
    } finally {
      setControllerConnecting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ひと息、片づけ。 ホーム">
          <span className="brand-symbol">
            <Icon name="home" size={25} />
          </span>
          <span>
            ひと息、片づけ<span className="brand-dot">。</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="quiet-tag">
            <span /> A LITTLE ROOM, A LITTLE CALM
          </span>
          <button className="text-button" onClick={() => setHelp(!help)} aria-expanded={help}>
            あそびかた <span className="question-mark">?</span>
          </button>
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">A SMALL RESET FOR YOUR DAY</p>
            <h1>
              部屋が整うと、
              <br className="mobile-break" />
              気持ちも、すこし整う。
            </h1>
            <p className="intro-copy">
              散らかったものを、いつもの場所へ。<span>ひとつずつ、自分のペースで。</span>
            </p>
          </div>
          <div className="room-stamp">
            <Icon name="sun" size={26} />
            <span>
              日曜日の午後
              <br />
              <b>ROOM 01</b>
            </span>
          </div>
        </section>

        {help && (
          <aside className="help-panel">
            <b>あそびかた</b>
            <p>
              ① 物をクリック・タップして選ぶ。②
              床や家具の平らな面をクリック・タップして置く。置き場所は自由です。AI
              が部屋の画像を見て片付け度を判定し、確率80%以上でクリアです。
            </p>
            <p>
              下の「部屋のもの」からも選択できます。「足元に置く」またはスペースキーでも置けます。Escで選択を解除します。制限時間はありません。
            </p>
            <p>
              エプロン姿の住人が操作キャラです。床のクリック・タップ、WASD・矢印キー、部屋の下の方向ボタンで移動できます。物を選ぶと、近くまで歩きます。
            </p>
          </aside>
        )}

        <AutoPlayPanel
          room={room}
          ready={state.ready}
          judging={judging}
          assessedVersion={assessmentVersion}
          version={version}
          complete={complete}
          tidyProbability={assessment?.tidyProbability ?? 0}
          stopRef={stopAuto}
          onStart={() => {
            setEnemyEnabled(false);
            setLiveAI(true);
            start();
          }}
          onAction={() => {
            changeRef.current();
            start();
          }}
        />
        <section className="enemy-card" aria-labelledby="enemy-title">
          <div className="enemy-heading">
            <h2 id="enemy-title">いたずらおばけ、ちらかし</h2>
            <button
              type="button"
              role="switch"
              aria-label="散らかす敵"
              aria-checked={enemyEnabled}
              disabled={!state.ready || complete || enemyLeft === 0}
              onClick={() => setEnemyEnabled(!enemyEnabled)}
            >
              {enemyEnabled ? "出現中 · 止める" : "敵を出現させる"}
            </button>
          </div>
          <p>動かした物を床へ戻すおばけ。最大5回、片付いている確率80%以上でクリア。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const settings = enemySettingsSchema.parse({
                model: form.get("model"),
                effort: form.get("effort"),
              });
              setEnemySettings(settings);
            }}
          >
            <label htmlFor="enemy-model">Codex モデル</label>
            <select id="enemy-model" name="model" defaultValue={enemySettings.model}>
              {enemyModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <label htmlFor="enemy-effort">Reasoning effort</label>
            <select id="enemy-effort" name="effort" defaultValue={enemySettings.effort}>
              {enemyEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
            <button type="submit">設定を反映</button>
          </form>
          <p className="enemy-active-settings">
            適用中: {enemySettings.model} / {enemySettings.effort} · 残り{enemyLeft}回
          </p>
          <p role="status">
            {complete && enemyEnabled ? "AI が部屋をきれいと判定！あなたの勝ち。" : enemyMessage}
          </p>
          <small>
            ON の間、部屋の物の状態を OpenAI Agents API に送ります。非表示のタブでは休憩します。
          </small>
        </section>

        <div className="game-layout">
          <div className="room-column">
            <section className="room-panel" aria-label="片づける部屋">
              {burst && (
                <div className="tidy-burst" key={burst.id} aria-hidden="true">
                  <span>{burst.combo > 1 ? `${burst.combo} COMBO!` : "NICE TIDY!"}</span>
                  <b>
                    +{burst.points}
                    <small> pts</small>
                  </b>
                  {Array.from({ length: 14 }, (_, index) => (
                    <i
                      key={index}
                      style={
                        {
                          "--dx": `${Math.cos(index * 2.4) * (85 + index * 6)}px`,
                          "--dy": `${Math.sin(index * 2.4) * 100 - 35}px`,
                          "--r": `${index * 47}deg`,
                          "--color": ["#b9c98b", "#e6af85", "#dfb5c9", "#a3c5c4"][index % 4],
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
              )}
              <div className="room-panel-top">
                <span className="room-title">
                  <span className="status-dot" />
                  {complete ? "すっきりした、わたしの部屋" : "わたしの、小さな部屋"}
                </span>
                <span className="room-weather">
                  ☀ 14:30 <span>晴れ</span>
                </span>
              </div>
              <div className="scene" ref={host} />
              {!state.ready && !error && (
                <div className="scene-loading">
                  <span className="loading-mark">
                    <Icon name="home" size={30} />
                  </span>
                  <p>部屋のドアを、開けています。</p>
                </div>
              )}
              {error && (
                <div className="scene-loading error-state">
                  <p>{error}</p>
                  <button className="primary-button" onClick={() => location.reload()}>
                    もう一度開く
                  </button>
                </div>
              )}
              <div className="scene-caption">
                <Icon name="sun" size={16} />
                <span>あわてなくて、大丈夫。</span>
              </div>
              <div className="camera-controls">
                <button
                  title="左から見る"
                  aria-label="部屋を左から見る"
                  onClick={() => room.current?.rotate(-1)}
                >
                  ↶
                </button>
                <span>視点</span>
                <button
                  title="右から見る"
                  aria-label="部屋を右から見る"
                  onClick={() => room.current?.rotate(1)}
                >
                  ↷
                </button>
              </div>
              {complete && (
                <div className="complete-card" role="status">
                  <span className="complete-icon">
                    <Icon name="check" size={25} />
                  </span>
                  <div>
                    <b>AI 判定ですっきり！</b>
                    <p>{formatTime(elapsed)} の、小さなリセット。</p>
                  </div>
                  <Icon name="spark" size={24} />
                </div>
              )}
            </section>

            <div className="player-controls">
              <div>
                <b>あなたの、小さな住人</b>
                <p role="status">{playerStatus}</p>
                <small>床をクリック・タップ / WASD・矢印キーでも移動</small>
              </div>
              <div className="player-dpad" role="group" aria-label="操作キャラの移動">
                <button
                  type="button"
                  aria-label="住人を上へ移動"
                  onClick={() => room.current?.stepPlayer(0, -1)}
                  disabled={!state.ready}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="住人を左へ移動"
                  onClick={() => room.current?.stepPlayer(-1, 0)}
                  disabled={!state.ready}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="住人を停止"
                  onClick={() => room.current?.stopPlayer()}
                  disabled={!state.ready}
                >
                  ■
                </button>
                <button
                  type="button"
                  aria-label="住人を右へ移動"
                  onClick={() => room.current?.stepPlayer(1, 0)}
                  disabled={!state.ready}
                >
                  →
                </button>
                <button
                  type="button"
                  aria-label="住人を下へ移動"
                  onClick={() => room.current?.stepPlayer(0, 1)}
                  disabled={!state.ready}
                >
                  ↓
                </button>
              </div>
            </div>
          </div>
          <aside className="sidebar">
            <div className="progress-card">
              <div className="card-heading">
                <span>片付いている確率</span>
                <Icon name="spark" size={20} />
              </div>
              <div className="progress-count">
                <span>{assessment ? Math.round(assessment.tidyProbability * 100) : "—"}</span>
                <span className="progress-total">
                  <small>%</small>
                </span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="画像からの片付いている確率"
              >
                <div
                  style={{
                    width: `${assessmentVersion === version.current ? `${progress}%` : "未判定"}`,
                  }}
                />
              </div>
              <div className="progress-meta">
                <span>
                  {complete
                    ? "AI が片付いたと判定！"
                    : assessmentVersion !== version.current
                      ? "画像判定を更新待ち"
                      : "確率80%以上でクリア · 置き方は自由"}
                </span>
                <span>{assessmentVersion === version.current ? `${progress}%` : "未判定"}</span>
              </div>
              <div className="timer">
                <Icon name="clock" size={17} />
                <span>{formatTime(elapsed)}</span>
                <small>制限時間はありません</small>
              </div>
              <div className="session-score">
                <span>
                  <b>{points.toLocaleString()}</b> pts
                </span>
                <span>
                  BEST <b>{bestCombo}</b> COMBO
                </span>
              </div>
              {combo > 0 && (
                <div className="combo-status" key={combo}>
                  <span>
                    {combo} COMBO <small>×{Math.min(combo, 5)}</small>
                  </span>
                  <div>
                    <i />
                  </div>
                </div>
              )}
            </div>

            <div className={`selection-card ${selected ? "has-selection" : ""}`}>
              <span className="small-label">
                {selected ? "いま、選んでいるもの" : "まずは、ひとつ選んでみよう"}
              </span>
              <div className="selected-item">
                <span className="item-icon">
                  <Icon
                    name={
                      selected?.category === "dolls"
                        ? "heart"
                        : selected?.category === "books"
                          ? "book"
                          : selected?.category === "laundry"
                            ? "basket"
                            : "home"
                    }
                    size={27}
                  />
                </span>
                <span>
                  {selected?.label ?? "どこから片づける？"}
                  <small>
                    {selected ? "床や家具の上をタップして置こう" : "部屋の中のものをクリック"}
                  </small>
                </span>
              </div>
            </div>

            <div className="free-placement">
              <b>置き場所に、正解はありません。</b>
              <p>
                床・机・棚・ソファ。好きな配置にして、画像からの確率を上げよう。落とした物には重力が働きます。
              </p>
              <button
                className="primary-button"
                onClick={drop}
                disabled={!state.ready || !selected}
              >
                選んだ物を足元に置く <kbd>Space</kbd>
              </button>
              <div className="placement-rotation" role="group" aria-label="選んだ物の回転">
                <button
                  disabled={!selected}
                  onClick={() => {
                    room.current?.rotateSelected(0, -Math.PI / 12, 0);
                    room.current?.finishRotation();
                  }}
                >
                  左に回す
                </button>
                <button
                  disabled={!selected}
                  onClick={() => {
                    room.current?.rotateSelected(0, Math.PI / 12, 0);
                    room.current?.finishRotation();
                  }}
                >
                  右に回す
                </button>
                <button
                  disabled={!selected}
                  onClick={() => {
                    room.current?.rotateSelected(Math.PI / 12, 0, 0);
                    room.current?.finishRotation();
                  }}
                >
                  傾ける
                </button>
              </div>
              <p className="ai-note">Switch ProCon1は ZR を押しながら傾けると回転</p>
              <button
                className="text-button"
                onClick={() => room.current?.deselect()}
                disabled={!selected}
              >
                選択を解除 <kbd>Esc</kbd>
              </button>
            </div>

            <button
              className="ai-button"
              onClick={() => {
                if (liveAI) liveQueue.current?.request();
                else void judge();
              }}
              disabled={!state.ready || judging}
            >
              <Icon name="spark" size={19} />
              <span>{judging ? "部屋を見てもらっています…" : "AI に片づけ度を見てもらう"}</span>
              <Icon name="arrow" size={18} />
            </button>
            <p className="ai-note">部屋の画像を OpenAI に送って診断します</p>
            <div className="live-control">
              <span>
                <i className={judging ? "is-judging" : ""} />
                AI ライブ判定{judging ? " · 診断中" : ""}
              </span>
              <button
                type="button"
                role="switch"
                aria-label="AI ライブ判定"
                aria-checked={liveAI}
                onClick={() => setLiveAI(!liveAI)}
              >
                {liveAI ? "ON" : "OFF"}
              </button>
            </div>
            {assessment && (
              <div className="assessment" role="status">
                <span className="small-label">
                  {assessmentVersion === version.current
                    ? "AI の画像判定"
                    : "AI の画像判定 · 更新待ち"}
                </span>
                <div>
                  <b>{assessment.score}</b>
                  <span>/ 100</span>
                  {aiGain > 0 && <em className="ai-gain">↑ {aiGain}pt</em>}
                </div>
                <h2>{assessment.label}</h2>
                {assessment.details.map((detail) => (
                  <p key={detail.name}>
                    <span>{detail.name}</span>
                    <span>
                      {detail.score}
                      <small> / 100</small>
                    </span>
                  </p>
                ))}
              </div>
            )}
          </aside>
        </div>

        <div className="game-footer">
          <p className="feedback" role="status" aria-live="polite">
            <span className="feedback-dot" />
            {message}
          </p>
          <button className="reset-button" onClick={reset} disabled={!state.ready}>
            <Icon name="refresh" size={16} />
            はじめから
          </button>
        </div>
        <details className="remaining-items">
          <summary>
            部屋のもの <span>{total} こ · 何度でも動かせます</span>
            <small>クリックでも選べます</small>
          </summary>
          <div className="item-list">
            {state.items.map((item) => (
              <button
                className={item.id === state.selected ? "active" : ""}
                key={item.id}
                onClick={() => room.current?.select(item.id)}
              >
                {item.label}
              </button>
            ))}
            {complete && <p>AI が部屋の画像から、きれいと判定しました。</p>}
          </div>
        </details>
        <div className="controller-bar">
          <span>
            <Icon name="controller" size={19} /> Switch ProCon1でも、ひと片づけ。
          </span>
          <button
            className="text-button"
            disabled={!state.ready || controllerConnecting}
            onClick={() => void connectController()}
          >
            {controllerConnecting
              ? "接続中…"
              : controllerConnected
                ? "Switch ProCon1を切断"
                : "Switch ProCon1を接続"}{" "}
            <Icon name="arrow" size={15} />
          </button>
          {controllerConnected && (
            <button className="text-button" onClick={() => controller.current?.recenter()}>
              照準を中央に戻す
            </button>
          )}
          {controllerMessage && <p role="status">{controllerMessage}</p>}
        </div>
      </main>
      <footer className="site-footer">
        <span>ひと息、片づけ。</span>
        <p>少し整える。それだけで、いい一日。</p>
        <span>MADE FOR A QUIETER MOMENT</span>
      </footer>
    </div>
  );
}
