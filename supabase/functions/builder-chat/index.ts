import { RequestError, requireBuilder, UserLimiter, readBody, validateBody } from "./security.ts";
const limiter = new UserLimiter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-builder-fallback, x-builder-model",
};

const BASE = (role: string) => `You are an expert React ${role} builder.
Rules:
- Define a function component named exactly "App" (no imports, no exports)
- Use React hooks via destructured globals (useState, useEffect, useRef, useMemo, useCallback)
- Tailwind CSS classes only
- Return ONLY the code inside a single \`\`\`jsx fence — no explanations`;

const PRESETS: Record<string, string> = {
  component: BASE("component"),
  landing: BASE("landing page") + "\n- Include hero, features, social proof, footer. Mobile-first responsive.",
  app: BASE("single-page app") + "\n- Include state, interactions, loading/error/empty states.",
  custom: BASE("developer"),
  fix: `You are a React code fixer. The user provides broken code and an error message.
Return ONLY the fixed code inside a single \`\`\`jsx fence. Keep the same component named "App", no imports, no exports.`,
  iterate: `You are an expert React iterator. The user provides existing code and asks for a modification.
Return the ENTIRE updated component (not a diff) inside a single \`\`\`jsx fence. Keep the component named "App", no imports/exports.
Preserve unrelated code exactly. Apply only the requested change.`,
};

const MISTRAL_MODELS = new Set([
  "codestral-latest",
  "mistral-large-latest",
  "mistral-small-latest",
]);

const isMistral = (m: string) => MISTRAL_MODELS.has(m) || m.startsWith("mistral");

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 600 + Math.random() * 400));
    }
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return jsonError(405, "Method not allowed");
  try {
    const userId = await requireBuilder(req, Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    limiter.consume(userId);
    const body = await readBody(req);
    validateBody(body);
    const {
      messages,
      preset = "component",
      model = "google/gemini-2.5-flash",
      customSystemPrompt,
      userApiKey,
      currentCode,
      imageDataUrl,
    } = body as { messages: Array<{role: string; content: string}>; preset?: string; model?: string; customSystemPrompt?: string; userApiKey?: string; currentCode?: string; imageDataUrl?: string };

    if (!Array.isArray(messages) || messages.length === 0) return jsonError(400, "messages must be a non-empty array");
    if (typeof model !== "string" || model.length > 80) return jsonError(400, "invalid model");

    let systemPrompt = (preset === "custom" && customSystemPrompt) || PRESETS[preset as string] || PRESETS.component;

    // Iteration context: if currentCode is provided and preset != fix, use iterate mode
    const shouldIterate = typeof currentCode === "string" && currentCode.trim().length > 0 && preset !== "fix" && preset !== "landing";
    if (shouldIterate) {
      systemPrompt = PRESETS.iterate + `\n\nCURRENT CODE:\n\`\`\`jsx\n${currentCode.slice(0, 12000)}\n\`\`\``;
    }

    // Resolve provider + key
    let endpoint: string;
    let authHeader: Record<string, string>;
    let providerName: "mistral" | "gemini";

    if (isMistral(model)) {
      providerName = "mistral";
      const key = (typeof userApiKey === "string" && userApiKey.trim()) || Deno.env.get("MISTRAL_API_KEY");
      if (!key) return jsonError(401, "missing_mistral_key", { fallback: "google/gemini-2.5-flash" });
      endpoint = "https://api.mistral.ai/v1/chat/completions";
      authHeader = { Authorization: `Bearer ${key}` };
    } else {
      providerName = "gemini";
      const key = Deno.env.get("LOVABLE_API_KEY");
      if (!key) return jsonError(500, "LOVABLE_API_KEY not configured");
      endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
      authHeader = { Authorization: `Bearer ${key}`, "Lovable-API-Key": key };
    }

    // Multimodal: if imageDataUrl is provided, convert last user message to content-array with image
    let finalMessages = messages;
    if (imageDataUrl && typeof imageDataUrl === "string" && providerName === "gemini") {
      finalMessages = messages.map((m: any, i: number) => {
        if (i === messages.length - 1 && m.role === "user") {
          return {
            role: "user",
            content: [
              { type: "text", text: typeof m.content === "string" ? m.content : "Analyze this image" },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          };
        }
        return m;
      });
    }

    const upstreamBody = JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...finalMessages],
      stream: true,
      stream_options: { include_usage: true },
    });

    const response = await retryWithBackoff(() =>
      fetch(endpoint, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: upstreamBody,
      })
    );

    if (!response.ok) {
      await response.body?.cancel();
      console.error("builder upstream failure", { provider: providerName, status: response.status });
      if (response.status === 429) return jsonError(429, "rate_limited", { provider: providerName, fallback: providerName === "mistral" ? "google/gemini-2.5-flash" : null });
      if (response.status === 402) return jsonError(402, "credits_exhausted", { provider: providerName });
      if (response.status === 401) return jsonError(401, "unauthorized", { provider: providerName, fallback: providerName === "mistral" ? "google/gemini-2.5-flash" : null });
      return jsonError(502, "upstream_error", { provider: providerName, status: response.status });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-Builder-Model": model },
    });
  } catch (e) {
    if (e instanceof RequestError) return jsonError(e.status, e.message);
    console.error("builder-chat request failed");
    return jsonError(500, "Request failed");
  }
});
