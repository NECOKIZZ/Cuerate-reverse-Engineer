# OKX Listing Pre-flight Checklist — Cuerate Lens (#5170)

Run this **before every resubmission**. Every item is a real command; a reviewer-visible
failure in any of them is a plausible rejection. Last full pass: **2026-07-16, all green**.

Prod base: `https://cuerate-reverse-engineer-production.up.railway.app`

## 1. The listed endpoint IS the x402 endpoint

The service entry's `endpoint` must be the exact URL that returns the 402 challenge —
not the site root (root returns a 200 manifest and reads as "not an x402 service").

```bash
onchainos agent service-list --agent-id 5170   # endpoint must end in /reverse-engineer
```

Rejection this guards against: reviewer probes the listed URL, gets 200/404, fails listing.
(This exact mismatch existed until 2026-07-16 — fixed via `onchainos agent update`,
service id 32941.)

## 2. OKX's own validator passes on that exact URL

```bash
onchainos agent x402-check \
  --endpoint https://cuerate-reverse-engineer-production.up.railway.app/reverse-engineer
```

Must return `"valid":true` **and** a resolved `amountHuman` (0.35). If `valid:true` but a
`tokenResolveError` appears, the accepts entry is missing `decimals`.

## 3. The 402 challenge itself (the 07-15 rejection)

```bash
curl -s https://cuerate-reverse-engineer-production.up.railway.app/reverse-engineer -D - -o /dev/null \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d | python3 -m json.tool
```

- [ ] Status is **402** for GET, HEAD, and unpaid POST (validators probe with GET; a
      POST-only route 404s)
- [ ] `PAYMENT-REQUIRED` header present and is valid **base64 of JSON** (not raw JSON)
- [ ] Decodes to `{x402Version, resource, accepts:[…]}` with a **non-empty** accepts array
- [ ] Accepts entry has: `scheme` (`aggr_deferred`), `network` (`xlayer`), `asset`
      (contract addr), `amount` **and** `maxAmountRequired` (same atomic value, `"350000"`),
      `payTo`, `maxTimeoutSeconds` (>0), `decimals` (6), `extra.name` + `extra.version`

## 4. Challenge values match the on-chain listing (no drift)

| Field | Must equal |
|---|---|
| `amount` / fee | `350000` atomic = **0.35** = service `fee` |
| `asset` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (USD₮0, X Layer — the service's `contractAddress`; set via `PAYMENT_ASSET_ADDRESS` on Railway) |
| `payTo` | `0xee1b6ebf3077ac64976f4078e28b609ffc63a3e6` (agent wallet) |
| `network` | `xlayer` (chainIndex 196) |

If the price ever changes: change it in **both** places (Railway `RE_PRICE_USD` and the
service entry fee) or the reviewer sees a mismatch.

## 5. Service health a reviewer can see

```bash
curl -s $BASE/health          # ok:true, payment: LIVE (OKX facilitator)
curl -s $BASE/                # manifest readable
curl -s -X POST $BASE/identify -H 'Content-Type: application/json' \
  -d '{"image_base64":"<any small png b64>"}'          # free tier returns 200
curl -s -X POST $BASE/reverse-engineer -H 'X-Payment: bogus' \
  -H 'Content-Type: application/json' -d '{}' -o /dev/null -w "%{http_code}"  # 402, never 500
```

- [ ] `/health` says `payment: LIVE (OKX facilitator)` — **not** DEV MODE and **not**
      `LIVE ⚠️ misconfigured` (live mode needs `OKX_API_KEY/SECRET/PASSPHRASE`,
      `PAYMENT_ASSET_ADDRESS`, `PAYMENT_ADDRESS`, `PAYMENT_DEV_MODE=false` on Railway)
- [ ] Garbage `X-Payment` → clean 402 (fail-closed), not a 5xx

## 6. Agent status plumbing

```bash
okx-a2a doctor --fix            # daemon must be ready before any mutating agent op
onchainos agent get-my-agents   # onlineStatus:1; approvalLabel "Listing under review" after submit
```

## 7. Resubmit

```bash
onchainos agent activate --agent-id 5170 --preferred-language en-US
```

Success looks like: `submitApproval:[{"approvalStatus":2,"success":true}]`. The `activate`
block may still echo the OLD `rejectReason` — that's the previous verdict, not a new failure;
confirm via `get-my-agents` that approvalLabel is "Listing under review" and remark is empty.

## Known residual risks (not checkable from here)

- **A real `aggr_deferred` settlement has never been executed** — verify/settle is wired
  fail-closed against `web3.okx.com /api/v6/pay/x402/verify → /settle`, but the first real
  paid call is the true test. Worst case is a rejected payer, never free service.
- Railway cold starts / restarts: if the reviewer probes during a deploy they may catch a
  blip. Don't push non-essential commits while the review is pending.
- `x402-check` reports `tokenSymbol: UNKNOWN` for USD₮0 (not in OKX's task-system token
  list). `decimals` in the accepts entry compensates; if a rejection ever cites the token,
  switching `PAYMENT_ASSET_ADDRESS` to plain USDT
  `0x1E4a5963aBFD975d8c9021ce480b42188849D41d` (verified 6dp) **and** updating the service
  `contractAddress` to match is the fallback.
