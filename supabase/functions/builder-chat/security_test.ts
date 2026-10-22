import { RequestError, requireBuilder, UserLimiter, readBody, validateBody } from "./security.ts";
function assert(ok: boolean) { if (!ok) throw new Error("assertion failed"); }
async function rejects(fn: () => unknown, status: number) {
  try { await fn(); } catch (e) { assert(e instanceof RequestError && e.status === status); return; }
  throw new Error("expected rejection");
}
const req = () => new Request("https://example.invalid/", { headers: { Authorization: "Bearer synthetic-fixture-credential" } });
const mockUser = (user: unknown) => (() => Promise.resolve(Response.json(user))) as typeof fetch;
Deno.test("anonymous rejected before auth provider call", async () => {
  await rejects(() => requireBuilder(new Request("https://example.invalid/"), "", "", (() => { throw new Error("must not fetch"); }) as typeof fetch), 401);
});
Deno.test("anon identity, user-editable role and missing entitlement rejected", async () => {
  for (const user of [ {id: "fixture", role: "anon"}, {id: "fixture", role: "authenticated", user_metadata: {roles: ["builder"]}}, {id: "fixture", role: "authenticated", is_anonymous: true, app_metadata: {builder_enabled: true}} ]) {
    await rejects(() => requireBuilder(req(), "https://example.invalid", "fixture-key", mockUser(user)), 403);
  }
});
Deno.test("verified builder accepted; unavailable auth fails closed", async () => {
  assert(await requireBuilder(req(), "https://example.invalid", "fixture-key", mockUser({id: "fixture", role: "authenticated", app_metadata: {roles: ["builder"]}})) === "fixture");
  await rejects(() => requireBuilder(req(), "https://example.invalid", "fixture-key", (() => { throw new Error("offline"); }) as typeof fetch), 503);
});
Deno.test("per-user limits, bounded capacity and expiry", async () => {
  const limiter = new UserLimiter(1, 100, 2);
  limiter.consume("one", 0); await rejects(() => limiter.consume("one", 1), 429);
  limiter.consume("two", 0); await rejects(() => limiter.consume("three", 1), 503);
  limiter.consume("one", 101);
});
Deno.test("streamed body size, malformed JSON and models/messages are bounded", async () => {
  await rejects(() => readBody(new Request("https://example.invalid", {method: "POST", headers: {"Content-Type": "application/json"}, body: " ".repeat(64)}), 32), 413);
  await rejects(() => readBody(new Request("https://example.invalid", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{"})), 400);
  await rejects(() => validateBody({messages: [{role: "system", content: "fixture"}]}), 400);
  await rejects(() => validateBody({messages: [{role: "user", content: "fixture"}], model: "unapproved"}), 400);
  validateBody({messages: [{role: "user", content: "synthetic fixture"}]});
});
