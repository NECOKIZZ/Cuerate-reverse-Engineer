/**
 * server.ts — HTTP surface (Fastify).
 *
 *   GET  /health            — liveness + active provider summary
 *   GET  /                  — service manifest (what an agent reads to learn the contract)
 *   POST /identify          — FREE Stage-0 tier (instant, deterministic, no model calls)
 *   POST /reverse-engineer  — PAID full pipeline (402-gated), the product
 *
 * Request body for the image endpoints: { image_url } OR { image_base64 } (+ optional media_type).
 */
import Fastify from "fastify";
import { config, assertConfigured, providerSummary, VERSION } from "./config.js";
import { identify } from "./stage0/identify.js";
import { reverseEngineer } from "./pipeline.js";
import { buildRequirements, paymentRequiredHeader, verifyPayment } from "./payment/x402.js";
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
      "POST /reverse-engineer": {
        price: `${config.payment.priceUsd.toFixed(2)} ${config.payment.asset} on ${config.payment.chain}`,
        payment: "x402 — call once to receive 402 + payment requirements, settle, retry with X-Payment header",
        body: "{ image_url } or { image_base64 }",
        returns: "full structured prompt reconstruction + confidence + trust score",
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

  // ── PAID full pipeline (402-gated) ───────────────────────────────────────────
  // Registered for GET/HEAD too: x402 validators (e.g. OKX `x402-check`) probe the
  // endpoint without a body expecting the 402 challenge — a POST-only route would
  // 404 and read as "not an x402 service".
  app.route<{ Body: ImageBody }>({
    method: ["GET", "HEAD", "POST"],
    url: "/reverse-engineer",
    handler: async (req, reply) => {
      // x402 payment proof: `X-Payment` (v1) or `PAYMENT-SIGNATURE` (v2 clients).
      const paymentHeader = (req.headers["x-payment"] ?? req.headers["payment-signature"]) as
        | string
        | undefined;
      // Non-POST = discovery probe: always answer the challenge, and never touch
      // settlement (verifying here could settle real money against a 402 reply).
      const check =
        req.method === "POST"
          ? await verifyPayment(paymentHeader, "/reverse-engineer")
          : ({ ok: false } as const);
      if (!check.ok) {
        // x402 challenge: the PAYMENT-REQUIRED header carries the base64 JSON
        // {x402Version, resource, accepts:[{scheme, network, asset, amount, payTo, ...}]}
        // that a paying agent decodes, signs, and retries with. Body mirrors it in
        // plain JSON for humans/debuggers.
        reply.code(402);
        reply.header("PAYMENT-REQUIRED", paymentRequiredHeader("/reverse-engineer"));
        reply.header("accept-payment", "x402");
        return buildRequirements("/reverse-engineer");
      }

      try {
        const image = await resolveImage(req.body ?? {});
        const result = await reverseEngineer(image);
        reply.header("x-payment-mode", check.mode);
        return result;
      } catch (err) {
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
