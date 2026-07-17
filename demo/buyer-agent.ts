/**
 * buyer-agent.ts — a demo "buyer agent" that calls the RE Agent mid-task and pays per call.
 *
 * This is the 90-second-demo script in code form. It:
 *   1. Calls the FREE /identify tier first (instant deterministic signal).
 *   2. Calls the PAID /reverse-engineer with NO payment → receives HTTP 402 + requirements.
 *   3. "Settles" (dev mode: attaches the dev token) and retries with X-Payment.
 *   4. Prints the reconstructed prompt + trust score it can now use to recreate the asset.
 *
 * Usage:
 *   # start the server in another terminal:  npm run server
 *   npx tsx demo/buyer-agent.ts <image_url|path>
 *   (defaults to a bundled/sample image if none given)
 */
import { readFileSync } from "node:fs";
import { config } from "../src/config.js";

const BASE = process.env.RE_BASE_URL || `http://localhost:${config.port}`;
const arg = process.argv[2];

function log(step: string, msg: string) {
  console.log(`\n\x1b[36m▸ ${step}\x1b[0m ${msg}`);
}

async function buildBody(): Promise<Record<string, string>> {
  if (!arg) throw new Error("pass an image URL or local file path as the first argument");
  if (/^https?:\/\//i.test(arg)) return { image_url: arg };
  // local file → base64
  const b64 = readFileSync(arg).toString("base64");
  return { image_base64: b64 };
}

async function main() {
  const body = await buildBody();
  console.log(`\x1b[1mCuerate RE Agent — buyer-agent demo\x1b[0m  (endpoint: ${BASE})`);

  // ── 1. FREE identify tier ──────────────────────────────────────────────────
  log("STEP 1", "calling FREE /identify (instant, no payment)…");
  const idRes = await fetch(`${BASE}/identify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const idJson = (await idRes.json()) as any;
  const s0 = idJson.stage0_identify;
  console.log(
    `   dimensions: ${s0?.width}×${s0?.height} · grid match: ${
      s0?.resolution_match?.matched ? s0.resolution_match.model_family : "none"
    } · provenance: ${s0?.provenance_signal?.label}`,
  );

  // ── 2. PAID call WITHOUT payment → expect 402 ──────────────────────────────
  log("STEP 2", "calling PAID /reverse-engineer with NO payment (expecting 402)…");
  const unpaid = await fetch(`${BASE}/reverse-engineer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`   → HTTP ${unpaid.status} ${unpaid.statusText}`);
  const req402 = (await unpaid.json()) as any;
  if (unpaid.status === 402) {
    const a = req402.accepts?.[0];
    const hdr = unpaid.headers.get("payment-required");
    console.log(
      `   payment required: ${a?.amount} atomic of ${a?.asset} on ${a?.network} → ${a?.payTo}`,
    );
    console.log(`   PAYMENT-REQUIRED header present: ${hdr ? "yes (base64 challenge)" : "NO — x402 broken!"}`);
  }

  // ── 3. "Settle" and retry with X-Payment ───────────────────────────────────
  log("STEP 3", "settling payment (dev token) and retrying with X-Payment header…");
  const paid = await fetch(`${BASE}/reverse-engineer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment": config.payment.devToken,
    },
    body: JSON.stringify(body),
  });
  console.log(`   → HTTP ${paid.status} (payment mode: ${paid.headers.get("x-payment-mode")})`);
  const result = (await paid.json()) as any;
  if (paid.status !== 200) {
    console.error("   error:", result);
    process.exit(1);
  }

  // ── 4. Use the result ──────────────────────────────────────────────────────
  log("STEP 4", "the agent now has a reusable prompt:");
  console.log("\n\x1b[1mReconstructed prompt:\x1b[0m");
  console.log("  " + result.fields.reconstructed_prompt);
  console.log(
    `\n\x1b[1mTrust score:\x1b[0m ${(result.trust.trust_score * 100).toFixed(0)}% (method: ${
      result.trust.method
    })`,
  );
  console.log(
    `\x1b[1mEnsemble:\x1b[0m ${result.ensemble.successful}/${result.ensemble.size} passes · sources: ${result.ensemble.sources.join(", ")}`,
  );
  console.log("\n\x1b[1mPer-field confidence:\x1b[0m");
  for (const [k, v] of Object.entries<any>(result.fields)) {
    if (v && typeof v === "object" && "confidence" in v) {
      const bar = "█".repeat(Math.round(v.confidence * 10)).padEnd(10, "░");
      console.log(`  ${k.padEnd(28)} ${bar} ${(v.confidence * 100).toFixed(0)}%`);
    }
  }
  console.log(
    `\n\x1b[1mCuerate flywheel:\x1b[0m seed_eligible=${result.cuerate_pair.seed_eligible} ` +
      `(this verified pair ${result.cuerate_pair.seed_eligible ? "WILL" : "will not yet"} seed the marketplace)`,
  );
  console.log(`\n\x1b[2mtiming: ${JSON.stringify(result.timing_ms)} ms\x1b[0m`);
}

main().catch((err) => {
  console.error("demo failed:", err.message);
  process.exit(1);
});
