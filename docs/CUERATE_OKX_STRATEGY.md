# Cuerate OKX AI Hackathon Strategy
### Project: Image Reverse-Engineer (RE) Agent & Cuerate Flywheel
**Date:** July 12, 2026
**Deadline:** July 17, 2026 (5 Days Remaining)

---

## 1. Executive Summary
We will build the **Image Reverse-Engineer (RE) Agent**, a specialized Agent Service Provider (ASP) for the OKX AI Marketplace. This agent solves a high-volume "commodity" problem (Image-to-Prompt) with a unique, agent-native value prop: **machine-payable, structured JSON output, and self-verified confidence.**

Every successful call to the RE Agent serves as a "verified pair" that automatically bootstraps the **Cuerate Inspiration Marketplace**, creating a compounding value flywheel.

---

## 2. The "OKX Wedge": Technical Architecture

### A. The 3-Stage Pipeline (Refined)
1.  **Stage 0: Deterministic ID** — Instant resolution/EXIF lookup. Free tier.
2.  **Stage 1: Ensemble Reconstruction** — Multi-vision model analysis merged by an Aggregator LLM. Output: Structured JSON with per-field confidence.
3.  **Stage 2: Verification Loop** — Regenerate image via prompt -> CLIP Embedding -> Cosine Similarity. This is the **Trust Metric**.

### B. OKX Integration (X Layer + A2MCP)
*   **Protocol:** **A2MCP** (Agent-to-MCP) for instant pay-per-call.
*   **Chain:** **X Layer** (OKX L2).
*   **Currency:** **USDT/USDG**.
*   **Gas:** Sponsored by OKX (Gas-free transactions for buyers/sellers).
*   **Identity:** Registered via **ERC-8004** on X Layer using the `okx-ai` skill.

---

## 3. The Hackathon "Kill Shots" (Prizes)

| Category | Why We Win |
| :--- | :--- |
| **Creative Genius** ($20K) | The first "Artist Intelligence" agent that provides structured forensic decoding of AI art. |
| **Artistic Excellence** ($7.5K) | The demo will be visually arresting, showing the "Verify" loop recreating a complex image from a machine-generated prompt. |
| **Revenue Rocket** ($20K) | Image generation is the #1 AI use case. Every creative agent needs prompt optimization. |

---

## 4. 5-Day Sprint Plan

### Day 1: The Core Pipeline (July 12)
- [ ] Implement Stage 0 (Static lookup tables for Gemini/Veo/Midjourney resolutions).
- [ ] Setup Stage 1 (Parallel calls to GPT-4o-vision, Gemini 1.5 Pro, and Claude 3.5 Sonnet).
- [ ] Implement the Aggregator logic (Merging JSON schemas).

### Day 2: The Verification Loop (July 13)
- [ ] Connect a text-to-image generator (e.g., Nano/Imagen/Stable Diffusion).
- [ ] Implement CLIP embedding and cosine similarity calculation.
- [ ] Finalize the "Trust Score" algorithm.

### Day 3: OKX Onchain OS Integration (July 14)
- [ ] Initialize `okx-agentic-wallet` and `okx-ai` skills.
- [ ] Wrap the pipeline in an HTTPS endpoint (MCP Server).
- [ ] Register the ASP identity on X Layer (Testnet/Devnet).

### Day 4: Demo & Social (July 15)
- [ ] Record a 90-second video showing:
    1.  Agent A needs to reproduce a style.
    2.  Agent A calls RE Agent via OKX AI.
    3.  RE Agent returns prompt + 95% verification score.
    4.  Agent A succeeds.
- [ ] Draft the X Thread (#OKXAI).

### Day 5: Submission & Buffer (July 16)
- [ ] Final internal review and Live listing on `okx.ai/agents`.
- [ ] Submit Google Form.

---

## 5. Next Steps for Neco
1.  **Choose the Tech Stack:** I recommend Next.js/TypeScript for the API/MCP wrapper to leverage the existing `Synesis` codebase if possible.
2.  **API Keys Needed:** OpenAI, Anthropic, Google Vertex (for Gemini/Veo), and OKX Dev Portal credentials.
3.  **Confirm:** Shall we start with the **Stage 0 Static Lookup Table** implementation today?
