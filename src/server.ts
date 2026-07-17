/**
 * server.ts — HTTP surface (Fastify).
 *
 *   GET  /health            — liveness + active provider summary
 *   GET  /                  — service manifest (what an agent reads to learn the contract)
 *   POST /identify          — FREE Stage-0 tier (instant, deterministic, no model calls)
 *   ANY  /reverse-engineer  — PAID full pipeline, gated by the OKX Payment SDK (x402 v2)
 *
 * Payment enforcement lives entirely in the SDK middleware registered by
 * registerX402Gate(): unpaid requests on the paid route — any method, including the
 * marketplace's GET `x402-check` probe — receive 402 + the base64 PAYMENT-REQUIRED
 * challenge header; verified requests reach the handler and settle after success.
 *
 * Request body for the image endpoints: { image_url } OR { image_base64 } (+ optional media_type).
 */
import Fastify from "fastify";
import { config, assertConfigured, providerSummary, VERSION } from "./config.js";
import { identify } from "./stage0/identify.js";
import { reverseEngineer } from "./pipeline.js";
import { registerX402Gate, buildChallenge, PAID_PATH, resourceUrl } from "./payment/x402.js";
import { fetchImageBuffer } from "./util.js";

interface ImageBody {
  image_url?: string;
  image_base64?: string;
}

async function resolveImage(body: ImageBody): Promise<Buffer> {
  if (body?.image_base64) {
    const cleaned = body.image_base64.replace(/^data:[^;]+;base64,/, "");
    return Buffer.from(cleaned, "base64");
  }
  if (body?.image_url) {
    return fetchImageBuffer(body.image_url);
  }
  throw new Error("provide either image_url or image_base64 in the request body");
}

export function buildServer() {
  const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 });

  // x402 payment gate (OKX Payment SDK) — must register before routes so its
  // onRequest hook runs ahead of every handler on the paid path.
  registerX402Gate(app);

  app.get("/health", async () => ({
    ok: true,
    agent: "cuerate-image-reverse-engineer",
    version: VERSION,
    providers: providerSummary(),
  }));

  app.get("/", async () => ({
    agent: "cuerate-image-reverse-engineer",
    version: VERSION,
    description:
      "Reverse-engineer an AI-generated image into the structured prompt that would " +
      "reproduce it, with per-field confidence and a self-verified trust score.",
    endpoints: {
      "POST /identify": {
        price: "free",
        body: "{ image_url } or { image_base64 }",
        returns: "Stage 0 deterministic identify (dimensions, resolution-grid match, metadata, provenance heuristic)",
      },
      [`POST ${PAID_PATH}`]: {
        price: `${config.payment.priceUsd.toFixed(2)} ${config.payment.asset} on ${config.payment.chain}`,
        payment:
          "x402 v2 — call once to receive 402 + PAYMENT-REQUIRED challenge header, " +
          "sign, retry with PAYMENT-SIGNATURE header",
        body: "{ image_url } or { image_base64 }",
        returns: "full structured prompt reconstruction + confidence + trust score",
        x402: buildChallenge(),
      },
    },
    disclaimer:
      "Reconstruction is lossy (many-to-one). Output is a prompt that plausibly reproduces " +
      "something close, not a claim about the original prompt.",
  }));

  // ── FREE Stage-0 tier ───────────────────────────────────────────────────────
  app.post<{ Body: ImageBody }>("/identify", async (req, reply) => {
    try {
      const image = await resolveImage(req.body ?? {});
      const result = await identify(image);
      return { tier: "free", stage0_identify: result };
    } catch (err) {
      reply.code(400);
      return { error: String((err as Error).message) };
    }
  });

  // ── PAID full pipeline ──────────────────────────────────────────────────────
  // Registered for GET/HEAD too: the SDK middleware answers those probes with the
  // 402 challenge before this handler is reached; a POST-only route would 404 the
  // marketplace's GET `x402-check` probe and read as "not an x402 service".
  app.route<{ Body: ImageBody }>({
    method: ["GET", "HEAD", "POST"],
    url: PAID_PATH,
    handler: async (req, reply) => {
      // Only reachable once the middleware verified payment (or dev-token access).
      // A paid GET/HEAD carries no body → point the caller at the contract instead
      // of running the pipeline on nothing.
      if (req.method !== "POST") {
        return { ok: true, usage: `POST ${resourceUrl()} with { image_url | image_base64 }` };
      }
      try {
        const image = await resolveImage(req.body ?? {});
        const result = await reverseEngineer(image);
        reply.header("x-payment-mode", config.payment.devMode ? "dev" : "live");
        return result;
      } catch (err) {
        // 400 = no settlement: the SDK only settles 2xx responses, so a bad input
        // never charges the buyer.
        reply.code(400);
        return { error: String((err as Error).message) };
      }
    },
  });

  return app;
}

// Boot when run directly.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() || "");
if (isMain || import.meta.url === `file://${process.argv[1]}`) {
  assertConfigured();
  const app = buildServer();
  app
    .listen({ port: config.port, host: "0.0.0.0" })
    .then(() => {
      app.log.info(`Cuerate RE Agent listening on :${config.port}`);
      app.log.info(providerSummary());
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
