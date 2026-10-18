import { z } from "zod";

export const assessmentRequestSchema = z.object({
  image: z
    .string()
    .max(1_400_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
});

export const assessmentSchema = z.object({
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  label: z.string(),
  details: z.array(z.object({ name: z.string(), score: z.number().min(0).max(100) })),
  model: z.string(),
});

export type Assessment = z.infer<typeof assessmentSchema>;
