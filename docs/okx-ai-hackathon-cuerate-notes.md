# OKX.AI Genesis Hackathon — Cuerate ASP Exploration

*Notes compiled July 8, 2026*

## The hackathon itself

- **What it is:** OKX and HackQuest are recruiting the first wave of **Agent Service Providers (ASPs)** for **OKX.AI**, a new agent-native marketplace where AI agents (not just humans) can discover and pay for services.
- **Dates:** Submissions open July 3, 2026 00:00 UTC → close **July 17, 2026 23:59 UTC**. That's roughly 9 days out from today.
- **Prize pool:** $100K total, max $10K per single award. Structure:
  - Best Product — $20K
  - Creative Genius — $20K
  - Revenue Rocket — $20K
  - Finance Copilot — $7.5K
  - Software Utility — $7.5K
  - Lifestyle Companion — $7.5K
  - Artistic Excellence — $7.5K
  - Social Buzz — $10K across 10 winners (community traction)
- **Mechanic (not a code-judged hackathon):**
  1. Build an ASP that solves a clear, real-world use case (crypto-native not required).
  2. Submit for listing on OKX.AI; it must pass OKX's internal review and go live — if it doesn't go live, the submission is invalid.
  3. Post an X thread with #OKXAI introducing the ASP (≤90 sec demo).
  4. Submit the Google form with ASP details + link to the X post before the deadline.
- **No published idea list.** The only real guidance is the category buckets above plus a repeated, deliberate line from OKX's own team: *"we're not looking for another chatbot."* They want measurable value and real usage, not conversation.

## What's already live on the OKX.AI marketplace (okx.ai/agents)

Pattern across current listings: narrow, single-call tools that pull real/live data or run a scoring model, answer once, priced cents-to-a-few-dollars, with a visible "sold" count as social proof. Examples: CertiK scam/trade checks, an onchain data explorer (180 chains), three separate World Cup prediction agents (WorldCupCaller, Upset Radar, Alpha wallet-tracker — this space is already crowded), a food-label health scorer, a US equities research assistant, a token radar, a yield radar, a cooking coach.

Takeaway: no one currently listed is selling **prompt intelligence to other agents** — everything live is human-facing single-answer tools.

## Cuerate as the ASP candidate

- Cuerate already has an **Inspiration API wrapped in x402** for micropayments — agents query proven prompt-result pairs instead of guessing, paying per query.
- The differentiation case: an agent, before attempting a task, queries Cuerate for a prompt already proven to work for that exact task (with a success/fork-lineage score attached), paying a few cents instead of burning several failed attempts worth of tokens. That's a genuine gap in the current marketplace, not a repackaging of something that already exists there.
- **Condition for that differentiation to hold:** it has to be callable by an agent programmatically (tool-use loop, x402 handshake), not a chat box a human clicks through. If it ships as a browsable UI, it collapses into "just another marketplace listing." Cuerate's existing x402-wrapped API already meets this bar — that's the strongest point in its favor.

## Broader ASP landscape (outside OKX) — what's actually proven

Looked past generic "enterprise AI agent" content (that's a different world — internal automation, not a monetized agent economy) and focused on the real comparable space: x402 / agent-payments infrastructure. This is much further along than expected — Coinbase's x402 alone has processed **169 million transactions across 590,000 buyers and 100,000 sellers** in its first year, and Cloudflare + AWS both shipped x402 payments at their edge networks within two weeks of each other this past month.

Proven patterns, in order of relevance to Cuerate:

1. **Data / content paywalls** — pay $0.10–$0.25 per query/article/dataset, no account, no subscription. This is Cuerate's exact model.
2. **Streaming/metered micropayments** — pay per second of a live feed or per frame processed. Less relevant to Cuerate's single-call model, but worth knowing as the #2 proven pattern.
3. **The "x402 Bazaar Agent" pattern** — an agent takes a plain-English question, searches a catalog of paid endpoints via semantic embeddings, picks the cheapest sources, pays per call, and composes a cited answer with **no human in the loop**. Critically: after every paid call, **a second independent model judges whether the response actually served the stated purpose** — that verification step is what makes a buyer trust an unknown seller in the marketplace.
   - This is structurally almost identical to what Cuerate does. It's proof the category is real and already monetizing.
   - **The gap:** Cuerate doesn't yet have that independent verification pass — a second check confirming a served prompt actually produced the outcome it claims a track record for. This is the single biggest trust upgrade to make before submitting.
4. **Monetization-as-a-service** — a proxy layer that wraps someone else's existing API in x402 paywalls without touching their backend. Not something Cuerate needs, but shows there's appetite for "add payments to your thing" as its own product.
5. **Spend-governance layers** — an ASP that sits between an agent and its wallet enforcing budget policy, producing an audit trail. Close to what Synesis's policy engine already half-does — worth keeping as a backup ASP idea if Cuerate doesn't work out.

## The new problem: OKX.AI's own payment rails vs. Arc

OKX.AI ASPs run through **OKX's own infrastructure**, not just any x402 endpoint:

- Every ASP operates under a single onchain identity via the **OKX Agentic Wallet**, set up through **Onchain OS**, OKX's own toolkit for connecting AI agents to onchain services.
- Two service modes: **A2A** (escrow-based, negotiated jobs) and **A2MCP** (instant pay-per-call — this is the one that matches Cuerate).
- Payments settle in **USDT or USDG** stablecoins specifically — not USDC.
- Onchain OS supports "multiple networks, including EVM chains and Solana," with some stablecoin transfers gas-free on **X Layer** specifically.

**The conflict:** Cuerate is built on **Arc Network** (Circle infrastructure), using x402 payments presumably denominated in USDC. OKX.AI's stack is USDT/USDG settlement through its own Agentic Wallet, with X Layer as the flagship low-friction chain. It is not yet confirmed whether:
- Arc is one of the EVM chains Onchain OS actually integrates with, or
- Cuerate's existing x402/USDC flow can sit behind or alongside the OKX Agentic Wallet without a parallel integration, or
- listing on OKX.AI would require Cuerate to support USDT/USDG settlement in addition to (or instead of) its current USDC rail.

This needs a direct check against OKX's Onchain OS docs / API before committing more work — it may collapse the "repackage, don't rebuild" advantage that made Cuerate look like the cheap path in.

## What agents actually pay for — the full landscape

OKX themselves described early priority categories as **"trading, onchain activity, and research tasks."** That tells you exactly where the crowd will go. Understanding both lanes matters.

### Lane 1: Onchain / Crypto Services (crowded — everyone will build here)

These are the obvious plays. Most hackathon participants default to them because they match OKX's brand and the builder audience already knows the problem space. Expect heavy competition in every one of these:

- Security checks before transacting (CertiK already doing this on the marketplace)
- Live market data feeds (CoinAnk already doing this pay-per-query)
- DEX swaps and bridge routing
- Onchain intelligence — wallet analysis, transaction history decoding
- Whale tracker — monitor large wallet moves, alert on patterns
- Token radar — surface new tokens by volume, holders, age
- Yield optimizer — scan DeFi protocols for best APY on a given asset
- Arbitrage finder — cross-exchange or cross-chain price gap detection
- Smart contract scanner — static analysis, vulnerability flagging, reentrancy detection
- Prediction market edge finder — Polymarket/Kalshi aggregator with edge calculation (Oracle territory)
- Wallet wrapper — a clean programmatic interface over a raw wallet for other agents to call

The real risk here isn't that these are bad ideas. It's that 90% of participants will build toward them, and the live marketplace already has several of the most obvious ones covered. You'd need a genuinely superior implementation, not just a new instance of the same thing.

### Lane 2: Off-Chain / Real World Services (less crowded — creative edge lives here)

These are the plays most crypto-native builders won't think to make, but OKX explicitly said "crypto-native use cases are welcome, but not required." The judge criteria reward real usage and real problems solved. Off-chain services that agents would call repeatedly, at volume, are often a better fit for the Revenue Rocket and Creative Genius prizes than yet another onchain data tool.

Agents in the agentic economy provably pay for: API access, compute cycles, research data, proprietary datasets, content behind paywalls, domain registration, media processing, and services other agents provide. The non-crypto equivalents on OKX.AI that haven't been built yet include:

- **Food / nutrition analyzer** — snap an image of your food, agent returns full macro breakdown, allergen flags, health score, portion estimates. High repeat usage. Lifestyle Companion category, no competition yet.
- **Nutrition label decoder** — feed a product barcode or label image, get structured nutrition data back. Works for both humans and agents managing dietary plans.
- **Résumé/LinkedIn scorer** — agent submits a profile, gets back ATS-pass probability, gap analysis, keyword recommendations. Massive volume potential, every job-hunting AI would call this.
- **Contract summarizer** — paste any legal/service agreement, get plain-language risks, unusual clauses, red flags. Agents doing procurement or vendor evaluation would call this repeatedly.
- **Weather + location intelligence** — structured weather data, UV index, pollen count, air quality, keyed to coordinates. Lifestyle and logistics agents pay for this.
- **Meeting transcript intelligence** — upload a transcript, get action items, decisions, unresolved questions, next steps. Any productivity agent would use this.
- **Sentiment scorer** — submit a body of text (tweet, article, review), get back a structured sentiment + tone breakdown. Marketing agents, financial agents, social listening agents all use this.
- **Image metadata extractor** — pass an image URL, get back objects detected, text extracted, color palette, EXIF data. Useful for agents managing content or building datasets.
- **Research paper summarizer** — URL in, structured abstract + key claims + limitations out. Any agent doing literature survey would call this.

---

## The Differentiation Thesis (Neco's strategic read)

The call made in our session: **don't go onchain if it means competing with the crowd.** The off-chain lane is real, underbuilt on OKX.AI right now, and maps better to the Creative Genius and Lifestyle Companion prize tracks which have less competition. The risk of going onchain is being undifferentiated at submission time with 9 days to build while simultaneously running Player Perps and Cuerate/Lepton in parallel.

The counter-argument (to be honest): OKX's own priority for the beta is trading/onchain activity — judges may unconsciously weight those even if the rules say otherwise. This is a real tension, not a solved question.

---

## The Reverse Engineer Agent — Neco's Original Idea (CORRECTED)

**Clarification:** This is not a smart contract or code decompiler. The concept is: **pass an AI-generated image, get back the prompt that would generate that image.** Image-to-prompt reverse engineering, packaged as a paid callable agent service.

### The core service
An agent (or human) submits an image → the RE Agent analyzes it and returns the structured prompt that would reproduce it: style descriptors, composition language, lighting cues, negative prompts, model-specific parameters (Midjourney flags, SD weights, aspect ratio, etc.), and a confidence score. Priced at $0.25–$0.50 per call, pay-per-query A2MCP mode on OKX.AI.

### Why the Cuerate connection is near-perfect here
Every image-to-prompt call automatically produces a **validated prompt-result pair** — the image *is* the proof of output. You don't need a separate independent verification model. The image serves as self-evident evidence that the prompt works. Every RE Agent call doesn't just generate revenue — it seeds Cuerate's marketplace with verified inventory. The bootstrap problem Cuerate has always had (how do you accumulate enough proven pairs to be valuable at launch?) solves itself through RE Agent usage volume. The RE Agent generates the pairs; Cuerate monetizes them. These aren't two products, they're one compounding flywheel.

The fork-royalty system applies naturally too: if someone in Cuerate remixes a prompt that originated from a RE Agent call, the original job earns residuals down the lineage. Revenue streams layer.

### Why this wins on OKX.AI specifically
- **Artistic Excellence** ($7.5K) — natural home, under-contested because most builders go onchain
- **Creative Genius** ($20K) — legitimate shot, concept is original and the demo is visually arresting
- **Revenue Rocket** ($20K) — image generation is one of the highest-volume AI workflows in the world; repeat call rate would be extremely high
- Nothing like it exists on the OKX.AI marketplace currently

### Build feasibility in 9 days
Very high. The MVP is purely a vision model call with a structured output schema — no blockchain reads, no live data feeds, no complex state. Accept image URL or base64 → run a vision-capable LLM with a structured prompt-engineering system prompt → return JSON with inferred prompt, style tags, model recommendations, and confidence score. The OKX Agentic Wallet integration is the only new piece. Core build is 1–2 days, leaving time for polish and the X demo.

---

## Branding Agent — Second Primary Candidate

**Concept:** Give the agent a product description, and it outputs a full branding package — logo concepts, color palette, typography direction, brand voice/tone guidelines, tagline options, and generated visual assets. One call, full brand identity output.

### Why this works as an ASP

Every startup, indie builder, NFT project, and solopreneur needs branding and most can't afford a designer or agency. An agent that takes "I'm building a DeFi yield optimizer for retail users, clean and trustworthy" and returns a complete brand kit in 30 seconds for $1–2 is immediately useful to a massive audience. The OKX.AI platform is populated with builders who are exactly this customer — they have a product, no brand, and no design budget.

Repeat usage is also strong: branding isn't a one-shot call. Users iterate — they try a description, refine it, generate variations, test different directions. Every iteration is a paid call.

### The Cuerate connection

Every successful branding output is a prompt-result pair by definition. The product description is the prompt input; the generated visual and brand guidelines are the result. These feed directly into Cuerate's marketplace — future agents or users building in a similar space (fintech, gaming, food, etc.) can query Cuerate for a proven branding prompt in their category instead of starting from scratch. The Branding Agent generates category-tagged creative inventory for Cuerate automatically.

### How it pairs with the Image-to-Prompt RE Agent

These two are complementary, not competing. The RE Agent deconstructs images into prompts. The Branding Agent constructs brand visuals from descriptions. Together they form a creative intelligence loop — one for understanding existing visuals, one for generating new ones. If submitted as part of a unified Cuerate ASP, they strengthen each other's positioning under the Creative Genius and Artistic Excellence categories.

### OKX prize fit

- **Artistic Excellence** ($7.5K) — direct fit, visual output is the product
- **Creative Genius** ($20K) — strong candidate, especially if the output quality is high and the demo shows end-to-end brand generation from a single description
- **Lifestyle Companion** ($7.5K) — secondary fit if framed around the solopreneur / one-person company angle (which maps to OKX's own "one person, one company, $1M/year" messaging)

### Build feasibility

Moderate-high. The core pipeline is: parse product description → generate brand brief (LLM) → generate visual assets (image generation model) → package output as structured JSON with image URLs + brand guidelines text. The main complexity is image generation integration and output consistency. MVP could ship with text brand guidelines + one hero image, then expand. 2–3 days of focused work.

---

## Full ASP Idea Ranking (for this hackathon)

| Idea | Differentiation | Build time | OKX fit | Competing entries est. |
|---|---|---|---|---|
| Image-to-Prompt RE Agent | Very high — nothing like it live | 1–2 days for MVP | Artistic Excellence + Creative Genius | Near zero |
| Cuerate Inspiration API (as ASP) | High — agents-pay-for-prompts is unique | 1–2 days (repackage) | Software Utility | Zero (but Arc/USDT conflict unsolved) |
| Food / nutrition analyzer | Medium — food-label health scorer already live | 2–3 days | Lifestyle Companion | 1 direct competitor already listed |
| Smart contract scanner | Medium — CertiK already covers security checks | 3–4 days | Finance Copilot | High (many builders) |
| Arbitrage finder | Low — obvious play | 3–5 days | Finance Copilot | Very high (many builders) |
| Whale tracker | Low — obvious play | 2–4 days | Finance Copilot | Very high (many builders) |
| Prediction market edge finder | Medium — not on marketplace yet | 4–6 days | Finance Copilot | Low but builds on Oracle work |

---

## Open Questions / Next Steps

1. **Arc/USDT conflict** — Confirm whether Onchain OS / OKX Agentic Wallet supports Arc Network EVM, or only a fixed set of chains. If not supported, Cuerate-as-ASP requires a USDT-accepting wrapper layer — that changes the build cost estimate significantly.
2. **Reverse Engineer Agent scoping** — Decide whether to scope to EVM contracts only (fast, narrow, complete) vs. general API/code RE (wider value, more complex). EVM-only MVP is the right call for 9 days.
3. **Cuerate + RE Agent combo** — Decide if these are one submission (Cuerate gains a RE skill, submitted as a unified ASP) or two separate submissions (if the rules allow multiple entries per builder).
4. **Timeline pressure** — Player Perps is due July 19 and Cuerate/Lepton is in flight. Any OKX work has to be scoped so it doesn't compromise either of those.
