/**
 * mock.ts — offline, deterministic ensemble + aggregator (no network, no API key).
 *
 * Enabled with MOCK_LLM=true. Purpose: make the WHOLE pipeline runnable and demoable
 * today with zero external dependencies (useful for demos, CI, and environments where
 * only a restricted model gateway is available). Output is derived from real image
 * statistics (sharp) so it's plausible and image-specific — but it is NOT a real
 * vision reconstruction. Every mock result is labeled so nobody mistakes it for the
 * real thing: overall_reconstruction_notes and provenance say "MOCK".
 *
 * Swap to the real path by setting a genuine ANTHROPIC_API_KEY and MOCK_LLM=false.
 */
import sharp from "sharp";
import {
  type DescriberEnvelope,
  type TaggedEnvelope,
  type Stage0Result,
  type AggregatorOutput,
  type DecodeField,
  DECODE_FIELDS,
  CONFIDENCE_CEILING,
  ASPECT_CONSENSUS_CEILING,
} from "../schema.js";
import { config } from "../config.js";
import { clamp01 } from "../util.js";

interface ImgStats {
  brightness: number; // 0..255
  warm: boolean;
  dominant: string;
  aspect: string;
  wide: boolean;
}

async function analyze(buf: Buffer): Promise<ImgStats> {
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const stats = await img.stats();
    const [r, g, b] = stats.channels;
    const brightness = (r.mean + g.mean + b.mean) / 3;
    const warm = r.mean >= b.mean;
    const dominant =
      r.mean >= g.mean && r.mean >= b.mean
        ? "warm reds/oranges"
        : g.mean >= r.mean && g.mean >= b.mean
          ? "greens"
          : "cool blues";
    const w = meta.width ?? 1;
    const h = meta.height ?? 1;
    return {
      brightness,
      warm,
      dominant,
      aspect: `${w}×${h}`,
      wide: w >= h,
    };
  } catch {
    return { brightness: 128, warm: true, dominant: "unclear", aspect: "unknown", wide: true };
  }
}

/** One mock describer report, varied slightly by pass index for redundancy realism. */
export async function mockDescribe(buf: Buffer, passIndex: number): Promise<DescriberEnvelope> {
  const s = await analyze(buf);
  const bright = s.brightness > 150 ? "bright, high-key" : s.brightness < 90 ? "dim, low-key" : "balanced mid-key";
  const temp = s.warm ? "warm" : "cool";
  // Small per-pass wording variation so the aggregator sees non-identical reports.
  const v = passIndex % 2 === 0 ? "" : " (soft)";
  return {
    subject_action: "central subject in frame, static pose [MOCK — enable a real API key for true decoding]",
    composition: s.wide ? "landscape framing, subject roughly centered" : "portrait framing, subject roughly centered",
    camera_language: `eye-level, standard focal length${v}`,
    focus_lens_effects: "moderate depth of field, subject in focus",
    lighting_color_grading: `${bright}, ${temp} grading, dominant ${s.dominant}`,
    style_medium: s.brightness > 150 ? "clean digital illustration / render" : "photographic / rendered",
    text_in_image: "no legible text detected",
    aspect_ratio_resolution_observed: s.aspect,
    reference_image_echoes: "no strong signal",
    negative_space_exclusions: "no strong signal",
    artifact_fingerprint: "ambiguous — insufficient signal in mock mode",
    provenance_notes: "MOCK mode: no real forensic analysis performed",
  };
}

export async function runMockEnsemble(buf: Buffer): Promise<TaggedEnvelope[]> {
  const out: TaggedEnvelope[] = [];
  for (let i = 0; i < config.ensembleSize; i++) {
    out.push({ source: `mock:describer#${i + 1}`, envelope: await mockDescribe(buf, i), ok: true });
  }
  return out;
}

/** Deterministic local merge — mirrors the aggregator's contract without a model call. */
export function mockAggregate(envelopes: TaggedEnvelope[], stage0: Stage0Result): AggregatorOutput {
  const n = envelopes.length;
  const field = (key: DecodeField, srcKey: keyof DescriberEnvelope): { value: string; confidence: number; agreement: string } => {
    // Take the first non-"unclear" report's value; confidence scales with how many reports had signal.
    const vals = envelopes.map((e) => (e.envelope as any)[srcKey] as string);
    const withSignal = vals.filter((x) => x && !/^unclear|no signal|unavailable/i.test(x));
    const value = withSignal[0] ?? vals[0] ?? "unclear";
    const agreementFrac = withSignal.length / n;
    let confidence = clamp01(0.4 + 0.5 * agreementFrac);
    confidence = Math.min(confidence, CONFIDENCE_CEILING[key]);
    return { value, confidence, agreement: `${withSignal.length}/${n} reports (MOCK)` };
  };

  const aspect = stage0.resolution_match.matched
    ? {
        value: `${stage0.width}×${stage0.height} (${stage0.aspect_ratio}, ${stage0.megapixel_class}) — ${stage0.resolution_match.label}`,
        confidence: 1.0,
        agreement: "deterministic",
      }
    : {
        value: stage0.aspect_ratio ?? "unknown",
        confidence: Math.min(0.6, ASPECT_CONSENSUS_CEILING),
        agreement: "consensus (MOCK)",
      };

  const out: AggregatorOutput = {
    subject_action: field("subject_action", "subject_action"),
    composition: field("composition", "composition"),
    camera_language: field("camera_language", "camera_language"),
    focus_lens_effects: field("focus_lens_effects", "focus_lens_effects"),
    lighting_color_grading: field("lighting_color_grading", "lighting_color_grading"),
    style_medium: field("style_medium", "style_medium"),
    text_in_image: field("text_in_image", "text_in_image"),
    aspect_ratio_resolution: aspect,
    reference_image_echoes: field("reference_image_echoes", "reference_image_echoes"),
    negative_space_exclusions: {
      ...field("negative_space_exclusions", "negative_space_exclusions"),
      confidence: Math.min(field("negative_space_exclusions", "negative_space_exclusions").confidence, CONFIDENCE_CEILING.negative_space_exclusions),
    },
    artifact_fingerprint: field("artifact_fingerprint", "artifact_fingerprint"),
    provenance: {
      value: stage0.provenance_signal.note,
      confidence: stage0.resolution_match.matched || stage0.metadata.has_c2pa ? 0.6 : 0.2,
      agreement: "heuristic",
    },
    reconstructed_prompt: "",
    overall_reconstruction_notes:
      "⚠️ MOCK MODE — generated offline from image statistics, not a real vision reconstruction. " +
      "Set OPENROUTER_API_KEY and MOCK_LLM=false for true decoding.",
  };

  // Flatten a usable prompt from the merged fields.
  out.reconstructed_prompt = [
    out.subject_action.value.replace(/\s*\[MOCK[^\]]*\]/i, ""),
    out.composition.value,
    out.camera_language.value,
    out.lighting_color_grading.value,
    out.style_medium.value,
    stage0.resolution_match.matched ? `${stage0.aspect_ratio} aspect ratio` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return out;
}
