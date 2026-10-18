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
export const autoMoveSchema = z.object({
  id: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  description: z.string().min(1).max(400),
  point: placementSchema,
});
export const autoRequestSchema = enemySettingsSchema.extend({
  mode: z.enum(["decisions", "agents"]),
  image: assessmentRequestSchema.shape.image,
  moves: z.array(autoMoveSchema).min(1).max(200),
  history: z.array(z.string().max(400)).max(10),
  tidyProbability: z.number().min(0).max(1),
});
export const autoResultSchema = z.object({ action: z.string().min(1).max(100) });
export type AutoMove = z.infer<typeof autoMoveSchema>;
export type AutoRequest = z.infer<typeof autoRequestSchema>;
