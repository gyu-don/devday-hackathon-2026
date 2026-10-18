import { assess } from "./assess.ts";
import { enemy } from "./enemy.ts";
import { autoplay } from "./autoplay.ts";
import { handleMcpRequest, ingestGameResult } from "./mcp.ts";
export { GameEventStore } from "./game-event-store.ts";

export default {
  fetch(request, env, ctx) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const path = new URL(request.url).pathname;
    console.info(
      JSON.stringify({
        event: "request_received",
        requestId,
        method: request.method,
        path,
      }),
    );

    if (path === "/mcp") return handleMcpRequest(request, env, ctx);
    if (path === "/api/game-events") return ingestGameResult(request, env, ctx);
    const isAssessment = path === "/api/assess";
    if (isAssessment) return assess(request, env, requestId);
    const isEnemy = path === "/api/enemy";
    if (isEnemy) return enemy(request, env, requestId);
    const isAutoplay = path === "/api/autoplay";
    if (isAutoplay) return autoplay(request, env, requestId);
    const isHealth = path === "/api/health";
    if (!isHealth) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ status: "ok" }, { headers: { "x-request-id": requestId } });
  },
} satisfies ExportedHandler<Env>;
