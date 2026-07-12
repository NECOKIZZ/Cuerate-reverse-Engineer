# Cuerate — Image Reverse-Engineer Agent

**Turn an AI-generated image into the prompt that would reproduce it** — as a machine-payable,
agent-callable service for the [OKX.AI](https://okx.ai) marketplace.

Another agent, mid-task, sends an image and pays a few cents. It gets back a **structured prompt**
(subject, composition, camera, lighting, style, text, aspect ratio, artifacts, provenance) — each
field with its **own confidence score** — plus a single ready-to-use `reconstructed_prompt` and an
overall **trust score**. Every call also produces a verified prompt→image pair that seeds the
**Cuerate** inspiration marketplace (the flywheel).

The wedge isn't "image-to-prompt" (that's a commodity). It's **machine-payable + structured +
self-verifying**, callable by another agent with no human squinting at a webpage.

---

## The pipeline

```
image → Stage 0 · Identify   dimensions + resolution-grid model-family match + EXIF/C2PA   (FREE, instant)
      → Stage 1 · Reconstruct  N independent vision passes → aggregator → structured JSON
      → Stage 2 · Verify       regenerate & compare (or ensemble-agreement) → trust score
      → structured prompt + per-field confidence + trust score
```

- **Stage 0** is deterministic and free — no model calls. If the pixel dimensions match a known
  Gemini/Veo/Midjourney/SDXL/DALL·E grid, aspect ratio is returned at 100% confidence.
- **Stage 1** runs several independent vision passes and an aggregator merges them. Agreement across
  passes *is* the confidence signal. Confidence ceilings are enforced in code (e.g. negative-space
  can never exceed 0.4; provenance can't be "confirmed" without a real signal).
- **Stage 2** produces the trust score — by regenerating an image from the prompt and comparing it to
  the original (when an image-gen endpoint is configured), or from ensemble agreement (default).

---

## Run it in 3 steps

You need **Node 20+** and **one OpenRouter API key** (the only key required). That single key
reaches Claude, GPT, Gemini and image models — so the ensemble is genuinely multi-vendor with
nothing else to sign up for. Get a key at <https://openrouter.ai/keys>.

```bash
# 1. install
cd "re-agent"
npm install

# 2. configure — copy the template and paste your OpenRouter key into .env
cp .env.example .env
#    then edit .env and set OPENROUTER_API_KEY=sk-or-...

# 3. start the service
npm run server
```

> No key yet? Run everything offline with `MOCK_LLM=true npm run server` (clearly-labeled mock
> output, no network) just to see the whole flow.

You'll see it print the active providers and `listening on :8787`.

### Try it (in a second terminal)

```bash
# FREE deterministic identify:
curl -s -X POST localhost:8787/identify \
  -H 'content-type: application/json' \
  -d '{"image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"}' | jq

# PAID full reverse-engineer (dev mode uses the demo token as payment proof):
curl -s -X POST localhost:8787/reverse-engineer \
  -H 'content-type: application/json' \
  -H 'x-payment: dev-okx-demo-token' \
  -d '{"image_url":"<AI-IMAGE-URL>"}' | jq
```

Without the `x-payment` header, `/reverse-engineer` returns **HTTP 402** with machine-readable
payment requirements — that's the agent-payable handshake.

### One-command demo (the 90-second story)

```bash
npm run server            # terminal 1
npm run demo -- <image-url-or-local-path>   # terminal 2
```

The demo agent calls the free tier, gets a 402 on the paid tier, "pays", retries, and prints the
reconstructed prompt + a per-field confidence chart.

### As an MCP tool (the OKX A2MCP surface)

```bash
npm run mcp   # speaks MCP over stdio; exposes tools: reverse_engineer_image, identify_image
```

---

## What one OpenRouter key gets you

| Piece | With your OpenRouter key | Tune via |
|---|---|---|
| Stage 0 identify | ✅ fully real, deterministic (no model call) | — |
| Stage 1 ensemble | ✅ real **multi-vendor** vision (Claude + GPT + Gemini together) | `ENSEMBLE_MODELS` (comma-sep slugs) |
| Stage 1.5 aggregator | ✅ real merge into scored JSON | `AGGREGATOR_MODEL` |
| Stage 2 trust | ✅ agreement-based by default; real regenerate-and-compare when enabled | `IMAGE_GEN_MODEL` (an OpenRouter image slug) |
| Payment gate | ✅ real 402 handshake, dev-token settlement | wire `verifyPayment()` + `PAYMENT_DEV_MODE=false` for live OKX settlement |

Nothing is faked or overclaimed: the trust method is always labeled (`agreement` vs
`regenerate-verified`), and reconstruction is always framed as lossy. Each ensemble model
fails independently, so one bad slug never breaks a call.

---

## Configuration (`.env`)

See `.env.example`. Key settings: `OPENROUTER_API_KEY` (the only required key),
`ENSEMBLE_MODELS` / `AGGREGATOR_MODEL` / `IMAGE_GEN_MODEL` (model choices),
`RE_PRICE_USD` / `PAYMENT_ASSET` / `PAYMENT_CHAIN` / `PAYMENT_ADDRESS`, and `PAYMENT_DEV_MODE`.

## API contract

- `GET /` — service manifest an agent reads to learn the contract
- `GET /health` — liveness + active providers
- `POST /identify` — **free** Stage-0 (`{image_url}` or `{image_base64}`)
- `POST /reverse-engineer` — **paid**, 402-gated, full pipeline

Field names and confidence ceilings are locked in `src/schema.ts` — that's the contract other
agents depend on.

## Listing on OKX.AI

See **[LISTING.md](./LISTING.md)** for the plain-English, step-by-step guide to getting this live on
the marketplace (creds to collect, public deploy, identity registration, submission).
