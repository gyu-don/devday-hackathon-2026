import { describe, expect, it, vi } from "vitest";
import { assess, normalizeDecision } from "../apps/worker/src/assess.ts";

const image = "data:image/jpeg;base64,/9j/2Q==";
const request = (body: unknown = { image }, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const decision = {
  model: "gpt-6-luna",
  answers: [
    { type: "score", name: "floor", score: 2, confidence: 0.8 },
    { type: "score", name: "storage", score: 4, confidence: 0.9 },
    { type: "score", name: "overall", score: 3.2, confidence: 0.85 },
  ],
};

describe("片付け診断", () => {
  it("確率加重スコアを 0〜100 に換算し、個別の判定と信頼度を保持する", () => {
    expect(normalizeDecision(decision)).toMatchObject({
      score: 80,
      confidence: 0.85,
      details: [
        { name: "床のすっきり度", score: 50 },
        { name: "ものの収まり具合", score: 100 },
      ],
    });
  });

  it("拒否または欠けた回答を成功した診断として表示しない", () => {
    expect(() =>
      normalizeDecision({ model: "gpt-6-luna", answers: [{ type: "refusal", name: "overall" }] }),
    ).toThrow("decision_refused_or_incomplete");
  });

  it("API キー未設定時は外部 API を呼び出さない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await assess(request(), { OPENAI_API_KEY: "" }, "test-request", fetcher);
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("任意の外部画像 URL を中継しない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await assess(
      request({ image: "https://example.com/image.jpg" }),
      { OPENAI_API_KEY: "test" },
      "test-request",
      fetcher,
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("別 Origin と過大なリクエストを上流に送信しない", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const wrongOrigin = await assess(
      request({ image }, { Origin: "https://example.com" }),
      { OPENAI_API_KEY: "test" },
      "test-request",
      fetcher,
    );
    const oversized = await assess(
      request({ image }, { "Content-Length": "1600000" }),
      { OPENAI_API_KEY: "test" },
      "test-request",
      fetcher,
    );
    expect(wrongOrigin.status).toBe(403);
    expect(oversized.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("画像と3つの score 質問を Decisions API に渡し、正規化した結果を返す", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(decision));
    const response = await assess(request(), { OPENAI_API_KEY: "test" }, "test-request", fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ score: 80, model: "gpt-6-luna" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/decisions");
    const payload = JSON.parse(String(options?.body));
    expect(payload.input[0].content[1]).toEqual({ type: "input_image", image_url: image });
    expect(payload.questions.map((question: { name: string }) => question.name)).toEqual([
      "floor",
      "storage",
      "overall",
    ]);
    expect(response.headers.get("x-request-id")).toBe("test-request");
  });

  it("上流のエラーメッセージや資格情報をブラウザに返さない", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private upstream details", { status: 401 }));
    const response = await assess(request(), { OPENAI_API_KEY: "test" }, "test-request", fetcher);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private upstream details");
  });
});
