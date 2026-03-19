import { z } from "zod";

export const ProxyParseRequestSchema = z.object({
  proxyInput: z.string().min(1).max(500)
});

export const ProxyCheckRequestSchema = ProxyParseRequestSchema.extend({
  testUrl: z.string().url().optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(15_000)
});
