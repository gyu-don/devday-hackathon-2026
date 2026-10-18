import { assess } from "./assess.ts";
import { enemy } from "./enemy.ts";

export default {
  fetch(request, env) {
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

    const isAssessment = path === "/api/assess";
    if (isAssessment) return assess(request, env, requestId);
    const isEnemy = path === "/api/enemy";
    if (isEnemy) return enemy(request, env, requestId);
    const isHealth = path === "/api/health";
    if (!isHealth) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ status: "ok" }, { headers: { "x-request-id": requestId } });
  },
} satisfies ExportedHandler<Env>;
