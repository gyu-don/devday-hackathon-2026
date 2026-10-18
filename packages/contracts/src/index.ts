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
