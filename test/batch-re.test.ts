/**
 * batch-re.test.ts — run the full reverse-engineer pipeline over a folder of test
 * images whose FILENAMES are the original prompts, then compare the reconstructed
 * prompt against the original. Writes a markdown report next to this file.
 *
 * Usage:
 *   npx tsx test/batch-re.test.ts ["/path/to/image folder"]
 *   (defaults to "../../okx ai test")
 */
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import { reverseEngineer } from "../src/pipeline.js";
import { providerSummary } from "../src/config.js";

const DEFAULT_DIR = resolve(process.cwd(), "../okx ai test");
const dir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DIR;

/**
 * Recover the "original prompt" for an image. Prefer a sidecar text file with the same
 * stem (`foo.png` → `foo.txt` or `foo.png.txt`) — this survives long prompts that the OS
 * would truncate in a filename. Fall back to parsing the filename itself.
 */
function originalPrompt(dir: string, file: string): { prompt: string; source: "sidecar" | "filename" } {
  const stem = basename(file, extname(file));
  for (const cand of [`${stem}.txt`, `${file}.txt`]) {
    const p = join(dir, cand);
    if (existsSync(p)) {
      const txt = readFileSync(p, "utf8").trim();
      if (txt) return { prompt: txt, source: "sidecar" };
    }
  }
  // Filename fallback: strip trailing quality tags / bare page numbers.
  const cleaned = stem.replace(/\s*\d+p\s*$/i, "").replace(/\s+\d+$/, "").trim();
  return { prompt: cleaned, source: "filename" };
}

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

async function main() {
  console.log("Provider:", providerSummary());
  console.log("Test folder:", dir, "\n");

  const entries = readdirSync(dir)
    .filter((f) => IMG_EXT.has(extname(f).toLowerCase()))
    .map((f) => ({ file: f, path: join(dir, f), size: statSync(join(dir, f)).size }));

  const usable = entries.filter((e) => e.size > 0);
  const empty = entries.filter((e) => e.size === 0);

  console.log(`Found ${entries.length} images · ${usable.length} usable · ${empty.length} empty (0 bytes)\n`);
  for (const e of empty) console.log(`  ⚠️  SKIP (0 bytes): ${e.file}`);
  console.log("");

  const results: any[] = [];

  for (const e of usable) {
    const { prompt: original, source: promptSource } = originalPrompt(dir, e.file);
    console.log("─".repeat(80));
    console.log(`▶ ${e.file}  (${(e.size / 1024).toFixed(0)} KB)`);
    console.log(`  ORIGINAL [${promptSource}]: ${original}`);
    try {
      const buf = readFileSync(e.path);
      const t0 = Date.now();
      const r = await reverseEngineer(buf);
      const ms = Date.now() - t0;
      console.log(`  RECON:    ${r.fields.reconstructed_prompt}`);
      console.log(
        `  trust=${(r.trust.trust_score * 100).toFixed(0)}% (${r.trust.method}) · ` +
          `ensemble=${r.ensemble.successful}/${r.ensemble.size} [${r.ensemble.sources.join(", ")}] · ${ms}ms`,
      );
      results.push({
        file: e.file,
        original,
        prompt_source: promptSource,
        reconstructed: r.fields.reconstructed_prompt,
        trust_score: r.trust.trust_score,
        trust_method: r.trust.method,
        ensemble_ok: r.ensemble.successful,
        ensemble_size: r.ensemble.size,
        sources: r.ensemble.sources,
        stage0: {
          dims: `${r.stage0_identify.width}x${r.stage0_identify.height}`,
          ar: r.stage0_identify.aspect_ratio,
          grid: r.stage0_identify.resolution_match.model_family,
          provenance: r.stage0_identify.provenance_signal.label,
        },
        fields: Object.fromEntries(
          Object.entries(r.fields)
            .filter(([, v]: any) => v && typeof v === "object" && "confidence" in v)
            .map(([k, v]: any) => [k, { value: v.value, confidence: v.confidence, agreement: v.agreement }]),
        ),
        timing_ms: r.timing_ms,
      });
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message}`);
      results.push({ file: e.file, original, error: err.message });
    }
    console.log("");
  }

  // ── write JSON + markdown report ──────────────────────────────────────────
  const outJson = join(dir, "..", "re-agent", "test", "batch-results.json");
  writeFileSync(outJson, JSON.stringify({ generated: new Date().toISOString?.() ?? "n/a", provider: providerSummary(), dir, empty: empty.map(e=>e.file), results }, null, 2));
  console.log("wrote", outJson);
}

main().catch((e) => {
  console.error("batch test failed:", e);
  process.exit(1);
});
