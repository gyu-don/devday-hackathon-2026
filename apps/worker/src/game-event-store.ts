import type { GameFinishedEvent } from "@devday/contracts";

export type GameSubscription = {
  id: string;
  name: string;
  arguments: Record<string, never>;
  callbackUrl: string;
  secret: string;
  expiresAt: number;
  cursor: string | null;
  acknowledged?: string[];
};
export type IngestResult = {
  event: GameFinishedEvent;
  duplicate: boolean;
  subscriptions: GameSubscription[];
};
export type RecentEvents = {
  events: GameFinishedEvent[];
  latest_cursor: string | null;
  truncated: boolean;
};
type StoreCommand = {
  fingerprint: string;
  expiresAt: number;
  event: GameFinishedEvent;
  limit: number;
  afterCursor: string | null;
  subscription: GameSubscription;
  cursor: string | null;
  id: string;
};
const json = (body: unknown, status = 200) => Response.json(body, { status });

// phone-sensor-controller-pocのGameEventStoreを移植。
// ハッカソン審査向け: MCP Eventsの購読と結果をDurable Objectに永続化し、
// dots / ChatGPT Workなどが再接続してもcursorから結果を受け取れるようにする。
// デモ用の共有ストリームであり、プレイヤー別の認証や振り分けは行わない。
export class GameEventStore implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  private async subscriptions() {
    return (await this.ctx.storage.get<GameSubscription[]>("subscriptions")) ?? [];
  }

  private async events() {
    return (await this.ctx.storage.get<GameFinishedEvent[]>("events")) ?? [];
  }

  private async scheduleCleanup(subscriptions: GameSubscription[]) {
    const active = subscriptions.filter((item) => item.expiresAt > Date.now());
    if (active.length) await this.ctx.storage.setAlarm(Math.min(...active.map((item) => item.expiresAt)));
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    // 保存と重複チェック、購読更新を直列化し、同時リクエストで上書きしない。
    return this.ctx.blockConcurrencyWhile(() => this.handle(request));
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    let body: StoreCommand;
    try { body = await request.json<StoreCommand>(); }
    catch { return json({ error: "Invalid JSON" }, 400); }
    const path = new URL(request.url).pathname;
    const now = Date.now();

    if (path === "/callbacks/is-verified" || path === "/callbacks/mark-verified") {
      const callbacks = (await this.ctx.storage.get<Record<string, number>>("verifiedCallbacks")) ?? {};
      for (const [fingerprint, expiresAt] of Object.entries(callbacks)) {
        if (expiresAt <= now) delete callbacks[fingerprint];
      }
      if (path === "/callbacks/mark-verified") callbacks[body.fingerprint] = body.expiresAt;
      await this.ctx.storage.put("verifiedCallbacks", callbacks);
      return json({ verified: (callbacks[body.fingerprint] ?? 0) > now });
    }

    if (path === "/events/ingest") {
      const event = body.event;
      if (!event || typeof event.eventId !== "string") return json({ error: "Invalid event" }, 400);
      const events = await this.events();
      const duplicate = events.find((saved) => saved.eventId === event.eventId);
      if (duplicate) return json({ event: duplicate, duplicate: true, subscriptions: [] });
      let rate = (await this.ctx.storage.get<{ start: number; count: number }>("ingestRate")) ?? { start: now, count: 0 };
      if (now - rate.start >= 60_000) rate = { start: now, count: 0 };
      if (rate.count >= 60) return json({ error: "Event submission limit reached" }, 429);
      rate.count++;
      const sequence = ((await this.ctx.storage.get<number>("sequence")) ?? 0) + 1;
      const storedEvent = { ...event, cursor: String(sequence) };
      events.push(storedEvent);
      if (events.length > 100) events.splice(0, events.length - 100);
      await this.ctx.storage.put({ events, sequence, ingestRate: rate });
      const subscriptions = (await this.subscriptions()).filter((item) => item.expiresAt > now && item.name === event.name);
      return json({ event: storedEvent, duplicate: false, subscriptions });
    }

    if (path === "/events/recent") {
      const events = await this.events();
      const limit = Math.max(1, Math.min(50, Number.isInteger(body.limit) ? body.limit : 10));
      const after = body.afterCursor == null ? null : Number(body.afterCursor);
      const selected = after === null ? events.slice(-limit) : events.filter((event) => Number(event.cursor) > after).slice(0, limit);
      const oldest = Number(events[0]?.cursor ?? 0);
      const latest = (await this.ctx.storage.get<number>("sequence")) ?? 0;
      return json({ events: selected, latest_cursor: latest ? String(latest) : null, truncated: after !== null && after < oldest - 1 });
    }

    if (path === "/subscriptions/upsert") {
      const subscriptions = (await this.subscriptions()).filter((item) => item.expiresAt > now);
      const sequence = (await this.ctx.storage.get<number>("sequence")) ?? 0;
      const index = subscriptions.findIndex((item) => item.id === body.subscription.id);
      const previous = subscriptions[index];
      const cursor = body.cursor ?? previous?.cursor ?? String(sequence);
      // 未来のcursorで以後の結果を取りこぼさない。
      if (Number(cursor) > sequence) return json({ error: "Cursor is ahead of the event stream" }, 400);
      const subscription: GameSubscription = { ...body.subscription, cursor, acknowledged: previous?.acknowledged ?? [] };
      if (index < 0 && subscriptions.length >= 200) return json({ error: "Subscription limit reached" }, 429);
      if (index < 0) subscriptions.push(subscription);
      else subscriptions[index] = subscription;
      await this.ctx.storage.put("subscriptions", subscriptions);
      await this.scheduleCleanup(subscriptions);
      const events = await this.events();
      const truncated = events.length > 0 && Number(cursor) < Number(events[0]!.cursor) - 1;
      const replay = events.filter((event) => Number(event.cursor) > Number(cursor) && event.name === subscription.name);
      return json({ subscription, replay, truncated });
    }

    if (path === "/subscriptions/advance") {
      const subscriptions = await this.subscriptions();
      const subscription = subscriptions.find((item) => item.id === body.id);
      if (subscription && Number(body.cursor) > Number(subscription.cursor ?? 0)) {
        // Webhookが順不同で成功しても、未配信の結果を飛ばすcursorを返さない。
        const acknowledged = new Set(subscription.acknowledged ?? []);
        acknowledged.add(String(body.cursor));
        let cursor = Number(subscription.cursor ?? 0);
        while (acknowledged.delete(String(cursor + 1))) cursor++;
        subscription.cursor = String(cursor);
        subscription.acknowledged = [...acknowledged].slice(-100);
        await this.ctx.storage.put("subscriptions", subscriptions);
      }
      return json({ ok: true });
    }

    if (path === "/subscriptions/delete") {
      const remaining = (await this.subscriptions()).filter((item) => item.id !== body.id);
      await this.ctx.storage.put("subscriptions", remaining);
      await this.scheduleCleanup(remaining);
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  async alarm() {
    const now = Date.now();
    const subscriptions = (await this.subscriptions()).filter((item) => item.expiresAt > now);
    await this.ctx.storage.put("subscriptions", subscriptions);
    const callbacks = (await this.ctx.storage.get<Record<string, number>>("verifiedCallbacks")) ?? {};
    for (const [fingerprint, expiresAt] of Object.entries(callbacks)) if (expiresAt <= now) delete callbacks[fingerprint];
    await this.ctx.storage.put("verifiedCallbacks", callbacks);
    await this.scheduleCleanup(subscriptions);
  }
}
