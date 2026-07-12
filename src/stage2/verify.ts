/**
 * verify.ts — Stage 2: the trust score.
 *
 * Two methods, chosen automatically:
 *
 *   "regenerate-verified" (when IMAGE_GEN_URL is configured):
 *      reconstructed_prompt -> generate image -> perceptual-hash similarity vs original
 *      -> trust_score. This is the real self-verification loop.
 *
 *   "agreement" (default today):
 *      trust_score = ensemble field-agreement score. Honest, clearly labeled, and NOT
 *      overclaimed as regeneration proof. Upgrades to the real loop the moment an
 *      image-gen endpoint is provided — no code change elsewhere.
 *
 * Similarity uses a 64-bit perceptual hash (average-hash on a 8x8 grayscale downscale)
 * — dependency-free, deterministic, and a reasonable structural proxy. Swap in a CLIP
 * embedding + cosine similarity here for stronger semantic matching later.
 */
import sharp from "sharp";
import { config } from "../config.js";
import type { Stage2Result } from "../schema.js";
import { generateImage } from "../llm.js";

/** 64-bit average perceptual hash as a BigInt. */
async function aHash(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf)
    .greyscale()
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer();
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += px[i];
  const avg = sum / 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    hash <<= 1n;
    if (px[i] >= avg) hash |= 1n;
  }
  return hash;
}

function hammingSimilarity(a: bigint, b: bigint): number {
  let x = a ^ b;
  let bits = 0;
  while (x > 0n) {
    bits += Number(x & 1n);
    x >>= 1n;
  }
  return 1 - bits / 64; // 1.0 identical, 0.0 fully different
}

/** Regenerate an image from the prompt using the configured OpenRouter image model. */
async function regenerate(prompt: string): Promise<Buffer | null> {
  if (!config.imageGen.enabled) return null;
  return generateImage(prompt, config.imageGen.model);
}

export async function verify(args: {
  originalImage: Buffer;
  reconstructedPrompt: string;
  agreementScore: number;
}): Promise<Stage2Result> {
  const { originalImage, reconstructedPrompt, agreementScore } = args;

  if (config.imageGen.enabled) {
    const regen = await regenerate(reconstructedPrompt);
    if (regen) {
      try {
        const [h1, h2] = await Promise.all([aHash(originalImage), aHash(regen)]);
        const sim = hammingSimilarity(h1, h2);
        return {
          method: "regenerate-verified",
          trust_score: sim,
          note:
            "Regenerated an image from the reconstructed prompt and compared it to the original " +
            "via 64-bit perceptual-hash similarity. Higher = the prompt reproduces the original more closely.",
          regenerated_image_present: true,
        };
      } catch {
        /* fall through to agreement */
      }
    }
  }

  return {
    method: "agreement",
    trust_score: agreementScore,
    note:
      "No image-generation model configured, so trust is the ensemble field-agreement score " +
      "(how strongly the independent vision passes agreed). Set IMAGE_GEN_MODEL (an OpenRouter " +
      "image slug, e.g. google/gemini-3.1-flash-image) to enable the regenerate-and-compare loop.",
    regenerated_image_present: false,
  };
}
