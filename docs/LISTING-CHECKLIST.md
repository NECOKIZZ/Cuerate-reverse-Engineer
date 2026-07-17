# OKX Listing Pre-flight Checklist — Cuerate Lens (#5170)

Run this **before every resubmission**. Every item is a real command; a reviewer-visible
failure in any of them is a plausible rejection. Last full pass: **2026-07-17** (post
SDK migration — payment gate is now the official OKX Payment SDK `@okxweb3/x402-fastify`).

Prod base: `https://cuerate-reverse-engineer-production.up.railway.app`

## 0. What changed on 2026-07-17 (3rd submission)

The hand-rolled x402 gate was replaced with the **official OKX Payment SDK**
(`@okxweb3/x402-fastify` + `x402-core` + `x402-evm`) — the rejection notice explicitly
requires "Integrate x402 on your server using the OKX Payment SDK". Shape changes:

| Field | Old (rejected) | New (SDK / v2 standard) |
|---|---|---|
| `x402Version` | `1` | **`2`** (the SDK validates `z.literal(2)`) |
| `scheme` | `aggr_deferred` | **`exact`** (one-shot EIP-3009 pay-per-call) |
| `network` | `xlayer` | **`eip155:196`** (CAIP-2 — validator requires `namespace:reference`) |
| `resource` | `"/reverse-engineer"` (path string) | **object** `{url: <absolute https URL>, description, mimeType}` |
| accepts entry | had non-standard `maxAmountRequired`, `decimals`, `resource`, `description`, `mimeType` | exactly `{scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra}` |
| `extra.name` | `USDT` | **`USD₮0`** (the token contract's EIP-712 domain name — buyers sign against it) |
| payment header in | `X-Payment` | **`PAYMENT-SIGNATURE`** (v2; SDK reads it) |
| settlement | manual verify→settle before running the job | SDK: verify → run handler → **settle only on 2xx** (bad input never charges) |

Also fixed the second rejection reason (platform-test timeout): every model call now has
a hard `AbortSignal.timeout` (`LLM_TIMEOUT_MS`, default 60 s; image fetch 15 s), so the
paid endpoint always answers.

## 1. The listed endpoint IS the x402 endpoint

The service entry's `endpoint` must be the exact URL that returns the 402 challenge —
not the site root (root returns a 200 manifest and reads as "not an x402 service").

```bash
onchainos agent service-list --agent-id 5170   # endpoint must end in /reverse-engineer
```

## 2. OKX's own validator passes on that exact URL

```bash
onchainos agent x402-check \
  --endpoint https://cuerate-reverse-engineer-production.up.railway.app/reverse-engineer
```

Must return `"valid":true` and a resolved `amountHuman` (0.35).

## 3. The 402 challenge itself

```bash
curl -s https://cuerate-reverse-engineer-production.up.railway.app/reverse-engineer -D - -o /dev/null \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d | python3 -m json.tool
```

- [ ] Status is **402** for GET, HEAD, and unpaid POST (validators probe with GET)
- [ ] `PAYMENT-REQUIRED` header present, valid **base64 of JSON**
- [ ] Decodes to `{x402Version: 2, resource: {url, description, mimeType}, accepts: […]}`
- [ ] `resource.url` is the **absolute** prod URL (set `PUBLIC_BASE_URL` on Railway)
- [ ] Accepts entry is exactly: `scheme:"exact"`, `network:"eip155:196"`,
      `amount:"350000"`, `asset:0x779Ded…3736`, `payTo:<agent wallet>`,
      `maxTimeoutSeconds:300`, `extra:{name:"USD₮0", version:"1"}`

## 4. Challenge values match the on-chain listing (no drift)

| Field | Must equal |
|---|---|
| `amount` / fee | `350000` atomic = **0.35** = service `fee` |
| `asset` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (USD₮0 — OKX's required settlement token on X Layer; plain USDT `0x1E4a…D41d` is a documented rejection) |
| `payTo` | `0xee1b6ebf3077ac64976f4078e28b609ffc63a3e6` (agent wallet) |
| `network` | `eip155:196` (X Layer, chainIndex 196) |

If the price ever changes: change it in **both** places (Railway `RE_PRICE_USD` and the
service entry fee) or the reviewer sees a mismatch.

## 5. Service health a reviewer can see

```bash
BASE=https://cuerate-reverse-engineer-production.up.railway.app
curl -s $BASE/health          # ok:true, payment: LIVE (OKX facilitator)
curl -s $BASE/                # manifest readable, embeds the x402 challenge JSON
curl -s -X POST $BASE/identify -H 'Content-Type: application/json' \
  -d '{"image_base64":"<any small png b64>"}'          # free tier returns 200
curl -s -X POST $BASE/reverse-engineer -H 'PAYMENT-SIGNATURE: Ym9ndXM=' \
  -H 'Content-Type: application/json' -d '{}' -o /dev/null -w "%{http_code}"  # 402, never 500
# timing: paid pipeline is hard-capped (LLM_TIMEOUT_MS per model call) — a paid POST
# with a real image must return well under ~3 minutes even if a provider hangs.
```

- [ ] `/health` says `payment: LIVE (OKX facilitator)` — **not** DEV MODE and **not**
      `LIVE ⚠️ misconfigured` (live mode needs `OKX_API_KEY/SECRET/PASSPHRASE`,
      `PAYMENT_ADDRESS`, `PAYMENT_DEV_MODE=false` on Railway)
- [ ] Garbage `PAYMENT-SIGNATURE` → clean 402 (fail-closed), not a 5xx

## 6. Railway env (live)

Required: `OPENROUTER_API_KEY`, `PAYMENT_DEV_MODE=false`, `OKX_API_KEY`,
`OKX_API_SECRET`, `OKX_API_PASSPHRASE`, `PAYMENT_ADDRESS`.
Recommended explicit: `PUBLIC_BASE_URL`, `PAYMENT_NETWORK=eip155:196`,
`PAYMENT_ASSET_ADDRESS=0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, `PAYMENT_ASSET=USD₮0`.
(Legacy values `xlayer`/`USDT` are auto-normalized by config.ts, but set them clean.)

## 7. Agent status plumbing

```bash
okx-a2a doctor --fix            # daemon must be ready before any mutating agent op
onchainos agent get-my-agents   # onlineStatus:1; approvalLabel "Listing under review" after submit
```

## 8. Resubmit

```bash
onchainos agent activate --agent-id 5170 --preferred-language en-US
```

Success looks like: `submitApproval:[{"approvalStatus":2,"success":true}]`. The `activate`
block may still echo the OLD `rejectReason` — that's the previous verdict, not a new failure;
confirm via `get-my-agents` that approvalLabel is "Listing under review" and remark is empty.

## Known residual risks (not checkable from here)

- **A real `exact` settlement has never been executed** — verify/settle now runs through
  the SDK's `OKXFacilitatorClient` (`/api/v6/pay/x402/verify → /settle`, HMAC-signed),
  fail-closed. The first real paid call is the true test; worst case is a rejected payer,
  never free service.
- The SDK fetches `/api/v6/pay/x402/supported` on the first paid-route request. Our
  `ResilientFacilitator` merges in a static `exact @ eip155:196` kind and falls back to it
  if that call fails, so the 402 challenge never depends on facilitator availability.
- Railway cold starts / restarts: if the reviewer probes during a deploy they may catch a
  blip. Don't push non-essential commits while the review is pending.
