# Image Reverse-Engineer Agent — Build Plan
### (Cuerate / OKX AI Hackathon)

## 0. The one-paragraph decision

Build a **3-stage pipeline agent**, not a single model call and not a per-aspect model split:

**Identify → Reconstruct → Verify**

- **Identify**: cheap, mostly deterministic checks (resolution table lookup, metadata, artifact heuristics) that run before you spend money on generative reasoning.
- **Reconstruct**: an *ensemble of full-image describers* (not per-aspect specialists) whose outputs get merged by a single aggregator model into one structured JSON prompt, using the taxonomy below.
- **Verify**: regenerate an image from the candidate prompt, embed both images, cosine-similarity them, and return that number as your confidence score.

This is the part nobody else ships as a callable, paid, agent-native service. The base capability ("upload image, get prompt back") is commodity — CLIP Interrogator, Midjourney `/describe`, and several SEO wrapper sites already do it. Your wedge is **machine-payable + structured + self-verifying**, callable mid-task by another agent with no human squinting at a webpage. Say that explicitly in the pitch.

---

## 1. Why "full-description ensemble" beats "per-aspect specialist split"

You considered two architectures:

**A. Each model describes the whole image; an aggregator reconciles.**
**B. Each model owns one aspect (lighting, composition, style, etc.).**

Go with **A**. Reasons:

1. **Redundancy is the signal.** When 3-5 independently-prompted vision models agree that lighting is "soft, diffused, overcast daylight," that agreement *is* your confidence signal for that field. Split-by-aspect gives you no redundancy to check against — one model's guess about lighting is just... a guess, with nothing to cross-validate it.
2. **Aspects aren't independent.** Camera language, focus/lens effects, and lighting all interact (e.g., a macro lens implies shallow depth of field implies a certain bokeh signature). A model that sees the whole image can reason about these interactions; a model that's only shown "describe the lighting" loses that context and will contradict what the composition-specialist says.
3. **This is literally the CLIP Interrogator lesson learned forward.** CLIP Interrogator already does a weak version of ensemble-then-merge (BLIP caption + CLIP flavor-tag ranking, concatenated). Your upgrade is: use *multiple full reasoning-capable vision-language models* instead of one caption model + one tag-matcher, and use an LLM aggregator instead of string concatenation.

**Aggregator prompt design note**: the aggregator should not just "average" — it should be told explicitly to (a) keep fields where models agree, (b) flag fields where models disagree with a lower per-field confidence, (c) never invent a field no model mentioned, and (d) leave "negative space / implied exclusions" at low confidence by default (see §5).

---

## 2. Pipeline architecture

```
                         ┌─────────────────────────┐
   image in  ───────────▶  STAGE 0: Identify        │
                         │  - resolution/EXIF check  │
                         │  - resolution table lookup│
                         │  - C2PA/metadata sniff    │
                         │  - cheap artifact heuristics│
                         └───────────┬───────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  STAGE 1: Reconstruct     │
                         │  N vision models, called   │
                         │  in parallel, each returns │
                         │  full-image description    │
                         │  against the taxonomy.     │
                         │            ▼                │
                         │  1 aggregator LLM merges    │
                         │  into single structured     │
                         │  JSON prompt + per-field    │
                         │  agreement scores            │
                         └───────────┬───────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  STAGE 2: Verify          │
                         │  - regenerate image from   │
                         │    candidate prompt         │
                         │  - CLIP-embed both images   │
                         │  - cosine similarity =      │
                         │    overall confidence score │
                         └───────────┬───────────────┘
                                     ▼
                    structured JSON + confidence score
                    returned to calling agent (paid, x402)
```

Everything in Stage 0 is cheap/deterministic — do it first so you don't burn model calls on things you can already know for free (e.g., if the pixel dimensions exactly match a published Gemini/Veo grid, you already know `aspect_ratio` and `image_size` with 100% certainty, no inference needed).

---

## 3. The structured output schema (taxonomy)

This is what every describer model is prompted against, and what the aggregator outputs. Keep field names stable — this is your API contract.

| Field | What to extract | Confidence behavior |
|---|---|---|
| `subject_action` | Main entity, pose, expression, activity | High — this is the easiest field, weight it high |
| `composition` | Shot type, framing, negative space, rule-of-thirds | High agreement expected |
| `camera_language` | Angle, simulated lens (35mm/macro/etc.), POV | Medium — models sometimes hallucinate lens specifics |
| `focus_lens_effects` | Depth of field, bokeh, focus falloff | **Diffusion-artifact-prone** — flag if models disagree, since soft edges can be generation noise, not intended style |
| `lighting_color_grading` | Direction, quality, palette, warm/cool | High-signal, low-ambiguity — usually your most reliable field |
| `style_medium` | Photoreal / illustration / 3D / artist-engine reference | Medium — this is where hallucination risk is highest per the research (60%+ failure rate reported on photoreal/artist-specific images) |
| `text_in_image` | Exact rendered text + font style, transcribed | High if legible; transcribe before anything else — clean rendered text is itself a signal of a native-multimodal generator |
| `aspect_ratio_resolution` | Literal pixel dimensions | **Deterministic when matched against known model grids** — see §4 |
| `reference_image_echoes` | Signs of multiple composited assets / consistent identity in unusual pose | Low-to-medium — hard signal to detect reliably, treat as a flag not a fact |
| `negative_space_exclusions` | What's conspicuously absent given apparent intent | **Lowest confidence field, always** — no vision model does this natively, it's inference about absence |
| `artifact_fingerprint` | Diffusion noise vs. native-gen coherence, anatomical errors, tiling | Tells you generation *architecture family*, not style — separate this from style_medium in the schema |
| `provenance` | SynthID/C2PA presence if detectable | See §6 — do not overclaim here |

Output contract per field: `{ value, confidence: 0-1, agreement: "n/N models agreed" }`. This lets the calling agent decide how much to trust each field individually, not just the overall score.

---

## 4. The deterministic trick — use it, it's free accuracy

Gemini 3.1 Flash/Pro Image and Veo publish exact pixel-dimension-to-parameter tables (e.g. 2048×2048 = 1:1 at 2K, 2752×1536 = 16:9 at 2K). Build a static lookup table from these published specs. If an uploaded image's pixel dimensions match a known entry:

- Skip inference entirely for `aspect_ratio_resolution`.
- Set confidence to 1.0.
- This also becomes a *weak* provenance signal — if a match is exact, it raises prior probability the image came from that model family, which should nudge (not confirm) your `artifact_fingerprint` and `provenance` fields.

This is the one place in the whole pipeline where you can honestly say "100% recoverable, not probabilistic." Put it in the demo.

---

## 5. Where to be honest about limits (build this into the product, don't hide it)

- **Many-to-one problem**: reconstruction is inherently lossy. Frame the output as "a prompt that would plausibly produce something close," never "the original prompt." Say this in your API docs and your pitch — it's more credible than overclaiming, and it's the same caveat every serious tool in this space (including CLIP Interrogator's own docs) makes.
- **Negative-space inference** should ship at structurally lower confidence than every other field, always. Don't let the aggregator average it up.
- **SynthID is not a public API.** Don't promise "confirms this is Nano Banana." What you *can* do without a human in the loop:
  - Check image metadata/EXIF for C2PA manifest data (this part *is* programmatically queryable, unlike SynthID).
  - Use the resolution-table match as a probabilistic (not confirmatory) signal.
  - Use artifact-pattern heuristics.
  - Label the `provenance` field output explicitly as `"heuristic"` vs `"confirmed"` so downstream agents don't misuse it.

---

## 6. The verification loop (this is your actual differentiator)

1. RE Agent finishes Stage 1, has a candidate structured prompt.
2. Flatten the structured JSON back into a natural-language prompt.
3. Call a real generation model (Nano Banana / Imagen) with that prompt.
4. Embed both the original uploaded image and the regenerated image into the same embedding space (CLIP or similar).
5. Cosine similarity between the two embeddings = your overall confidence score.

This is cheap to justify, cheap to compute, fully automatic, and — critically — it's the same missing piece your own notes flagged as Cuerate's general trust gap: **confirming a served output actually produced the claimed result, without a human checking.** Building it here gives you a reusable verification pattern for other modalities later, which is worth saying out loud in the pitch even though you're scoping to images only for the hackathon.

---

## 7. Agent-native / x402 integration (the actual hackathon deliverable)

The wedge isn't the capability, it's the calling convention. Concretely:

- Expose the whole pipeline as a **single callable endpoint** with a stable JSON schema (§3) as output — this is what makes it agent-callable rather than "a website with a copy button."
- Wrap it in **x402** so any agent can pay per-call, per-frequency, with no account/API-key handshake — this is the "callable anytime, at any frequency" requirement you named.
- Return the **per-field confidence breakdown**, not just one score — a calling agent doing something downstream (e.g., trying to recreate an asset) needs to know *which* fields to trust, not just an aggregate number.
- Make Stage 0 (deterministic checks) return instantly and cheaply, even if Stage 1/2 are still running — lets a calling agent get partial, free-ish signal before committing to the paid full run. This is a good hackathon demo beat: show the free/instant tier vs. the paid/full tier.

---

## 8. MVP scope — what to actually build in hackathon time

**Phase 1 (must-ship for demo):**
- Stage 0: EXIF/metadata read + resolution table lookup (this is pure engineering, no ML calls, do it first, it's your easiest win).
- Stage 1: 2-3 vision-language models called in parallel (e.g., one frontier multimodal LLM with vision, plus one or two others for redundancy), full-image description against the taxonomy in §3.
- One aggregator LLM call that merges into the structured JSON with per-field agreement scores.
- x402 payment wrapper around the endpoint.
- A demo client (even a simple script) that shows another "agent" calling this mid-task and paying per call.

**Phase 2 (stretch goal, big demo payoff if time allows):**
- Stage 2 verification loop: regenerate + CLIP similarity confidence score. This is the single highest-leverage feature for the pitch — prioritize it over adding more Stage 1 models if you have to choose.

**Phase 3 (explicitly out of scope, say so in the pitch as roadmap):**
- Video/Veo support (temporal signatures, extend/interpolation detection).
- C2PA-based provenance beyond basic metadata sniffing.
- Improved negative-space inference (this is a research problem, not a hackathon-weekend problem).

---

## 9. Build order for your builder

1. Static resolution lookup table (Gemini/Veo published grids) + EXIF reader. No model calls. Ship this first, it works today.
2. Define the JSON schema from §3 as a shared type/contract — everything downstream depends on this being locked early.
3. Stand up 2-3 parallel vision-model calls with a shared system prompt that forces them to answer against the schema fields.
4. Build the aggregator prompt: input = N raw JSON outputs, output = merged JSON + per-field agreement score. Test this in isolation with synthetic disagreement before wiring it to live model outputs.
5. Wire Stage 0 + Stage 1 into one endpoint, get end-to-end output working un-paid first.
6. Add x402 payment wrapper.
7. If time remains: build Stage 2 (regenerate + embed + cosine similarity), wire its output into the final confidence score.
8. Write the demo script around: (a) the free instant resolution-table hit as a "look, deterministic ground truth" beat, (b) the ensemble agreement scores as "here's why you can trust this field vs. that one," (c) the verification loop number as the closing "and here's proof it's not just a plausible-sounding guess."

---

## 10. Pitch framing (don't undersell, don't oversell)

**Don't say**: "Nobody has ever done image-to-prompt before."
**Do say**: "Image-to-prompt is a commodity capability — CLIP Interrogator, Midjourney `/describe`, and several SEO tools already do it as a human-facing webpage. What doesn't exist is a machine-payable, structured-output, self-verifying version of it that another agent can call mid-task, at any frequency, and trust programmatically without a human checking the output." Then demo the verification loop as the proof of that trust claim.
