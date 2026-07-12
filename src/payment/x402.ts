/**
 * x402.ts — the machine-payable gate (x402 / OKX A2MCP style).
 *
 * The whole wedge of this agent is that ANOTHER AGENT can pay per call with no
 * account and no human. That convention is HTTP 402:
 *
 *   1. Agent calls the paid endpoint with no payment.
 *   2. Server replies 402 Payment Required + a machine-readable `accepts` block
 *      describing exactly how to pay (amount, asset, chain, pay-to address).
 *   3. Agent settles onchain (OKX Agentic Wallet) and retries with proof in the
 *      `X-Payment` header.
 *   4. Server verifies the proof and runs the job.
 *
 * `verifyPayment()` is the single seam to wire real OKX settlement. In dev mode it
 * accepts the configured dev token so the whole system runs locally end-to-end today.
 */
import { config } from "../config.js";

export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string; // human units, e.g. "0.35"
    payTo: string;
    resource: string;
    description: string;
    mimeType: string;
  }>;
}

/** Build the 402 body advertised to unpaid callers. */
export function buildRequirements(resource: string): PaymentRequirements {
  return {
    x402Version: 1,
    error: "payment required",
    accepts: [
      {
        scheme: "exact",
        network: config.payment.chain, // e.g. "X Layer"
        asset: config.payment.asset, // USDT / USDG
        maxAmountRequired: config.payment.priceUsd.toFixed(2),
        payTo: config.payment.payTo,
        resource,
        description:
          "Cuerate Image Reverse-Engineer — one full reverse-engineer call " +
          "(image → structured prompt + confidence + trust score).",
        mimeType: "application/json",
      },
    ],
  };
}

export interface PaymentCheck {
  ok: boolean;
  reason: string;
  mode: "dev" | "live";
  payer?: string;
}

/**
 * Verify a payment proof from the `X-Payment` header.
 *
 * DEV MODE: any request whose X-Payment equals PAYMENT_DEV_TOKEN passes. This lets the
 * agent run locally and in the demo without real settlement.
 *
 * LIVE MODE (TODO for production listing): decode the X-Payment settlement proof,
 * confirm the onchain transfer of `priceUsd` in `asset` to `payTo` on `chain` via the
 * OKX Agentic Wallet / A2MCP settlement API, and return the payer address. This function
 * is the ONLY place that needs to change to go live — nothing upstream/downstream cares.
 */
export async function verifyPayment(paymentHeader: string | undefined): Promise<PaymentCheck> {
  if (config.payment.devMode) {
    if (paymentHeader && paymentHeader === config.payment.devToken) {
      return { ok: true, reason: "dev token accepted", mode: "dev", payer: "dev-agent" };
    }
    return {
      ok: false,
      reason: "missing or invalid X-Payment (dev mode expects the dev token)",
      mode: "dev",
    };
  }

  // ── LIVE settlement verification seam ──────────────────────────────────────
  if (!paymentHeader) {
    return { ok: false, reason: "no X-Payment header", mode: "live" };
  }
  // Replace the block below with a real OKX Agentic Wallet settlement check.
  // e.g. const proof = decodeX402(paymentHeader);
  //      const settled = await okxSettlement.verify({ proof, payTo, asset, chain, amount });
  //      return settled ? { ok:true,... } : { ok:false,... }
  return {
    ok: false,
    reason:
      "live settlement verification not yet wired — implement verifyPayment() against the OKX " +
      "Agentic Wallet / A2MCP settlement API, then set PAYMENT_DEV_MODE=false.",
    mode: "live",
  };
}
