import { assessmentRequestSchema, assessmentSchema } from "@devday/contracts";
import { z } from "zod";

const LIMIT = 1_500_000;
const scoreAnswer = z.object({
  type: z.literal("score"),
  name: z.string(),
  score: z.number().min(0).max(4),
  confidence: z.number().min(0).max(1),
});
const decisionSchema = z.object({ model: z.string(), answers: z.array(z.unknown()) });
const levels = [
  {
    label: "散らかっている",
    description: "多くの本・服・ごみが床や家具の上に散らばり、整頓されていない。",
  },
  {
    label: "片付けを始めたところ",
    description: "一部を収納したが、複数の種類の散乱物が多く残っている。",
  },
  {
    label: "半分くらい整った",
    description: "床やテーブルに空きが増えたが、明確な散乱物がまだいくつもある。",
  },
  {
    label: "ほぼ整っている",
    description: "大部分は整い、残る散乱物は少数。歩く空間とテーブルがほぼ使える。",
  },
  {
    label: "きれいに整った",
    description:
      "本は棚、服はバスケットへ戻り、ごみが見当たらない。床とテーブルに散乱物がない。家具・植物・カップ・ラグ・クッションは本来の装飾であり散乱物ではない。",
  },
];

export const questions = [
  {
    type: "score",
    name: "floor",
    instructions:
      "この3Dの部屋の床に放置された本・衣類・紙くず・空き缶・人形の少なさを評価してください。ラグと家具は片付け対象ではありません。画像に見える状態だけを根拠にしてください。",
    levels,
  },
  {
    type: "score",
    name: "storage",
    instructions:
      "本・服・ごみが本棚・ランドリーバスケット・ごみ箱に収まり、人形が棚のピンクの飾り台に立ち、テーブルやソファを本来の用途に使える度合いを評価してください。テーブルのコーヒーカップとソファのクッションは散乱物ではありません。",
    levels,
  },
  {
    type: "score",
    name: "overall",
    instructions:
      "この3Dの部屋が全体としてどれくらい片付いているかを採点してください。画像に見える床・テーブル・ソファ上の本、服、紙くず、缶、人形の残り具合を根拠にします。人形は棚のピンクの飾り台が正しい置き場所です。装飾や家具の多さでは減点しないでください。",
    levels,
  },
];

function json(data: unknown, status: number, requestId: string) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "x-request-id": requestId },
  });
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing_body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    const tooLarge = length > LIMIT;
    if (tooLarge) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

export function normalizeDecision(input: unknown) {
  const decision = decisionSchema.parse(input);
  const answers = decision.answers.flatMap((answer) => {
    const result = scoreAnswer.safeParse(answer);
    return result.success ? [result.data] : [];
  });
  const overall = answers.find((answer) => answer.name === "overall");
  const floor = answers.find((answer) => answer.name === "floor");
  const storage = answers.find((answer) => answer.name === "storage");
  const isComplete = overall && floor && storage;
  if (!isComplete) throw new Error("decision_refused_or_incomplete");
  const score = Math.round(overall.score * 25);
  const label =
    score >= 85
      ? "気持ちのいい部屋です"
      : score >= 60
        ? "いい感じに整いました"
        : score >= 30
          ? "少しずつ、すっきり"
          : "まずは足元から、ひとつずつ";
  return assessmentSchema.parse({
    score,
    confidence: overall.confidence,
    label,
    details: [
      { name: "床のすっきり度", score: Math.round(floor.score * 25) },
      { name: "ものの収まり具合", score: Math.round(storage.score * 25) },
    ],
    model: decision.model,
  });
}

export async function assess(
  request: Request,
  env: Env,
  requestId: string,
  fetcher: typeof fetch = fetch,
) {
  const isPost = request.method === "POST";
  if (!isPost) return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("Origin");
  const hasWrongOrigin = origin !== null && origin !== new URL(request.url).origin;
  if (hasWrongOrigin)
    return json({ error: "このページから診断を実行してください。" }, 403, requestId);
  const isJson = request.headers.get("Content-Type")?.split(";")[0]?.trim() === "application/json";
  if (!isJson) return json({ error: "画像データの形式が正しくありません。" }, 415, requestId);
  const tooLarge = Number(request.headers.get("Content-Length") ?? 0) > LIMIT;
  if (tooLarge) return json({ error: "画像が大きすぎます。" }, 413, requestId);
  const hasKey = Boolean(env.OPENAI_API_KEY);
  if (!hasKey)
    return json(
      { error: "AI 診断はまだ準備中です。開発者が OpenAI API キーを設定すると利用できます。" },
      503,
      requestId,
    );
  let image: string;
  try {
    image = assessmentRequestSchema.parse(await readBody(request)).image;
  } catch (cause) {
    const oversized = cause instanceof Error && cause.message === "body_too_large";
    return json(
      { error: oversized ? "画像が大きすぎます。" : "部屋の画像を読み込めませんでした。" },
      oversized ? 413 : 400,
      requestId,
    );
  }
  try {
    const response = await fetcher("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": requestId,
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "これは部屋を片付けるゲームの現在のスクリーンショットです。物が適切な場所に戻っているか、画像の視覚的な状態を判定してください。",
              },
              { type: "input_image", image_url: image },
            ],
          },
        ],
        questions,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "decision_request_failed",
          requestId,
          status: response.status,
          upstreamRequestId: response.headers.get("x-request-id"),
        }),
      );
      return json(
        { error: "AI 診断に接続できませんでした。しばらくしてから試してください。" },
        502,
        requestId,
      );
    }
    const result = normalizeDecision(await response.json());
    console.info(
      JSON.stringify({
        event: "room_assessed",
        requestId,
        score: result.score,
        model: result.model,
      }),
    );
    return json(result, 200, requestId);
  } catch {
    console.error(JSON.stringify({ event: "decision_request_error", requestId }));
    return json(
      { error: "AI が部屋を判定できませんでした。もう一度試してください。" },
      502,
      requestId,
    );
  }
}
