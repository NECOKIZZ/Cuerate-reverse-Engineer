/**
 * schema.ts — THE API CONTRACT.
 *
 * Field names here are the public interface other agents depend on. They are taken
 * verbatim from `image-reverse-engineer-skill.md` and MUST NOT drift between the
 * describer prompt, the aggregator prompt, and this file.
 *
 * Two shapes live here:
 *   1. DescriberEnvelope  — what ONE vision model returns (Stage 1, Part A).
 *   2. AggregatedResult   — the merged, confidence-scored object the API returns
 *                           (Stage 1.5 Part B) + Stage 0 + Stage 2 metadata.
 */
import { z } from "zod";

/** The twelve decoding fields, in canonical order. Shared by describer + aggregator. */
export const DECODE_FIELDS = [
  "subject_action",
  "composition",
  "camera_language",
  "focus_lens_effects",
  "lighting_color_grading",
  "style_medium",
  "text_in_image",
  "aspect_ratio_resolution",
  "reference_image_echoes",
  "negative_space_exclusions",
  "artifact_fingerprint",
  "provenance",
] as const;

export type DecodeField = (typeof DECODE_FIELDS)[number];

/**
 * Per-field confidence ceilings (from the skill doc field reference table).
 * The aggregator is instructed to respect these; we ALSO clamp to them in code
 * (defense in depth — a model can't push negative_space above 0.4 no matter what).
 */
export const CONFIDENCE_CEILING: Record<DecodeField, number> = {
  subject_action: 1.0,
  composition: 1.0,
  camera_language: 0.8,
  focus_lens_effects: 0.7,
  lighting_color_grading: 1.0,
  style_medium: 0.7,
  text_in_image: 1.0,
  aspect_ratio_resolution: 1.0, // 1.0 only when Stage 0 deterministic; else clamped to 0.7 in code
  reference_image_echoes: 0.6,
  negative_space_exclusions: 0.4, // HARD cap, structurally unreliable
  artifact_fingerprint: 0.6, // 0.6 when contested
  provenance: 1.0, // only when deterministic C2PA/grid; heuristic otherwise
};

/** Consensus (non-deterministic) ceiling for aspect ratio — visual guessing is unreliable. */
export const ASPECT_CONSENSUS_CEILING = 0.7;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Describer envelope (Part A output). One per vision pass.
// Field names differ slightly from the aggregated output on purpose:
// `aspect_ratio_resolution_observed` is the model's GUESS, kept separate from the
// deterministic Stage 0 value so the aggregator never overwrites ground truth.
// ─────────────────────────────────────────────────────────────────────────────
export const DescriberEnvelopeSchema = z.object({
  subject_action: z.string(),
  composition: z.string(),
  camera_language: z.string(),
  focus_lens_effects: z.string(),
  lighting_color_grading: z.string(),
  style_medium: z.string(),
  text_in_image: z.string(),
  aspect_ratio_resolution_observed: z.string(),
  reference_image_echoes: z.string(),
  negative_space_exclusions: z.string(),
  artifact_fingerprint: z.string(),
  provenance_notes: z.string(),
});
export type DescriberEnvelope = z.infer<typeof DescriberEnvelopeSchema>;

/** Envelope tagged with which model produced it (for agreement accounting). */
export interface TaggedEnvelope {
  source: string; // e.g. "anthropic:claude#1", "openai:gpt", "clip-interrogator"
  envelope: DescriberEnvelope;
  ok: boolean; // false if the pass failed and we filled a null envelope
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1.5 — Aggregated field: value + confidence + agreement string.
// ─────────────────────────────────────────────────────────────────────────────
export const AggregatedFieldSchema = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1),
  agreement: z.string(), // e.g. "3/3 models agreed", "deterministic", "contested"
  notes: z.string().optional(),
});
export type AggregatedField = z.infer<typeof AggregatedFieldSchema>;

/** The object the aggregator LLM must return (Part B). */
export const AggregatorOutputSchema = z.object({
  subject_action: AggregatedFieldSchema,
  composition: AggregatedFieldSchema,
  camera_language: AggregatedFieldSchema,
  focus_lens_effects: AggregatedFieldSchema,
  lighting_color_grading: AggregatedFieldSchema,
  style_medium: AggregatedFieldSchema,
  text_in_image: AggregatedFieldSchema,
  aspect_ratio_resolution: AggregatedFieldSchema,
  reference_image_echoes: AggregatedFieldSchema,
  negative_space_exclusions: AggregatedFieldSchema,
  artifact_fingerprint: AggregatedFieldSchema,
  provenance: AggregatedFieldSchema,
  reconstructed_prompt: z.string(),
  overall_reconstruction_notes: z.string(),
});
export type AggregatorOutput = z.infer<typeof AggregatorOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0 — deterministic identify output.
// ─────────────────────────────────────────────────────────────────────────────
export interface Stage0Result {
  width: number | null;
  height: number | null;
  aspect_ratio: string | null; // e.g. "16:9"
  megapixel_class: string | null; // e.g. "2K", "1K"
  resolution_match: {
    matched: boolean;
    model_family: string | null; // e.g. "Gemini Image 2K", "Midjourney v6"
    label: string | null; // human label of the matched grid entry
    confidence: number; // 1.0 when matched, 0 otherwise
  };
  metadata: {
    format: string | null;
    has_exif: boolean;
    has_c2pa: boolean; // C2PA/CAI manifest presence (heuristic sniff)
    software: string | null; // EXIF Software tag if present
    exif_summary: Record<string, unknown>;
  };
  provenance_signal: {
    // combined heuristic, NEVER "confirmed" unless a real manifest matched
    label: "heuristic" | "confirmed";
    note: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — verification result.
// ─────────────────────────────────────────────────────────────────────────────
export interface Stage2Result {
  method: "regenerate-verified" | "agreement";
  trust_score: number; // 0..1
  note: string;
  regenerated_image_present: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The full response the paid endpoint / MCP tool returns.
// ─────────────────────────────────────────────────────────────────────────────
export interface ReverseEngineerResult {
  agent: "cuerate-image-reverse-engineer";
  version: string;
  disclaimer: string;
  stage0_identify: Stage0Result;
  fields: AggregatorOutput;
  trust: Stage2Result;
  ensemble: {
    size: number;
    sources: string[];
    successful: number;
  };
  cuerate_pair: {
    // the verified prompt->image pair this call seeds into Cuerate
    reconstructed_prompt: string;
    trust_score: number;
    seed_eligible: boolean; // true when trust is high enough to add as marketplace inventory
  };
  timing_ms: {
    stage0: number;
    stage1: number;
    stage2: number;
    total: number;
  };
}

/** Standard disclaimer text — reconstruction is many-to-one/lossy. Never overclaim. */
export const DISCLAIMER =
  "Reconstruction is inherently lossy (many prompts can produce one image). " +
  "This is a prompt that would plausibly reproduce something close to the input — " +
  "not a claim about the original prompt. Per-field confidence and the trust score " +
  "indicate how much to rely on each part.";
