/**
 * resolutionTable.ts — the deterministic Stage 0 win.
 *
 * Exact WxH match against published model grids => aspect_ratio_resolution known at
 * confidence 1.0 (no inference), plus a probabilistic nudge toward that model family.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve data/resolution-tables.json robustly. The number of directory levels between
 * this file and the project root differs between `tsx` (src/stage0/) and the compiled
 * build (dist/src/stage0/), so we search a few candidate locations + the cwd.
 */
function resolveDataPath(): string {
  const candidates = [
    join(__dirname, "..", "..", "data", "resolution-tables.json"), // src/stage0 → project/data
    join(__dirname, "..", "..", "..", "data", "resolution-tables.json"), // dist/src/stage0 → project/data
    join(process.cwd(), "data", "resolution-tables.json"), // run from project root
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[0]; // let readFileSync throw a clear error if truly missing
}

export interface GridEntry {
  w: number;
  h: number;
  aspect: string;
  class: string;
  family: string;
  label: string;
}

interface GridFile {
  grids: GridEntry[];
}

let GRIDS: GridEntry[] | null = null;

function loadGrids(): GridEntry[] {
  if (GRIDS) return GRIDS;
  const parsed = JSON.parse(readFileSync(resolveDataPath(), "utf8")) as GridFile;
  GRIDS = parsed.grids;
  return GRIDS;
}

export interface ResolutionMatch {
  matched: boolean;
  model_family: string | null;
  label: string | null;
  aspect: string | null;
  megapixel_class: string | null;
  confidence: number;
}

/** Compute a reduced aspect-ratio string from raw dimensions, e.g. 1920x1080 -> "16:9". */
export function computeAspect(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
}

/**
 * Exact match against known grids on width+height. Both orientations (landscape and
 * portrait) are enumerated as separate entries in the table so each match reports the
 * correct aspect/label for its orientation.
 */
export function matchResolution(w: number, h: number): ResolutionMatch {
  const grids = loadGrids();
  for (const g of grids) {
    if (g.w === w && g.h === h) {
      return {
        matched: true,
        model_family: g.family,
        label: g.label,
        aspect: g.aspect,
        megapixel_class: g.class,
        confidence: 1.0,
      };
    }
  }
  return {
    matched: false,
    model_family: null,
    label: null,
    aspect: computeAspect(w, h),
    megapixel_class: null,
    confidence: 0,
  };
}
