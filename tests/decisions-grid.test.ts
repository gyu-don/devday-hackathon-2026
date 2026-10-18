import { describe, expect, it, vi } from "vitest";
import { roomRegions, roomRegionAt, autoRequestSchema } from "../packages/contracts/src/index.ts";
import { planWithDecisions } from "../apps/worker/src/decisions-planner.ts";

const moves = Array.from({ length: 200 }, (_, index) => ({
  id: `book__T${index + 1}`,
  itemId: "book",
  source: { x: 0, z: 0 },
  point: {
    x: (roomRegions[index]!.minX + roomRegions[index]!.maxX) / 2,
    y: 0.1,
    z: (roomRegions[index]!.minZ + roomRegions[index]!.maxZ) / 2,
  },
  description: `本をT${index + 1}へ置く`,
}));
const input = {
  mode: "decisions" as const,
  model: "gpt-6-luna" as const,
  effort: "low" as const,
  image: "data:image/jpeg;base64,/9j/2Q==",
  moves,
  history: [],
  tidyProbability: 0.2,
};
type Question = { name: string };
const answer = (questions: Question[]) =>
  Response.json({
    answers: questions.map((question) => ({
      name: question.name,
      type: "predicate",
      probability: question.name === "move_199" ? 0.98 : 0.7,
    })),
  });

describe("200区画の確率による操作判断", () => {
  it("床面を重複しない200区画で覆い、境界と端の座標も区画に割り当てる", () => {
    expect(roomRegions).toHaveLength(200);
    expect(new Set(roomRegions.map((region) => region.id)).size).toBe(200);
    expect(roomRegionAt({ x: -4.4, z: -3.4 })).toBe("A1");
    expect(roomRegionAt({ x: 4.4, z: 3.4 })).toBe("J20");
    expect(roomRegionAt({ x: 0, z: 0 })).toBe("F11");
    const area = roomRegions.reduce(
      (sum, region) => sum + (region.maxX - region.minX) * (region.maxZ - region.minZ),
      0,
    );
    expect(area).toBeCloseTo(8.8 * 6.8);
    for (const region of roomRegions)
      expect(
        roomRegionAt({ x: (region.minX + region.maxX) / 2, z: (region.minZ + region.maxZ) / 2 }),
      ).toBe(region.id);
  });
  it("区画200・対象1・配置200の別リクエストで上限を守り、最大の予測確率を選ぶ", async () => {
    const infer = vi
      .fn()
      .mockImplementation(async (body: { questions: Question[] }) => answer(body.questions));
    const result = await planWithDecisions(input, infer);
    expect(infer.mock.calls.map((call) => call[0].questions.length)).toEqual([200, 1, 200]);
    expect(result.action).toBe("book__T200");
    expect(result.decision.regions).toHaveLength(200);
    expect(result.decision.improvementProbability).toBe(0.98);
    expect(result).not.toHaveProperty("tidyProbability");
  });
  it("欠落・重複・拒否・範囲外・未完了の確率を0に置き換えない", async () => {
    for (const kind of ["missing", "duplicate", "refusal", "range", "incomplete"]) {
      const infer = vi.fn().mockImplementation(async (body: { questions: Question[] }) => {
        const answers: Array<Record<string, unknown>> = body.questions.map((question) => ({
          type: "predicate",
          name: question.name,
          probability: 0.7,
        }));
        if (kind === "missing") answers.pop();
        if (kind === "duplicate") answers[1] = answers[0]!;
        if (kind === "refusal") answers[0] = { type: "refusal", name: body.questions[0]!.name };
        if (kind === "range") answers[0]!.probability = 2;
        return Response.json({
          answers,
          ...(kind === "incomplete" ? { status: "incomplete" } : {}),
        });
      });
      await expect(planWithDecisions(input, infer)).rejects.toThrow();
      expect(infer).toHaveBeenCalledOnce();
    }
  });
  it("同じ物への配置が201候補なら推論前の入力検証で拒否する", () => {
    expect(autoRequestSchema.safeParse(input).success).toBe(true);
    expect(
      autoRequestSchema.safeParse({ ...input, moves: [...moves, { ...moves[0], id: "extra" }] })
        .success,
    ).toBe(false);
  });
});
