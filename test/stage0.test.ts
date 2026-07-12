/**
 * stage0.test.ts — deterministic checks that need NO API keys.
 *
 * Generates images at known + unknown resolutions with sharp and asserts the resolution
 * table + identify logic behave. Run: `npm run test:stage0`.
 */
import sharp from "sharp";
import assert from "node:assert";
import { matchResolution, computeAspect } from "../src/stage0/resolutionTable.js";
import { identify } from "../src/stage0/identify.js";

let passed = 0;
function ok(name: string, cond: boolean, extra = "") {
  assert.ok(cond, `FAILED: ${name} ${extra}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

async function makePng(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function run() {
  console.log("Stage 0 — resolution table");
  const m1 = matchResolution(2048, 2048);
  ok("2048×2048 matches a Gemini 2K grid", m1.matched && /Gemini/i.test(m1.model_family || ""), JSON.stringify(m1));
  ok("matched grid gets confidence 1.0", m1.confidence === 1.0);

  const m2 = matchResolution(1920, 1080);
  ok("1920×1080 matches a video grid", m2.matched, JSON.stringify(m2));

  const m3 = matchResolution(1234, 567);
  ok("odd size does NOT match", !m3.matched && m3.confidence === 0);
  ok("odd size still computes an aspect ratio", m3.aspect === computeAspect(1234, 567));

  ok("computeAspect(1920,1080) = 16:9", computeAspect(1920, 1080) === "16:9");
  ok("computeAspect(1024,1024) = 1:1", computeAspect(1024, 1024) === "1:1");

  console.log("\nStage 0 — identify() end to end (no model calls)");
  const known = await makePng(2048, 2048);
  const r1 = await identify(known);
  ok("identify reads dimensions", r1.width === 2048 && r1.height === 2048);
  ok("identify matches the grid", r1.resolution_match.matched, JSON.stringify(r1.resolution_match));
  ok("identify aspect is 1:1", r1.aspect_ratio === "1:1");
  ok("provenance labelled heuristic (no real manifest)", r1.provenance_signal.label === "heuristic");

  const unknown = await makePng(801, 601);
  const r2 = await identify(unknown);
  ok("unknown size: no grid match", !r2.resolution_match.matched);
  ok("unknown size: aspect still computed", r2.aspect_ratio === computeAspect(801, 601));

  console.log(`\n\x1b[32mAll ${passed} Stage 0 assertions passed.\x1b[0m`);
}

run().catch((err) => {
  console.error("\x1b[31m" + err.message + "\x1b[0m");
  process.exit(1);
});
