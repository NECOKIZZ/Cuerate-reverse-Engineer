# RE-Agent Test Findings — 2026-07-12

Ran the full reverse-engineer pipeline (Stage 0 → 1 ensemble+aggregator → 2 trust) over the
`okx ai test` folder, whose filenames are the original prompts, and compared the reconstructed
prompt to the original. Live vision via OpenRouter (`MOCK_LLM=false`), 3-model ensemble.

Harness: `test/batch-re.test.ts` · diagnostic: `test/probe.ts` · raw data: `test/batch-results.json`

---

## TL;DR

- **A hard blocker was making EVERY paid call fail.** Found, root-caused, and fixed. Pipeline now
  works end-to-end and produces strong reconstructions.
- **All 5 images now run** (the 3 previously-empty files were re-dropped with real content).
  **0 errors, trust 74–80%,** stable across repeated runs.
- Reconstructions are faithful and often richer than the terse seed prompt (they describe what's
  actually rendered — on-sign text, extra objects — not hallucinations). One genuine drift noted below.

## Full 5-image run (final)

| Image (seed prompt) | Dims | Trust | Verdict |
|---|---|---|---|
| Ice dragon | 1376×768 | 80% | ✅ Excellent — subject/fire/peak/mono-blue grade/16:9 all recovered |
| Hover-car | 1408×768 | 78% | ✅ Strong; read on-car text ('07', 'ORBITAL RACING', 'BLAZE-X'). Drift: "hovering millimeters above" → "drifting through riverbed" |
| Tokyo street | 768×1376 | 74% | ✅ Strong — read Japanese signage/Shibuya, correctly called **portrait 9:16** |
| Lone astronaut | 1408×768 | 80% | ✅ Excellent — astronaut, turquoise oasis, red canyon, golden hour, two moons, rover |
| Phoenix | 1408×768 | 78% | ✅ Excellent — fire/gold/red phoenix, cosmic nebula, purples, shockwave halo, starfield |

---

## 🔴 Blocker (FIXED): aggregator output truncated → JSON parse crash

**Symptom:** every `/reverse-engineer` call failed with `unbalanced JSON object in model output`.

**Root cause:** the Stage-1.5 aggregator call used `maxTokens: 2500`. The full 12-field JSON
(each field = value + confidence + agreement + notes) plus `reconstructed_prompt` +
`overall_reconstruction_notes` runs **~3.4–3.8k completion tokens**. The response was cut off
mid-object (`finish_reason: length`), leaving an unbalanced `{ … `, so `extractJson()` threw and
the whole request 500'd. Ensemble, Stage 0, vision, and OpenRouter auth were all fine — the only
failure was this cap.

Confirmed with `probe.ts`:
| maxTokens | finish_reason | completion_tokens | result |
|-----------|---------------|-------------------|--------|
| 2500 | `length` | 2500 (maxed) | truncated mid-`reconstructed_prompt` → crash |
| 5000 | `stop` | 3418 / 3736 | valid, but a longer generation still clipped in batch |
| 8000 | `stop` | ~3.4–3.8k | comfortable >2× headroom |

**Fix applied:**
1. `src/stage1/aggregator.ts` — `maxTokens` `2500 → 8000`.
2. `src/util.ts` — `extractJson()` now has a **truncation-repair salvage** (closes an open
   string / drops a dangling partial key / closes open braces and retries) so a rare over-long
   generation degrades gracefully instead of hard-failing.

**Verification:** 2 consecutive full batch runs, both images succeed every time (trust 77–79% dragon,
73–77% hover-car), no parse errors.

---

## 🟠 Data issue: 3 empty images (RESOLVED)

The Tokyo-street, Martian-astronaut, and phoenix files were originally 0 bytes. Re-dropped with real
content (they arrived in the parent folder under Windows 8.3 short names — `ALIVEL~1.PNG` etc. — and
were copied into the correctly-named files in `okx ai test/`). All 5 now decode and run.

Two leftover cosmetic notes (not blocking): the astronaut/phoenix **filenames are still truncated**
(`…cinematic sci-`, `…epic s`), so the "original" used for comparison is missing its trailing style
tag — though the reconstruction recovered those tags anyway (sci-fi, epic scale). For a perfectly
clean comparison, drop a sidecar `<name>.txt` with the full prompt; the harness now prefers it over
the filename (see below).

---

## 🟢 Reconstruction quality (all 5)

All five recover subject, composition, lighting, color grading, style, and aspect ratio well, and add
detail that's genuinely present in the render (not hallucinated). Highlights:

- **Text-in-image works well:** hover-car livery (`'07'`, `ORBITAL RACING`, `BLAZE-X`, noted as
  "slightly garbled") and Tokyo signage (`SHIBUYA`, `東京ゲーム`, `ラーメン`, `NEO TOKYO`) were read.
- **Orientation is correct:** the Tokyo image is portrait and was correctly called **9:16** while the
  four landscape images were called 16:9 — the new deterministic grid drives this.
- **Faithful embellishment:** astronaut recon added the turquoise pool, parked rover, and two moons;
  phoenix added the halo ring and starfield — all visible in the images. This is the intended
  many-to-one behavior (describe what's rendered, richer than the seed).

**One genuine drift to watch:** the hover-car seed says "*hovering millimeters above* the riverbed,"
but the ensemble read it as a car "*drifting through / speeding across* the muddy riverbed" —
implying ground contact. The *hovering/floating* nuance is lost. If preserving action verbs like
hover/float/levitate matters, that's a `subject_action` prompt-tuning target. Not blocking.

---

## 🟡 Secondary observations

1. **Stage 0 grid match (FIXED).** The two test images are 1376×768 and 1408×768 (~16:9, both ÷32
   Flux-dev-compatible) and originally matched no grid entry, so `aspect_ratio_resolution` fell back
   to consensus (capped 0.7). Added those grids (both orientations) plus the SDXL 12:5/5:12
   panoramic presets to `data/resolution-tables.json`. Both images now match **deterministically at
   confidence 1.0** — final field reads `1376×768 (16:9, 1K) — Flux dev-grid` / agreement
   `deterministic`. Labeled the family honestly as "Flux / modern diffusion (dev-grid)" rather than
   pinning a vendor, since 1376×768 is Flux-*compatible* but not a documented canonical preset
   (1344×768 is). Also corrected a misleading comment in `resolutionTable.ts` (it claimed to check
   "both orientations" but matches exact w×h — both orientations are enumerated in the table).
   `provenance` stays `heuristic` (correct — no C2PA/EXIF manifest present).
2. **Stage 2 is agreement-based only.** `IMAGE_GEN_MODEL` is unset, so the regenerate-and-compare
   trust loop was never exercised in this test — trust scores are the agreement fallback. If we want
   to demo real regenerate-verify, set an OpenRouter image slug and re-run.
3. **Latency ~62–65s/image**, aggregator cost ~$0.04–0.047/call (plus 3 ensemble vision calls).
   Comfortably under the $0.35 list price, but the wall-clock is high for a live demo — the 3
   ensemble passes run in parallel already; the aggregator is the long pole. Could try a faster
   aggregator model or trimming per-field `notes` verbosity (which would also shrink token usage).

---

## Sidecar prompt support (for the re-drop)

`test/batch-re.test.ts` now prefers a sidecar text file over the filename for the "original"
prompt: for `foo.png` it reads `foo.txt` (or `foo.png.txt`) if present, else falls back to parsing
the filename. So when you re-drop the missing images, just drop a matching `.txt` next to each with
the full prompt — no more truncation, and the report tags each prompt `[sidecar]` vs `[filename]`.

## Files changed this session

- `src/stage1/aggregator.ts` — aggregator `maxTokens` 2500 → 8000 (+ comment). **[core fix]**
- `src/util.ts` — `extractJson()` truncation-repair salvage path. **[core fix]**
- `data/resolution-tables.json` — added 1376×768 / 1408×768 (Flux dev-grid, both orientations) and
  1536×640 / 640×1536 (SDXL panoramic).
- `src/stage0/resolutionTable.ts` — corrected the misleading "both orientations" comment.
- `test/batch-re.test.ts` — batch harness + sidecar `.txt` prompt support.
- `test/probe.ts`, `test/stage0check.ts` — diagnostics.
