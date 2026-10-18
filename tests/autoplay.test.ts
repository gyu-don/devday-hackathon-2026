import { afterEach, describe, expect, it, vi } from "vitest";
import { autoplay } from "../apps/worker/src/autoplay.ts";
import { AutoPlayer } from "../apps/game/src/autoplay.ts";

const config = { mode: "decisions" as const, model: "gpt-6-luna" as const, effort: "low" as const };
const move = {
  id: "book__A",
  itemId: "book",
  description: "1の本を面Aに置く",
  point: { x: 0, y: 0.7, z: 0 },
};
const image = "data:image/jpeg;base64,/9j/2Q==";
const input = { ...config, image, moves: [move], history: [] };
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/autoplay", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const choice = (action = move.id) =>
  Response.json({ answers: [{ type: "choice", name: "move", choice: action }] });
const stream = (action = move.id) =>
  new Response(
    [
      { type: "agent.session.turn.output_text.done", text: JSON.stringify({ action }) },
      { type: "agent.session.turn.completed" },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
  );
afterEach(() => {
  vi.useRealTimers();
});

describe("自動配置 API", () => {
  it("Decisions の choice に画像と操作候補を渡す", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(choice());
    const response = await autoplay(request(), { OPENAI_API_KEY: "test" }, "req", fetcher);
    expect(await response.json()).toEqual({ action: move.id });
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(url).toBe("https://api.openai.com/v1/decisions");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: image });
    expect(body.questions[0]).toMatchObject({
      type: "choice",
      name: "move",
      choices: [{ value: move.id }, { value: "stop" }],
    });
  });
  it("Agents のモデル・effort と画像を反映し、完了した行動だけを採用する", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(stream());
    const response = await autoplay(
      request({ ...input, mode: "agents", model: "gpt-6-sol", effort: "medium" }),
      { OPENAI_API_KEY: "test" },
      "req",
      fetcher,
    );
    expect(await response.json()).toEqual({ action: move.id });
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(url).toBe("https://api.openai.com/v1/agents/sessions");
    expect(body.agent).toMatchObject({
      model: "gpt-6-sol",
      reasoning: { effort: "medium" },
      tools: [],
    });
    expect(body.environment).toEqual({ type: "none" });
    expect(body.agent.text.format.schema.properties.action.enum).toEqual([move.id, "stop"]);
    expect(body.input[0].content[1].image_url).toBe(image);
  });
  it("Decisions は対象と置き場所を順に選び、選んだ対象の配置だけを許可する", async () => {
    const other = {
      ...move,
      id: "towel__A",
      itemId: "towel",
      description: "2: タオル を A に置く",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(choice("towel"))
      .mockResolvedValueOnce(choice(other.id));
    const response = await autoplay(
      request({ ...input, moves: [move, other] }),
      { OPENAI_API_KEY: "test" },
      "req",
      fetcher,
    );
    expect(await response.json()).toEqual({ action: other.id });
    const first = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(first.questions[0].choices.map((option: { value: string }) => option.value)).toEqual([
      "book",
      "towel",
    ]);
    expect(second.questions[0].choices.map((option: { value: string }) => option.value)).toEqual([
      other.id,
      "stop",
    ]);
    const wrong = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(choice("towel"))
      .mockResolvedValueOnce(choice(move.id));
    expect(
      (
        await autoplay(
          request({ ...input, moves: [move, other] }),
          { OPENAI_API_KEY: "test" },
          "req",
          wrong,
        )
      ).status,
    ).toBe(502);
  });
  it("モデルが stop を選んでも、ゲームのクリア判定は返さない", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(choice("stop"));
    expect(
      await (await autoplay(request(), { OPENAI_API_KEY: "test" }, "req", fetcher)).json(),
    ).toEqual({ action: "stop" });
  });
  it("拒否・候補外の行動・完了前の切断を成功として返さない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ answers: [{ type: "refusal", name: "move" }] }));
    expect((await autoplay(request(), { OPENAI_API_KEY: "test" }, "req", fetcher)).status).toBe(
      502,
    );
    fetcher.mockResolvedValue(choice("outside"));
    expect((await autoplay(request(), { OPENAI_API_KEY: "test" }, "req", fetcher)).status).toBe(
      502,
    );
    fetcher.mockResolvedValue(new Response('data: {"type":"agent.session.idle"}\n\n'));
    expect(
      (
        await autoplay(
          request({ ...input, mode: "agents" }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(502);
  });
  it("外部画像・不正な位置・重複ID・別Origin・キー無しでは推論しない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const body of [
      { ...input, image: "https://other.example/private.jpg" },
      { ...input, moves: [{ ...move, point: { x: 100, y: 0, z: 0 } }] },
      { ...input, moves: [move, move] },
    ]) {
      expect(
        (await autoplay(request(body), { OPENAI_API_KEY: "test" }, "req", fetcher)).status,
      ).toBe(400);
    }
    expect(
      (
        await autoplay(
          request(input, { Origin: "https://other.example" }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await autoplay(
          request(input, { "Content-Length": "2000000" }),
          { OPENAI_API_KEY: "test" },
          "req",
          fetcher,
        )
      ).status,
    ).toBe(413);
    expect((await autoplay(request(), { OPENAI_API_KEY: "" }, "req", fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function setup(fetcher: typeof fetch) {
  vi.useFakeTimers();
  const state = { version: 1, complete: false, ready: true, visible: true };
  const moves = Array.from({ length: 12 }, (_, index) => ({ ...move, id: `m${index}` }));
  const act = vi.fn(() => true);
  const status = vi.fn();
  const end = vi.fn();
  const player = new AutoPlayer(
    config,
    {
      frame: () => (state.ready ? { version: state.version, image, moves } : null),
      version: () => state.version,
      complete: () => state.complete,
      visible: () => state.visible,
      act,
      status,
      end,
    },
    fetcher,
  );
  return { state, moves, act, status, end, player };
}

describe("自動配置のループ", () => {
  it("同時に1件だけ推論し、停止後に届いた結果を実行しない", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { act, player } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledOnce();
    player.dispose();
    finish(Response.json({ action: "m0" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(act).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it("手動操作や敵で状態が変わったら古い行動を捨てて停止する", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { state, act, end, player } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(0);
    state.version += 1;
    finish(Response.json({ action: "m0" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(act).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    player.dispose();
  });
  it("物理・判定待ちと非表示中は推論せず、非表示で終了する", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { state, end, player } = setup(fetcher);
    state.ready = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetcher).not.toHaveBeenCalled();
    state.visible = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(end).toHaveBeenCalledOnce();
    player.dispose();
  });
  it("最大10手で停止し、操作間隔を空け、同じ候補を再実行しない", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return Response.json({ action: body.moves[0].id });
    });
    const { act, end, player } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(4999);
    expect(act).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(act).toHaveBeenCalledTimes(10);
    expect(end).toHaveBeenCalledOnce();
    expect(new Set(act.mock.calls.map((call) => call[0].id)).size).toBe(10);
    expect(fetcher).toHaveBeenCalledTimes(10);
    player.dispose();
  });
  it("クリア後とエラー後は追加リクエストを送らない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "利用できません" }, { status: 502 }));
    const { end, player } = setup(fetcher);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    player.dispose();
    const second = setup(fetcher);
    second.state.complete = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce();
    second.player.dispose();
  });
});
