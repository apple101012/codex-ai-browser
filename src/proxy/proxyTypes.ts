import { z } from "zod";

export const ProxyConfigSchema = z.object({
  server: z.string().min(3).max(500),
  username: z.string().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional()
});

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

export const ProxyConfigInputSchema = z
  .union([
    ProxyConfigSchema,
    z.string().min(1).max(500),
    z.null()
  ])
  .optional();

export type ProxyConfigInput = z.infer<typeof ProxyConfigInputSchema>;
