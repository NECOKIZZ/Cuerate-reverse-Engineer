/**
 * llm.ts — the single OpenRouter client (OpenAI-compatible).
 *
 * ONE key (OPENROUTER_API_KEY) reaches Claude, GPT, Gemini and image models through one
 * endpoint. All model calls in the agent go through here, so switching or mixing models
 * is just a matter of model-slug strings in config — no per-vendor SDKs.
 */
import { config } from "./config.js";

interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.openrouter.apiKey}`,
    // Optional but recommended by OpenRouter for attribution / rankings.
    "HTTP-Referer": "https://cuerate.ai",
    "X-Title": "Cuerate Image Reverse-Engineer Agent",
  };
}

/**
 * A vision-or-text chat completion. Returns the assistant's text content.
 * Pass imageBase64 + imageMediaType to include an image (OpenAI image_url data-URI form,
 * which OpenRouter normalizes for every vendor).
 */
export async function chatComplete(opts: {
  model: string;
  system?: string;
  userText: string;
  imageBase64?: string;
  imageMediaType?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const content: ChatContentPart[] = [{ type: "text", text: opts.userText }];
  if (opts.imageBase64) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${opts.imageMediaType || "image/png"};base64,${opts.imageBase64}` },
    });
  }
  const messages: Array<{ role: string; content: unknown }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content });

  const res = await fetch(`${config.openrouter.baseURL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    // Hard per-call cap: a hung provider must never hang the paid endpoint — the
    // OKX platform test times the whole call out and rejects the listing.
    signal: AbortSignal.timeout(config.timeouts.llmMs),
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status} (${opts.model}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  const msg = data?.choices?.[0]?.message;
  const text = typeof msg?.content === "string" ? msg.content : "";
  if (!text) throw new Error(`OpenRouter returned empty content for ${opts.model}`);
  return text;
}

/**
 * Generate an image from a prompt via an OpenRouter image-capable model (e.g.
 * google/gemini-3.1-flash-image). Returns raw image bytes, or null if unavailable.
 */
export async function generateImage(prompt: string, model: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${config.openrouter.baseURL}/chat/completions`, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(config.timeouts.llmMs),
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: `Generate an image: ${prompt}` }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const images = data?.choices?.[0]?.message?.images;
    const url: string | undefined = images?.[0]?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const b64 = url.split(",")[1] ?? "";
      return Buffer.from(b64, "base64");
    }
    if (typeof url === "string" && /^https?:/i.test(url)) {
      const img = await fetch(url);
      return Buffer.from(new Uint8Array(await img.arrayBuffer()));
    }
    return null;
  } catch {
    return null;
  }
}
