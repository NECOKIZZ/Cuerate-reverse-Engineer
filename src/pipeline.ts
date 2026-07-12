/**
 * pipeline.ts — orchestrates Stage 0 -> 1 -> 2 into the single result the API returns.
 *
 * Input: an image Buffer (from URL fetch or base64). Output: ReverseEngineerResult.
 * This is the pure core — no HTTP, no payment, no MCP — so it's reusable everywhere.
 */
import { config, VERSION } from "./config.js";
import {
  DISCLAIMER,
  type ReverseEngineerResult,
} from "./schema.js";
import { identify } from "./stage0/identify.js";
import { runEnsemble } from "./stage1/describers.js";
import { aggregate, agreementScore } from "./stage1/aggregator.js";
import { verify } from "./stage2/verify.js";
import { toMediaType } from "./util.js";

export async function reverseEngineer(imageBuffer: Buffer): Promise<ReverseEngineerResult> {
  const t0 = performance.now();

  // ── Stage 0: Identify (deterministic) ──────────────────────────────────────
  const stage0 = await identify(imageBuffer);
  const t1 = performance.now();

  const base64 = imageBuffer.toString("base64");
  const mediaType = toMediaType(stage0.metadata.format);

  // ── Stage 1: Reconstruct (ensemble -> aggregator) ──────────────────────────
  const envelopes = await runEnsemble({ base64, mediaType, buffer: imageBuffer });
  const fields = await aggregate({ envelopes, stage0 });
  const t2 = performance.now();

  // ── Stage 2: Verify (regenerate-or-agreement trust score) ──────────────────
  const agree = agreementScore(fields);
  const trust = await verify({
    originalImage: imageBuffer,
    reconstructedPrompt: fields.reconstructed_prompt,
    agreementScore: agree,
  });
  const t3 = performance.now();

  const successful = envelopes.filter((e) => e.ok).length;
  const seedEligible = trust.trust_score >= config.cuerateSeedThreshold && successful >= 1;

  return {
    agent: "cuerate-image-reverse-engineer",
    version: VERSION,
    disclaimer: DISCLAIMER,
    stage0_identify: stage0,
    fields,
    trust,
    ensemble: {
      size: envelopes.length,
      sources: envelopes.map((e) => e.source),
      successful,
    },
    cuerate_pair: {
      reconstructed_prompt: fields.reconstructed_prompt,
      trust_score: trust.trust_score,
      seed_eligible: seedEligible,
    },
    timing_ms: {
      stage0: Math.round(t1 - t0),
      stage1: Math.round(t2 - t1),
      stage2: Math.round(t3 - t2),
      total: Math.round(t3 - t0),
    },
  };
}
