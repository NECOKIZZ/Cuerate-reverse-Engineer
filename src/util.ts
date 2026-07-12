/**
 * util.ts — small shared helpers.
 */

/** Extract the first balanced JSON object from a model's text output. */
export function extractJson(text: string): unknown {
  // Fast path: whole string is JSON.
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // Strip ```json fences if present.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  // Scan for the first balanced { ... } block.
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in model output");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  // Reached end of text with an open object → the model output was truncated
  // (e.g. hit max_tokens). Best-effort repair: close an open string, drop a trailing
  // partial "key": / dangling comma, then close all still-open braces and retry.
  let repaired = trimmed.slice(start);
  if (inStr) repaired += '"';
  repaired = repaired.replace(/,\s*"[^"]*"\s*:?\s*$/,"").replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  repaired += "}".repeat(Math.max(depth, 0));
  try {
    return JSON.parse(repaired);
  } catch {
    throw new Error("unbalanced JSON object in model output");
  }
}

/** Map a sharp/format string to an image media type accepted by vision APIs. */
export function toMediaType(format: string | null): string {
  switch ((format || "").toLowerCase()) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Fetch an http(s) image URL into a Buffer, with a size cap. */
export async function fetchImageBuffer(url: string, maxBytes = 25 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`failed to fetch image (${res.status} ${res.statusText})`);
  const arr = new Uint8Array(await res.arrayBuffer());
  if (arr.byteLength > maxBytes) throw new Error(`image exceeds ${maxBytes} byte cap`);
  return Buffer.from(arr);
}
