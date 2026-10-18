import { afterEach, describe, expect, it, vi } from "vitest";
import { enemy, readEnemyTurn } from "../apps/worker/src/enemy.ts";
import { EnemyDirector } from "../apps/game/src/enemy-director.ts";

const settings = { model: "gpt-6-luna" as const, effort: "low" as const };
const items = [
  { id: "book_1", category: "books" as const, placed: true },
  { id: "trash_1", category: "trash" as const, placed: false },
];
const action = { itemId: "book_1", quip: "この本、もう一度読もうよ！" };
const input = { ...settings, items, combo: 3, attacksLeft: 5 };
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/enemy", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const events = (list: unknown[]) =>
  list.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
const turn = (result = action) =>
  new Response(
    events([
      { type: "agent.session.turn.output_text.done", text: JSON.stringify(result) },
      { type: "agent.session.turn.completed", turn: { subagent_id: null } },
    ]),
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("散らかす敵の API", () => {
  it("選択したモデルと effort、移動済みの対象だけを Agents API に渡す", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(turn());
    const response = await enemy(request(), { OPENAI_API_KEY: "test" }, "req", fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(action);
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(url).toBe("https://api.openai.com/v1/agents/sessions");
    expect(body.agent.model).toBe(settings.model);
    expect(body.agent.reasoning).toEqual({ effort: settings.effort });
    expect(body.agent.text.format.schema.properties.itemId.enum).toEqual(["book_1"]);
    expect(body.environment).toEqual({ type: "none" });
    expect(body.agent.tools).toEqual([]);
  });
  it("不明なモデル、effort、過大入力、別 Origin は推論を呼ばない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const body of [
      { ...input, model: "unknown" },
      { ...input, effort: "ultra" },
    ]) {
      expect((await enemy(request(body), { OPENAI_API_KEY: "test" }, "req", fetcher)).status).toBe(
        400,
      );
    }
    expect(
      (
        await enemy(
          request(input, { Origin: "https://other.example" }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await enemy(
          request(input, { "Content-Length": "99999" }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("キー未設定や移動済み対象なしでは推論を呼ばない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect((await enemy(request(), { OPENAI_API_KEY: "" }, "req", fetcher)).status).toBe(503);
    expect(
      (
        await enemy(
          request({ ...input, items: [items[1]] }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("許可されていない対象と上流の秘密情報を成功結果として返さない", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(turn({ ...action, itemId: "trash_1" }));
    expect((await enemy(request(), { OPENAI_API_KEY: "test" }, "req", fetcher)).status).toBe(502);
    fetcher.mockResolvedValue(new Response("secret upstream detail", { status: 403 }));
    const response = await enemy(request(), { OPENAI_API_KEY: "test" }, "req", fetcher);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret upstream detail");
  });
  it("チャンク境界・UTF-8境界をまたぐ SSE と done のみのテキストを扱う", async () => {
    const bytes = new TextEncoder().encode(
      events([
        { type: "agent.session.turn.output_text.delta", delta: "partial" },
        { type: "agent.session.turn.output_text.done", text: JSON.stringify(action) },
        { type: "agent.session.turn.completed" },
      ]),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    expect(await readEnemyTurn(new Response(stream))).toEqual(action);
  });
  it("ストリーム切断、失敗、idle を完了と誤認しない", async () => {
    await expect(
      readEnemyTurn(new Response(events([{ type: "agent.session.idle" }]))),
    ).rejects.toThrow("incomplete_turn");
    await expect(
      readEnemyTurn(new Response(events([{ type: "agent.session.turn.failed" }]))),
    ).rejects.toThrow("failed_turn");
  });
});

describe("敵の進行", () => {
  it("全アイテムを動かしても画像でクリアと判定されるまでは敵が行動する", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(action));
    const { state, director, act } = setup(fetcher);
    state.items.forEach((item) => {
      item.placed = true;
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(act).toHaveBeenCalled();
    director.dispose();
  });
  function setup(fetcher: typeof fetch, remaining = 5) {
    vi.useFakeTimers();
    vi.stubGlobal("document", { hidden: false });
    const state = {
      items: items.map((item) => ({ ...item, label: item.id })),
      combo: 0,
      complete: false,
    };
    const act = vi.fn();
    const fail = vi.fn();
    const director = new EnemyDirector(
      settings,
      () => state,
      act,
      vi.fn(),
      fail,
      remaining,
      fetcher,
    );
    return { state, act, fail, director };
  }
  it("同時に1件だけ問い合わせ、最後のいたずら後は API を呼ばない", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { act, director } = setup(fetcher, 1);
    await vi.advanceTimersByTimeAsync(36_000);
    expect(fetcher).toHaveBeenCalledOnce();
    finish(Response.json(action));
    await vi.advanceTimersByTimeAsync(0);
    expect(act).toHaveBeenCalledWith("book_1", action.quip, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledOnce();
    director.dispose();
  });
  it("停止・リセットに相当する破棄後は遅れて届いた行動を反映しない", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { act, director } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(12_000);
    director.dispose();
    finish(Response.json(action));
    await vi.advanceTimersByTimeAsync(0);
    expect(act).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it("推論中に画像判定でクリアしたら、完了した部屋を再び散らかさない", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { state, act, director } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(12_000);
    state.complete = true;
    finish(Response.json(action));
    await vi.advanceTimersByTimeAsync(0);
    expect(act).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledOnce();
    director.dispose();
  });
  it("画像判定のクリア後・タブ非表示中は散らかさず、API エラー後は自動リトライしない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "モデルを確認" }, { status: 502 }));
    const { state, act, fail, director } = setup(fetcher);
    document.hidden = true;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetcher).not.toHaveBeenCalled();
    document.hidden = false;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fail).toHaveBeenCalledWith("モデルを確認");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledOnce();
    state.complete = true;
    expect(act).not.toHaveBeenCalled();
    director.dispose();
  });
});
