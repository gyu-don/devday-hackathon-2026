export default {
  fetch(request) {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    console.info(
      JSON.stringify({
        event: "request_received",
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
      }),
    );

    return Response.json({ status: "ok" }, { headers: { "x-request-id": requestId } });
  },
} satisfies ExportedHandler<Env>;
