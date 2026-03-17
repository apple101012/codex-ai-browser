import type { FastifyReply, FastifyRequest } from "fastify";

export const authHook =
  (token: string | undefined) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.url === "/health" || request.url === "/app" || request.url.startsWith("/app/")) {
      return;
    }

    if (!token) {
      return;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "Missing bearer token." });
      return;
    }

    const incoming = header.slice("Bearer ".length).trim();
    if (incoming !== token) {
      await reply.code(403).send({ error: "Invalid token." });
    }
  };
