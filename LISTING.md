# Listing the RE Agent on OKX.AI — step by step

Plain-English guide to getting this service **live on the OKX.AI marketplace** and submitted for the
Genesis Hackathon (deadline **July 17, 2026, 23:59 UTC**). No deep technical knowledge assumed.

> **Why these steps:** OKX.AI only counts your submission if the agent actually **passes OKX's review
> and goes live**. A live listing needs three things: (1) your service running at a **public HTTPS
> address**, (2) an **OKX Agentic Wallet identity** registered on **X Layer**, and (3) your service
> registered as an **ASP in A2MCP (pay-per-call) mode**. Then you post the X thread and submit the form.

---

## Part 1 — Get the agent running publicly

The service is already built and runs locally (see `README.md`). To list it, it needs a public URL.

1. **Confirm it works locally first.** In the `re-agent` folder: `npm install`, put your **one
   OpenRouter key** in `.env` (`OPENROUTER_API_KEY=sk-or-...`), `npm run server`, then
   `npm run demo -- <an-AI-image-url>`. You should see a reconstructed prompt print. (This is also
   your demo footage — see Part 4.)

2. **Deploy to a public HTTPS host.** Any Node host works — **Railway**, **Render**, **Fly.io**, or a
   small VM. The steps on each are similar:
   - Point it at this `re-agent` folder.
   - Start command: `npm run build && npm start` (or `npm run server`).
   - Set the environment variables from `.env.example` (at minimum `OPENROUTER_API_KEY`). Set
     `PORT` to whatever the host expects.
   - After deploy you'll get a URL like `https://cuerate-re-agent.up.railway.app`.
   - Check `https://<your-url>/health` returns `{"ok":true,...}`.

   > You (Neco) run this step, or hand the repo + your Anthropic key to whoever deploys it. It's a
   > standard Node deploy — no special infra.

---

## Part 2 — Set up your OKX Agentic Wallet + identity

OKX.AI connects agents through **Onchain OS**. You install it *through an MCP client* (Claude Code
works — OKX lists it as supported). Docs: **web3.okx.com/onchainos**.

1. **Install the Onchain OS skill** (one command, run in your agent/CLI):
   ```
   npx skills add okx/onchainos-skills
   ```

2. **Create your Agentic Wallet.** This is done through your agent and needs an **email address**.
   This wallet is your single onchain identity for the whole marketplace. **Save the wallet address** —
   paste it into `.env` as `PAYMENT_ADDRESS` (that's where per-call payments land).

3. **Install the registration skill and register your identity** (ERC-8004 on **X Layer**):
   ```
   npx skills add okx/okx-ai-guide
   ```
   Then use it to **register / create your agent** with role **`asp`** (Agent Service Provider). This
   skill can register, activate, set an avatar, and list your services on X Layer.

---

## Part 3 — Register the service as an ASP (A2MCP / pay-per-call)

1. **Choose the mode: A2MCP** (instant pay-per-call). This agent is a single-call tool, so A2MCP is the
   right mode (not A2A escrow).

2. **Point the listing at your MCP endpoint.** OKX discovers your capability through MCP. This project
   already exposes the tool `reverse_engineer_image` (and free `identify_image`) via `npm run mcp`.
   For the hosted listing, expose that MCP server over HTTPS from your deployed host and give OKX that
   endpoint during ASP registration. (The stdio version is for local testing; production uses the
   HTTP/SSE MCP transport at your public URL.)

3. **Set your price + payout asset.** In `.env`: `RE_PRICE_USD` (e.g. `0.35`), `PAYMENT_ASSET=USDT`
   (or `USDG`), `PAYMENT_CHAIN=X Layer`, `PAYMENT_ADDRESS=<your Agentic Wallet address>`.

4. **Turn on real settlement.** For production, set `PAYMENT_DEV_MODE=false` and implement the real
   check in `src/payment/x402.ts → verifyPayment()` against the OKX Agentic Wallet / A2MCP settlement
   API. **This is the one function that separates dev from live** — everything else already works.
   Until then, keep `PAYMENT_DEV_MODE=true` for local/demo runs.

   > **Keys recap:** the running service needs exactly **one** key — `OPENROUTER_API_KEY`. The only
   > other secret is your OKX Agentic Wallet **address** (`PAYMENT_ADDRESS`), which is a wallet
   > identifier from OKX, not an API key.

5. **Submit service details for OKX review.** Register as an ASP, submit the service, and wait for
   approval. Once approved you provide the service and receive payments in USDT/USDG per call.

---

## Part 4 — The X thread + hackathon submission

1. **Record a ≤90-second demo.** Screen-record the `npm run demo` flow (or the live marketplace call):
   - free `/identify` returns instant deterministic info (show a resolution-grid match — the "100%
     recoverable" beat),
   - the paid call returns a **402** then, after payment, the **reconstructed prompt + trust score +
     per-field confidence bars**,
   - narrate the wedge: *"machine-payable, structured, self-verifying image-to-prompt — callable by
     another agent mid-task."*

2. **Post the X thread** with **#OKXAI**, introducing the ASP and linking the ≤90s demo.

3. **Submit the Google form** (ASP details + link to the live OKX.AI listing + link to the X post)
   **before July 17, 23:59 UTC.**

---

## ⚠️ One thing to confirm with OKX before you rely on it

Your notes flagged an **Arc / USDC vs. OKX USDT-USDG** question. OKX.AI settles in **USDT or USDG on
its own rails (X Layer flagship)**, not Circle/USDC. For *this* RE Agent it doesn't matter — it takes
payment in USDT/USDG directly through the Agentic Wallet, no Arc dependency. Only revisit the conflict
if you later try to route Cuerate's existing USDC/Arc flow *through* OKX. For the hackathon submission,
list the RE Agent natively on OKX's rails and keep the Cuerate/Arc integration separate.

---

## Quick checklist

- [ ] `npm run demo` prints a reconstructed prompt locally
- [ ] Deployed to public HTTPS; `/health` returns ok
- [ ] Onchain OS installed; Agentic Wallet created; address in `.env`
- [ ] Identity registered as `asp` on X Layer (ERC-8004)
- [ ] Service registered in **A2MCP** mode, price + USDT/USDG payout set
- [ ] `verifyPayment()` wired for live settlement, `PAYMENT_DEV_MODE=false`
- [ ] Passed OKX review → **live on okx.ai**
- [ ] ≤90s demo recorded, X thread posted with #OKXAI
- [ ] Google form submitted before the deadline

---

### Sources
- [Join OKX.AI — Choose Your Role](https://www.okx.ai/tutorial)
- [OKX AI: A Marketplace for the Agent Economy](https://www.okx.com/en-us/learn/okx-ai)
- [okx-ai-guide — Agent Skills Library](https://mcpservers.org/agent-skills/okx/okx-ai-guide)
- [OKX AI marketplace launch (TechCrunch)](https://techcrunch.com/2026/06/30/crypto-exchange-okx-wants-ai-agents-to-hire-and-pay-each-other/)
- Onchain OS developer docs: web3.okx.com/onchainos
