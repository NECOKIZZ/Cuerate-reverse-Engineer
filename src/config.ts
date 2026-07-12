/**
 * config.ts — central runtime configuration.
 *
 * Reads .env. The ONLY required key is OPENROUTER_API_KEY — one key reaches every model
 * (Claude / GPT / Gemini / image models) through OpenRouter's OpenAI-compatible API.
 * Everything else has sensible defaults and degrades gracefully.
 */
import "dotenv/config";

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function csv(v: string | undefined, dflt: string[]): string[] {
  if (!v) return dflt;
  const list = v.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : dflt;
}

export const VERSION = "0.1.0";

// Default ensemble: a genuine multi-vendor mix, all reachable via the single OpenRouter key.
// Each pass fails independently and gracefully, so a bad slug never breaks the whole call.
const DEFAULT_ENSEMBLE = [
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-luna",
  "google/gemini-3.5-flash",
];

export const config = {
  version: VERSION,

  // ── The one provider: OpenRouter ────────────────────────────────────────────
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseURL: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  },

  // ── Ensemble (Stage 1) ──────────────────────────────────────────────────────
  // The list of model slugs run independently as the describer ensemble. More/different
  // slugs = a stronger, more diverse ensemble. Override with ENSEMBLE_MODELS (comma-sep).
  ensembleModels: csv(process.env.ENSEMBLE_MODELS, DEFAULT_ENSEMBLE),

  // The model that merges the ensemble into the final confidence-scored JSON (Stage 1.5).
  aggregatorModel: process.env.AGGREGATOR_MODEL || "anthropic/claude-sonnet-5",

  // Passes used in offline mock mode (no network).
  ensembleSize: Math.max(2, num(process.env.ENSEMBLE_SIZE, 3)),

  // ── Stage 2 verification ────────────────────────────────────────────────────
  // Set IMAGE_GEN_MODEL to an OpenRouter image-capable slug (e.g. google/gemini-3.1-flash-image)
  // to turn on the real regenerate-and-compare trust loop. Blank = agreement-based trust score.
  imageGen: {
    model: process.env.IMAGE_GEN_MODEL ?? "",
    get enabled() {
      return !!this.model;
    },
  },

  // Offline deterministic mode — no network, no API key. Runs the whole pipeline with
  // image-statistics-derived (clearly-labeled MOCK) output. For demos/CI or restricted envs.
  mockLlm: bool(process.env.MOCK_LLM, false),

  // ── Payment (x402 · OKX A2MCP) ──────────────────────────────────────────────
  payment: {
    priceUsd: num(process.env.RE_PRICE_USD, 0.35),
    asset: process.env.PAYMENT_ASSET || "USDT",
    chain: process.env.PAYMENT_CHAIN || "X Layer",
    payTo: process.env.PAYMENT_ADDRESS || "0xYOUR_OKX_AGENTIC_WALLET_ADDRESS",
    devMode: bool(process.env.PAYMENT_DEV_MODE, true),
    devToken: process.env.PAYMENT_DEV_TOKEN || "dev-okx-demo-token",
  },

  // ── Server ──────────────────────────────────────────────────────────────────
  port: num(process.env.PORT, 8787),

  // ── Cuerate flywheel ────────────────────────────────────────────────────────
  cuerateSeedThreshold: num(process.env.CUERATE_SEED_THRESHOLD, 0.55),
} as const;

export function assertConfigured(): void {
  if (config.mockLlm) return; // mock mode needs no key
  if (!config.openrouter.apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your OpenRouter key " +
        "(get one at https://openrouter.ai/keys) — or set MOCK_LLM=true to run offline. " +
        "This is the ONLY key you need.",
    );
  }
}

/** Human-readable summary of what's active — printed on server boot. */
export function providerSummary(): string {
  if (config.mockLlm) {
    return `⚠️ MOCK MODE (offline, no real vision) · ensemble×${config.ensembleSize} · payment: ${
      config.payment.devMode ? "DEV" : "LIVE"
    }`;
  }
  const stage2 = config.imageGen.enabled
    ? `regenerate-verified (${config.imageGen.model})`
    : "agreement-based";
  return (
    `via OpenRouter · ensemble: [${config.ensembleModels.join(", ")}] · ` +
    `aggregator: ${config.aggregatorModel} · stage2: ${stage2} · ` +
    `payment: ${config.payment.devMode ? "DEV MODE" : "LIVE"} ` +
    `(${config.payment.priceUsd} ${config.payment.asset} on ${config.payment.chain})`
  );
}
