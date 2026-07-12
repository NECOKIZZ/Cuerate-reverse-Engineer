/**
 * describer.ts — one independent Stage 1 vision pass against any model slug (via OpenRouter).
 *
 * Same Part A system prompt for every model — that's what makes cross-model agreement a
 * meaningful confidence signal. Returns a validated DescriberEnvelope.
 */
import { chatComplete } from "../llm.js";
import { DescriberEnvelopeSchema, type DescriberEnvelope } from "../schema.js";
import { DESCRIBER_SYSTEM_PROMPT } from "./prompts.js";
import { extractJson } from "../util.js";

export async function describeWithModel(args: {
  model: string;
  base64: string;
  mediaType: string;
  framing: string;
}): Promise<DescriberEnvelope> {
  const { model, base64, mediaType, framing } = args;
  const raw = await chatComplete({
    model,
    system: DESCRIBER_SYSTEM_PROMPT,
    userText: `${framing}\n\nDecode this image now. Return ONLY the JSON object specified in your instructions.`,
    imageBase64: base64,
    imageMediaType: mediaType,
    maxTokens: 1500,
  });
  const parsed = extractJson(raw) as Record<string, unknown>;
  const withDefaults = { ...unclearEnvelope(), ...parsed };
  return DescriberEnvelopeSchema.parse(coerceStrings(withDefaults));
}

/** Envelope filled with a failure reason — used when a pass errors, so the ensemble degrades. */
export function emptyEnvelope(reason: string): DescriberEnvelope {
  const na = `unavailable (${reason})`;
  return fill(na);
}

function unclearEnvelope(): DescriberEnvelope {
  return fill("unclear");
}

function fill(v: string): DescriberEnvelope {
  return {
    subject_action: v,
    composition: v,
    camera_language: v,
    focus_lens_effects: v,
    lighting_color_grading: v,
    style_medium: v,
    text_in_image: v,
    aspect_ratio_resolution_observed: v,
    reference_image_echoes: v,
    negative_space_exclusions: v,
    artifact_fingerprint: v,
    provenance_notes: v,
  };
}

/** Ensure every value is a string (models occasionally emit numbers/objects). */
function coerceStrings(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) out[k] = "unclear";
    else if (typeof v === "string") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
