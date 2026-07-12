/**
 * aggregator.ts — Stage 1.5 (Part B).
 *
 * Feeds the N tagged describer envelopes + the Stage 0 deterministic values to Claude
 * with the verbatim aggregator system prompt, then enforces the confidence ceilings in
 * CODE (defense in depth — a model cannot push negative_space above 0.4, cannot promote
 * provenance to "confirmed" without a deterministic signal, and cannot override a Stage 0
 * grid match for aspect ratio).
 */
import { config } from "../config.js";
import { chatComplete } from "../llm.js";
import {
  AggregatorOutputSchema,
  type AggregatorOutput,
  type TaggedEnvelope,
  type Stage0Result,
  type DecodeField,
  CONFIDENCE_CEILING,
  ASPECT_CONSENSUS_CEILING,
  DECODE_FIELDS,
} from "../schema.js";
import { AGGREGATOR_SYSTEM_PROMPT } from "./prompts.js";
import { extractJson, clamp01 } from "../util.js";
import { mockAggregate } from "./mock.js";

export async function aggregate(args: {
  envelopes: TaggedEnvelope[];
  stage0: Stage0Result;
}): Promise<AggregatorOutput> {
  const { envelopes, stage0 } = args;

  // Offline mock path — deterministic local merge, no model call.
  if (config.mockLlm) return enforceCeilings(mockAggregate(envelopes, stage0), stage0, envelopes.length);

  // Build the deterministic Stage 0 block passed to the aggregator.
  const deterministic = {
    aspect_ratio_resolution_match: stage0.resolution_match.matched
      ? {
          matched: true,
          value: `${stage0.width}×${stage0.height} (${stage0.aspect_ratio}, ${stage0.megapixel_class}) — ${stage0.resolution_match.label}`,
          confidence: 1.0,
        }
      : { matched: false, observed_aspect: stage0.aspect_ratio },
    provenance_signal: stage0.provenance_signal,
    metadata: {
      has_c2pa: stage0.metadata.has_c2pa,
      software: stage0.metadata.software,
      format: stage0.metadata.format,
    },
  };

  const reports = envelopes.map((e, i) => ({
    report_index: i + 1,
    source: e.source,
    ok: e.ok,
    fields: e.envelope,
  }));

  const userPayload = JSON.stringify(
    { N: envelopes.length, stage0_deterministic: deterministic, reports },
    null,
    2,
  );

  const raw = await chatComplete({
    model: config.aggregatorModel,
    system: AGGREGATOR_SYSTEM_PROMPT,
    userText:
      "Here are the N independent decoding reports plus the Stage 0 deterministic block. " +
      "Merge them per your instructions and return ONLY the JSON object.\n\n" +
      userPayload,
    // The full 12-field JSON (value+confidence+agreement+notes each) plus the
    // reconstructed_prompt runs ~3.4–3.8k completion tokens, but varies per image;
    // 2500 truncated it mid-object (finish_reason: length) → unbalanced JSON, and even
    // 5000 truncated on longer generations. 8000 gives >2× headroom so it never clips.
    maxTokens: 8000,
  });
  const parsed = AggregatorOutputSchema.parse(extractJson(raw));

  return enforceCeilings(parsed, stage0, envelopes.length);
}

/**
 * Enforce the confidence ceilings from the schema in code. The aggregator prompt asks
 * for these, but we never trust the model to self-police — clamp here.
 */
export function enforceCeilings(
  out: AggregatorOutput,
  stage0: Stage0Result,
  n: number,
): AggregatorOutput {
  for (const field of DECODE_FIELDS as readonly DecodeField[]) {
    const f = out[field];
    if (!f) continue;

    if (field === "aspect_ratio_resolution") {
      if (stage0.resolution_match.matched) {
        // Deterministic ground truth wins, always.
        f.value = `${stage0.width}×${stage0.height} (${stage0.aspect_ratio}, ${stage0.megapixel_class}) — ${stage0.resolution_match.label}`;
        f.confidence = 1.0;
        f.agreement = "deterministic";
      } else {
        f.confidence = Math.min(clamp01(f.confidence), ASPECT_CONSENSUS_CEILING);
        if (!/determin/i.test(f.agreement)) f.agreement ||= "consensus";
      }
      continue;
    }

    if (field === "provenance") {
      // Only allow "confirmed" if a deterministic signal actually exists.
      const deterministicProvenance =
        stage0.metadata.has_c2pa || stage0.resolution_match.matched;
      if (!deterministicProvenance) {
        f.agreement = "heuristic";
      }
      f.confidence = clamp01(f.confidence);
      continue;
    }

    // Generic ceiling clamp for every other field.
    const ceiling = CONFIDENCE_CEILING[field];
    f.confidence = Math.min(clamp01(f.confidence), ceiling);
  }

  // Hard structural cap on negative space regardless of what the model returned.
  out.negative_space_exclusions.confidence = Math.min(
    clamp01(out.negative_space_exclusions.confidence),
    CONFIDENCE_CEILING.negative_space_exclusions,
  );

  return out;
}

/**
 * A rough agreement-based overall score, used by Stage 2's fallback trust method.
 * Mean of per-field confidences, weighted toward the high-signal fields.
 */
export function agreementScore(out: AggregatorOutput): number {
  const weights: Partial<Record<DecodeField, number>> = {
    subject_action: 2,
    composition: 1.5,
    lighting_color_grading: 2,
    style_medium: 1.5,
    text_in_image: 1,
    aspect_ratio_resolution: 1,
    camera_language: 1,
    focus_lens_effects: 0.75,
    artifact_fingerprint: 0.75,
    reference_image_echoes: 0.5,
    negative_space_exclusions: 0.25,
    provenance: 0.5,
  };
  let sum = 0;
  let wsum = 0;
  for (const field of DECODE_FIELDS as readonly DecodeField[]) {
    const w = weights[field] ?? 1;
    sum += clamp01(out[field].confidence) * w;
    wsum += w;
  }
  return wsum > 0 ? clamp01(sum / wsum) : 0;
}
