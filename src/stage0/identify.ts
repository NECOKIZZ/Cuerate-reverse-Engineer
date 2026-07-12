/**
 * identify.ts — Stage 0: cheap, deterministic, no model calls.
 *
 * Reads pixel dimensions (sharp), EXIF + C2PA/CAI manifest presence (exifr + byte sniff),
 * matches the resolution table, and emits a provenance HEURISTIC (never "confirmed"
 * unless a real manifest is found). This is the free instant tier.
 */
import sharp from "sharp";
import exifr from "exifr";
import type { Stage0Result } from "../schema.js";
import { matchResolution } from "./resolutionTable.js";

/**
 * C2PA/CAI content-credentials manifests are embedded as a JUMBF box; a reliable,
 * dependency-free heuristic is to look for the "c2pa"/"jumbf"/"contentauth" markers
 * in the file bytes. This is a SNIFF, not a cryptographic verification.
 */
function sniffC2PA(buf: Buffer): boolean {
  // Scan a bounded window (manifests sit near the head, but can be large) — cap at 5MB.
  const slice = buf.subarray(0, Math.min(buf.length, 5 * 1024 * 1024));
  const hay = slice.toString("latin1");
  return (
    hay.includes("jumb") &&
    (hay.includes("c2pa") || hay.includes("contentauth") || hay.includes("cai"))
  );
}

export async function identify(imageBuffer: Buffer): Promise<Stage0Result> {
  // ── dimensions + format ──────────────────────────────────────────────────
  let width: number | null = null;
  let height: number | null = null;
  let format: string | null = null;
  try {
    const meta = await sharp(imageBuffer).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    format = meta.format ?? null;
  } catch {
    // non-image or unsupported container — leave nulls, downstream still runs on the bytes
  }

  // ── resolution table match ───────────────────────────────────────────────
  const rm =
    width && height
      ? matchResolution(width, height)
      : {
          matched: false,
          model_family: null,
          label: null,
          aspect: null,
          megapixel_class: null,
          confidence: 0,
        };

  // ── EXIF / metadata ──────────────────────────────────────────────────────
  let exif: Record<string, unknown> = {};
  let software: string | null = null;
  try {
    // Parse all available metadata blocks. `true` = merge every segment exifr can read.
    const parsed = (await exifr.parse(imageBuffer, true)) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === "object") {
      exif = parsed;
      software = (parsed.Software as string) || (parsed.software as string) || null;
    }
  } catch {
    // no EXIF — common for AI-generated PNGs; fine.
  }
  const hasExif = Object.keys(exif).length > 0;
  const hasC2PA = sniffC2PA(imageBuffer);

  // Keep the exif summary small + serializable (drop huge/binary values).
  const exifSummary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(exif)) {
    if (v == null) continue;
    if (typeof v === "object") continue; // skip nested/binary blobs
    const s = String(v);
    if (s.length > 200) continue;
    exifSummary[k] = v;
    if (Object.keys(exifSummary).length >= 25) break;
  }

  // ── provenance heuristic (never overclaim) ───────────────────────────────
  const notes: string[] = [];
  let label: "heuristic" | "confirmed" = "heuristic";
  if (hasC2PA) {
    notes.push("C2PA/CAI content-credentials manifest bytes detected (sniff, not cryptographically verified)");
    // We still keep label "heuristic": full verification would require validating the manifest signature.
  }
  if (rm.matched) {
    notes.push(`pixel grid matches ${rm.model_family} (${rm.label}) → raises prior for that family`);
  }
  if (software) {
    notes.push(`EXIF Software tag: "${software}"`);
  }
  if (notes.length === 0) {
    notes.push("no deterministic provenance signal (no manifest, no grid match, no software tag)");
  }

  return {
    width,
    height,
    aspect_ratio: rm.aspect,
    megapixel_class: rm.megapixel_class,
    resolution_match: {
      matched: rm.matched,
      model_family: rm.model_family,
      label: rm.label,
      confidence: rm.confidence,
    },
    metadata: {
      format,
      has_exif: hasExif,
      has_c2pa: hasC2PA,
      software,
      exif_summary: exifSummary,
    },
    provenance_signal: {
      label,
      note: notes.join("; "),
    },
  };
}
