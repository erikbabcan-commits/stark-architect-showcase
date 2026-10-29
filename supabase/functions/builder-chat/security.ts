// All authorization decisions use server-verified app_metadata, never user_metadata.
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireBuilder(
  req: Request, url: string, anonKey: string, fetcher: typeof fetch = fetch,
): Promise<string> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]{16,4096}$/.test(authorization)) throw new RequestError(401, "Authentication required");
  if (!url || !anonKey) throw new RequestError(503, "Authentication unavailable");
  let response: Response;
  try {
    response = await fetcher(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch { throw new RequestError(503, "Authentication unavailable"); }
  if (!response.ok) {
    throw new RequestError(response.status >= 500 ? 503 : 401, "Authentication required");
  }
  let user;
  try { user = await response.json(); } catch { throw new RequestError(503, "Authentication unavailable"); }
  const roles = user?.app_metadata?.roles;
  if (!user?.id || user?.role !== "authenticated" || user?.is_anonymous === true ||
      !(user?.app_metadata?.builder_enabled === true ||
        (Array.isArray(roles) && roles.includes("builder")))) {
    throw new RequestError(403, "Builder access required");
  }
  return user.id;
}

// Per-isolate defense only. A shared gateway quota is required for a multi-instance
// deployment; this map is deliberately bounded and fails closed at capacity.
export class UserLimiter {
  private buckets = new Map<string, { count: number; expires: number }>();
  constructor(private limit = 10, private windowMs = 60_000, private capacity = 10_000) {}
  consume(user: string, now = Date.now()): void {
    for (const [key, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(key);
    const bucket = this.buckets.get(user);
    if (bucket && bucket.count >= this.limit) throw new RequestError(429, "Rate limited");
    if (!bucket && this.buckets.size >= this.capacity) throw new RequestError(503, "Capacity unavailable");
    this.buckets.set(user, { count: (bucket?.count ?? 0) + 1, expires: bucket?.expires ?? now + this.windowMs });
  }
}

export async function readBody(req: Request, max = 131_072): Promise<Record<string, unknown>> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new RequestError(413, "Request too large");
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "JSON required");
  if (!req.body) throw new RequestError(400, "Invalid JSON");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new RequestError(413, "Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new RequestError(400, "Invalid JSON"); }
}

export function validateBody(body: Record<string, unknown>): void {
  const models = new Set(["google/gemini-2.5-flash", "codestral-latest", "mistral-large-latest", "mistral-small-latest"]);
  if (body.model !== undefined && !models.has(body.model as string)) throw new RequestError(400, "Invalid model");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 32 ||
      body.messages.some(m => !m || !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" || m.content.length > 8000)) throw new RequestError(400, "Invalid messages");
  for (const [key, max] of Object.entries({ customSystemPrompt: 4000, currentCode: 12000, userApiKey: 512, imageDataUrl: 65536 })) {
    if (body[key] !== undefined && (typeof body[key] !== "string" || (body[key] as string).length > max)) throw new RequestError(400, "Invalid request");
  }
  if (body.preset !== undefined && !["component", "landing", "app", "custom", "fix", "iterate"].includes(body.preset as string)) throw new RequestError(400, "Invalid preset");
}
