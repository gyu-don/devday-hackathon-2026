import { z } from "zod";

export const assessmentRequestSchema = z.object({
  image: z
    .string()
    .max(1_400_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
});

export const assessmentSchema = z.object({
  tidyProbability: z.number().min(0).max(1),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  label: z.string(),
  details: z.array(z.object({ name: z.string(), score: z.number().min(0).max(100) })),
  model: z.string(),
});

export type Assessment = z.infer<typeof assessmentSchema>;
export const tidyThreshold = 0.8;

export const enemyEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const enemyModels = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-sol"] as const;
export const enemySettingsSchema = z.object({
  model: z.enum(enemyModels),
  effort: z.enum(enemyEfforts),
});
export const enemyRequestSchema = enemySettingsSchema.extend({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        category: z.enum(["books", "laundry", "trash", "dolls"]),
        placed: z.boolean(),
      }),
    )
    .min(1)
    .max(32),
  combo: z.number().int().min(0).max(10000),
  attacksLeft: z.number().int().min(1).max(5),
});
export const enemyActionSchema = z.object({
  itemId: z.string().min(1).max(100),
  quip: z.string().min(1).max(80),
});
export type EnemyAction = z.infer<typeof enemyActionSchema>;
export type EnemySettings = z.infer<typeof enemySettingsSchema>;

const placementSchema = z.object({
  x: z.number().min(-4.4).max(4.4),
  y: z.number().min(0).max(2.7),
  z: z.number().min(-3.4).max(3.4),
});
export const roomGridColumns = 20;
export const roomGridRows = 10;
export const roomRegionCount = roomGridColumns * roomGridRows;
type RegionRow = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
type RegionColumn =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20;
export type RoomRegionId = `${RegionRow}${RegionColumn}`;
export const roomRegionIds = Array.from(
  { length: roomRegionCount },
  (_, index) =>
    `${String.fromCharCode(65 + Math.floor(index / roomGridColumns))}${(index % roomGridColumns) + 1}` as RoomRegionId,
);
export const roomRegions = roomRegionIds.map((id, index) => {
  const column = index % roomGridColumns;
  const row = Math.floor(index / roomGridColumns);
  return {
    id,
    minX: -4.4 + (column * 8.8) / roomGridColumns,
    maxX: -4.4 + ((column + 1) * 8.8) / roomGridColumns,
    minZ: -3.4 + (row * 6.8) / roomGridRows,
    maxZ: -3.4 + ((row + 1) * 6.8) / roomGridRows,
  };
});
export function roomRegionAt(point: { x: number; z: number }): RoomRegionId {
  const column = Math.max(
    0,
    Math.min(roomGridColumns - 1, Math.floor((point.x + 4.4) / (8.8 / roomGridColumns))),
  );
  const row = Math.max(
    0,
    Math.min(roomGridRows - 1, Math.floor((point.z + 3.4) / (6.8 / roomGridRows))),
  );
  return roomRegionIds[row * roomGridColumns + column]!;
}
export const autoDecisionSchema = z.object({
  regions: z
    .array(
      z.object({ id: z.enum(roomRegionIds), needsTidyingProbability: z.number().min(0).max(1) }),
    )
    .length(roomRegionCount),
  sourceRegion: z.enum(roomRegionIds),
  improvementProbability: z.number().min(0).max(1),
});
export type AutoDecision = z.infer<typeof autoDecisionSchema>;
export const autoMoveSchema = z.object({
  id: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  description: z.string().min(1).max(400),
  point: placementSchema,
  source: z.object({ x: z.number().min(-6).max(6), z: z.number().min(-5).max(5) }),
});
export const autoRequestSchema = enemySettingsSchema
  .extend({
    mode: z.enum(["decisions", "agents"]),
    image: assessmentRequestSchema.shape.image,
    moves: z
      .array(autoMoveSchema)
      .min(1)
      .max(32 * roomRegionCount),
    history: z.array(z.string().max(400)).max(10),
    tidyProbability: z.number().min(0).max(1),
  })
  .superRefine((input, context) => {
    const counts = new Map<string, number>();
    for (const move of input.moves) counts.set(move.itemId, (counts.get(move.itemId) ?? 0) + 1);
    const bounded =
      counts.size <= 32 && [...counts.values()].every((count) => count <= roomRegionCount);
    if (!bounded) context.addIssue({ code: "custom", message: "Too many items or destinations" });
  });
export const autoResultSchema = z.object({
  action: z.string().min(1).max(100),
  decision: autoDecisionSchema.optional(),
});
export type AutoMove = z.infer<typeof autoMoveSchema>;
export type AutoRequest = z.infer<typeof autoRequestSchema>;
