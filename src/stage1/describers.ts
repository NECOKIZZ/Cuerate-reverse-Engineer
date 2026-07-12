/**
 * describers.ts — Stage 1 ensemble orchestrator.
 *
 * Runs each model in config.ensembleModels as an independent full-image describer, in
 * parallel, via OpenRouter. Cross-model agreement is the confidence signal. Adding a slug
 * to ENSEMBLE_MODELS adds a real, independent ensemble member — no code change.
 */
import { config } from "../config.js";
import type { TaggedEnvelope } from "../schema.js";
import { PASS_FRAMINGS } from "./prompts.js";
import { describeWithModel, emptyEnvelope } from "./describer.js";
import { runMockEnsemble } from "./mock.js";

export interface DescriberInput {
  base64: string;
  mediaType: string;
  buffer: Buffer;
}

export async function runEnsemble(input: DescriberInput): Promise<TaggedEnvelope[]> {
  const { base64, mediaType, buffer } = input;

  // Offline mock path — whole ensemble, no network.
  if (config.mockLlm) return runMockEnsemble(buffer);

  const models = config.ensembleModels;
  const passes = models.map((model, i) => {
    const framing = PASS_FRAMINGS[i % PASS_FRAMINGS.length];
    const source = model;
    return (async (): Promise<TaggedEnvelope> => {
      try {
        const envelope = await describeWithModel({ model, base64, mediaType, framing });
        return { source, envelope, ok: true };
      } catch (err) {
        return { source, envelope: emptyEnvelope(String((err as Error).message)), ok: false };
      }
    })();
  });

  return Promise.all(passes);
}
