import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "./room.ts";
import { ProController } from "./pro-controller.ts";
import { LiveJudge } from "./live-judge.ts";
import type { CSSProperties } from "react";
import { assessmentSchema } from "@devday/contracts";
import { destinations } from "./types.ts";
import type { Assessment, Category, RoomState } from "./types.ts";

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
  const host = useRef<HTMLDivElement>(null);
  const room = useRef<Room | null>(null);
  const controller = useRef<ProController | null>(null);
  const attemptRef = useRef<(category: Category) => void>(() => {});
  const version = useRef(0);
  const judgeRef = useRef<() => Promise<void>>(async () => {});
  const liveQueue = useRef<LiveJudge | null>(null);
  const previousAssessment = useRef<Assessment | null>(null);
  const comboRef = useRef({ count: 0, lastAt: 0 });
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const sorted = state.items.filter((item) => item.stored).length;
  const total = state.items.length;
  const complete = total > 0 && sorted === total;
  const selected = state.items.find((item) => item.id === state.selected);
  const progress = total ? Math.round((sorted / total) * 100) : 0;

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
  }, [state.ready, sorted, liveAI]);

  useEffect(() => {
    if (!complete) return;
    setMessage("きれいになった部屋で、深呼吸。AI の診断も試してみてね。");
  }, [complete]);

  const start = useCallback(() => {
    setStarted((previous) => previous ?? Date.now());
  }, []);

  const store = useCallback(
    (category: Category) => {
      const hasSelection = state.selected !== null;
      if (!hasSelection) {
        setMessage("まずは、部屋の中の物をひとつ選んでみよう。");
        return;
      }
      const success = room.current?.store(category);
      if (!success) {
        comboRef.current.count = 0;
        setCombo(0);
        if (comboTimer.current) clearTimeout(comboTimer.current);
        setMessage("そこではないみたい。持ちものに合う場所を選ぼう。");
        return;
      }
      version.current += 1;
      const now = performance.now();
      const isChain = comboRef.current.count > 0 && now - comboRef.current.lastAt <= 4000;
      const nextCombo = isChain ? comboRef.current.count + 1 : 1;
      const earned = 100 * Math.min(nextCombo, 5);
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
      }, 4000);
      burstTimer.current = setTimeout(() => setBurst(null), 1300);
      start();
      setMessage(
        [
          "ひとつ、すっきり。いい調子。",
          "物にも、いつもの居場所を。",
          "空いた場所が、ちょっと気持ちいい。",
          "その調子。急がなくて大丈夫。",
        ][sorted % 4] ?? "いい調子。",
      );
    },
    [state.selected, sorted, start],
  );
  attemptRef.current = store;

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
        (category) => attemptRef.current(category),
        () => setError("部屋を読み込めませんでした。ページを再読み込みしてください。"),
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
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (isTyping || event.repeat) return;
      const destination = destinations.find((candidate) => candidate.key === event.key);
      if (destination) {
        event.preventDefault();
        store(destination.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const reset = () => {
    version.current += 1;
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
      setAiGain(result.score - (previousAssessment.current?.score ?? result.score));
      previousAssessment.current = result;
      setAssessment(result);
      setAssessmentVersion(snapshotVersion);
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
      setControllerMessage("プロコンの接続を終了しました。");
      return;
    }
    setControllerConnecting(true);
    const device = new ProController(
      (x, y, activate) => room.current?.aim(x, y, activate),
      (category) => attemptRef.current(category),
      (message, connected) => {
        setControllerMessage(message);
        setControllerConnected(connected);
        if (!connected) room.current?.disableAim();
      },
    );
    controller.current = device;
    try {
      const connected = await device.connect();
      if (!connected) setControllerMessage("接続をキャンセルしました。いつでも、また試せます。");
    } catch (cause) {
      setControllerConnected(false);
      setControllerMessage(
        cause instanceof Error ? cause.message : "プロコンに接続できませんでした。",
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
              ① 部屋の中の物をクリック・タップして選ぶ。②
              本は本棚へ、服はバスケットへ、ごみはごみ箱へ。収納先のボタン、または部屋の収納をクリックすると戻せます。
            </p>
            <p>
              下の「残っているもの」からも選択できます。キーボードの 1・2・3・4
              でも収納先を選べます。制限時間はありません。
            </p>
          </aside>
        )}

        <div className="game-layout">
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
                  <b>おつかれさま。すっきり！</b>
                  <p>{formatTime(elapsed)} の、小さなリセット。</p>
                </div>
                <Icon name="spark" size={24} />
              </div>
            )}
          </section>

          <aside className="sidebar">
            <div className="progress-card">
              <div className="card-heading">
                <span>今日の、ひと片づけ</span>
                <Icon name="spark" size={20} />
              </div>
              <div className="progress-count">
                <span>{String(sorted).padStart(2, "0")}</span>
                <span className="progress-total">
                  / {String(total || 13).padStart(2, "0")} <small>こ</small>
                </span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={sorted}
                aria-valuemin={0}
                aria-valuemax={total || 13}
                aria-label="片づけた数"
              >
                <div style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-meta">
                <span>{complete ? "全部、おかえりなさい。" : "ひとつずつ、居場所に戻そう。"}</span>
                <span>{progress}%</span>
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
                {selected ? "いま、持っているもの" : "まずは、ひとつ選んでみよう"}
              </span>
              <div className="selected-item">
                <span className="item-icon">
                  <Icon
                    name={
                      destinations.find((destination) => destination.id === selected?.category)
                        ?.icon ?? "home"
                    }
                    size={27}
                  />
                </span>
                <span>
                  {selected?.label ?? "どこから片づける？"}
                  <small>{selected ? "どこに戻してあげよう？" : "部屋の中のものをクリック"}</small>
                </span>
              </div>
            </div>

            <div className="destinations">
              <p className="small-label">ものの、帰る場所</p>
              {destinations.map((destination) => {
                const count = state.items.filter(
                  (item) => item.category === destination.id && item.stored,
                ).length;
                const categoryTotal = state.items.filter(
                  (item) => item.category === destination.id,
                ).length;
                return (
                  <button
                    key={destination.id}
                    className={`destination destination-${destination.id}`}
                    onClick={() => store(destination.id)}
                    disabled={!state.ready || complete}
                  >
                    <span className="destination-icon">
                      <Icon name={destination.icon} size={24} />
                    </span>
                    <span className="destination-label">
                      {destination.label}
                      <small>
                        {destination.detail}{" "}
                        <span>
                          {count} / {categoryTotal}
                        </span>
                      </small>
                    </span>
                    <kbd>{destination.key}</kbd>
                  </button>
                );
              })}
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
                    ? "AI の片づけ診断"
                    : "AI の片づけ診断 · 更新待ち"}
                </span>
                <div>
                  <b>{assessment.score}</b>
                  <span>/ 100</span>
                  {aiGain > 0 && <em className="ai-gain">↑ {aiGain}</em>}
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
            残っているもの <span>{total - sorted} こ</span>
            <small>クリックでも選べます</small>
          </summary>
          <div className="item-list">
            {state.items
              .filter((item) => !item.stored)
              .map((item) => (
                <button
                  className={item.id === state.selected ? "active" : ""}
                  key={item.id}
                  onClick={() => room.current?.select(item.id)}
                >
                  {item.label}
                </button>
              ))}
            {complete && <p>ぜんぶ、いつもの場所に戻りました。</p>}
          </div>
        </details>
        <div className="controller-bar">
          <span>
            <Icon name="controller" size={19} /> プロコンでも、ひと片づけ。
          </span>
          <button
            className="text-button"
            disabled={!state.ready || controllerConnecting}
            onClick={() => void connectController()}
          >
            {controllerConnecting
              ? "接続中…"
              : controllerConnected
                ? "プロコンを切断"
                : "USB プロコンを接続"}{" "}
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
