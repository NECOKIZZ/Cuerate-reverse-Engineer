/**
 * x402.ts — the machine-payable gate (x402 / OKX A2MCP).
 *
 * The whole wedge of this agent is that ANOTHER AGENT can pay per call with no
 * account and no human. That convention is HTTP 402:
 *
 *   1. Agent calls the paid endpoint with no payment.
 *   2. Server replies 402 Payment Required + a machine-readable `accepts` block
 *      describing exactly how to pay (amount, asset, network, pay-to address).
 *   3. Agent settles via its OKX Agentic Wallet and retries with the signed x402
 *      payload in the `X-Payment` header.
 *   4. Server verifies + settles the payload through the OKX facilitator, then runs the job.
 *
 * DEV MODE (PAYMENT_DEV_MODE=true): a shared token stands in for settlement so the whole
 * system runs locally end-to-end with no onchain money. LIVE MODE: real verify+settle
 * against the OKX x402 facilitator (`/api/v6/pay/x402/verify` → `/settle`).
 *
 * Docs: https://web3.okx.com/onchainos/dev-docs/payments/api-http-batch
 */
import crypto from "node:crypto";
import { config, paymentLiveConfigured } from "../config.js";

const X402_VERSION = 1;

/** OKX aggregated-deferred scheme — the settlement model A2MCP pay-per-call uses. */
const X402_SCHEME = "aggr_deferred";

/** A single x402 payment-requirements object (what the buyer signs against). */
export interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string; // atomic units of `asset`, e.g. "350000" for 0.35 USDT (6 dp)
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string; // ERC-20 contract of the payout token
  extra: Record<string, unknown>;
}

/** The full 402 body advertised to unpaid callers. */
export interface PaymentRequirements {
  x402Version: number;
  error: string;
  accepts: X402Requirements[];
}

/**
 * Convert a human decimal amount (0.35) to atomic token units ("350000") without float
 * error. Pure string/BigInt math so 0.35 @ 6dp is exact.
 */
function toAtomic(amount: number, decimals: number): string {
  const [intPart, fracRaw = ""] = amount.toString().split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const digits = (intPart + frac).replace(/^0+(?=\d)/, "");
  return BigInt(digits === "" ? "0" : digits).toString();
}

/**
 * The canonical requirements object. Used BOTH for the advertised 402 and for the
 * facilitator verify/settle calls — so the buyer always signs exactly what we later
 * verify, and the amount/payTo can never be undercut by a client-supplied value.
 */
export function x402Requirements(resource: string): X402Requirements {
  return {
    scheme: X402_SCHEME,
    network: config.payment.network,
    maxAmountRequired: toAtomic(config.payment.priceUsd, config.payment.assetDecimals),
    resource,
    description:
      "Cuerate Lens — one full Prompt Reverse-Engineer call " +
      "(image → structured prompt + per-field confidence + trust score).",
    mimeType: "application/json",
    payTo: config.payment.payTo,
    maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
    asset: config.payment.assetAddress,
    // sessionCert lives on the buyer's paymentPayload.accepted.extra — NOT here.
    extra: { name: config.payment.asset },
  };
}

/** Build the 402 body advertised to unpaid callers. */
export function buildRequirements(resource: string): PaymentRequirements {
  return {
    x402Version: X402_VERSION,
    error: "payment required",
    accepts: [x402Requirements(resource)],
  };
}

export interface PaymentCheck {
  ok: boolean;
  reason: string;
  mode: "dev" | "live";
  payer?: string;
}

// ── OKX facilitator client ────────────────────────────────────────────────────

/** OKX API request signature: base64(HMAC-SHA256(timestamp + method + path + body)). */
function okxHeaders(method: string, path: string, body: string): Record<string, string> {
  const timestamp = new Date().toISOString();
  const prehash = timestamp + method.toUpperCase() + path + body;
  const sign = crypto.createHmac("sha256", config.okx.apiSecret).update(prehash).digest("base64");
  return {
    "OK-ACCESS-KEY": config.okx.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": config.okx.passphrase,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };
}

interface FacilitatorResult {
  httpOk: boolean;
  status: number;
  data: Record<string, any> | null;
  raw: any;
}

async function facilitatorPost(path: string, payload: unknown): Promise<FacilitatorResult> {
  const body = JSON.stringify(payload);
  const res = await fetch(config.okx.baseURL + path, {
    method: "POST",
    headers: okxHeaders("POST", path, body),
    body,
  });
  let raw: any = null;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }
  // OKX wraps as { code, msg, data }; data may be an object or a single-element array.
  const data = raw && "data" in raw ? (Array.isArray(raw.data) ? raw.data[0] ?? null : raw.data) : raw;
  return { httpOk: res.ok, status: res.status, data, raw };
}

/** Decode the X-Payment header into the buyer's x402 payment payload (base64 JSON, or raw JSON). */
function decodePaymentPayload(header: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    /* fall through */
  }
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

/**
 * Verify (and settle) a payment proof from the `X-Payment` header.
 *
 * DEV MODE: any request whose X-Payment equals PAYMENT_DEV_TOKEN passes — lets the agent
 * run locally and in the demo without real settlement.
 *
 * LIVE MODE: decode the buyer's signed x402 payload, then call the OKX facilitator
 * verify → settle with OUR server-defined requirements (so amount/payTo can't be undercut).
 * Fail closed: any network error, non-2xx, isValid≠true, or settle success≠true rejects.
 */
export async function verifyPayment(
  paymentHeader: string | undefined,
  resource = "/reverse-engineer",
): Promise<PaymentCheck> {
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

  // ── LIVE settlement via the OKX x402 facilitator ────────────────────────────
  const live = paymentLiveConfigured();
  if (!live.ok) {
    return { ok: false, reason: `live payment not configured: missing ${live.missing.join(", ")}`, mode: "live" };
  }
  if (!paymentHeader) {
    return { ok: false, reason: "no X-Payment header", mode: "live" };
  }

  const paymentPayload = decodePaymentPayload(paymentHeader);
  if (!paymentPayload) {
    return { ok: false, reason: "malformed X-Payment header (expected base64/JSON x402 payload)", mode: "live" };
  }

  const requestBody = {
    x402Version: X402_VERSION,
    paymentPayload,
    paymentRequirements: x402Requirements(resource),
  };

  try {
    // 1) verify — is the signed authorization valid for our requirements?
    const verify = await facilitatorPost("/api/v6/pay/x402/verify", requestBody);
    if (!verify.httpOk || !verify.data || verify.data.isValid !== true) {
      const why =
        verify.data?.invalidReason || verify.data?.invalidMessage || verify.raw?.msg || `HTTP ${verify.status}`;
      return { ok: false, reason: `payment verify failed: ${why}`, mode: "live" };
    }

    // 2) settle — accept the authorization for batch on-chain settlement.
    const settle = await facilitatorPost("/api/v6/pay/x402/settle", requestBody);
    if (!settle.httpOk || !settle.data || settle.data.success !== true) {
      const why =
        settle.data?.errorReason || settle.data?.errorMessage || settle.raw?.msg || `HTTP ${settle.status}`;
      return { ok: false, reason: `payment settle failed: ${why}`, mode: "live" };
    }

    // settle success = accepted for settlement (batch may land on-chain shortly after);
    // per OKX docs this is the point at which the resource may be released.
    return {
      ok: true,
      reason: "verified + settled via OKX facilitator",
      mode: "live",
      payer: settle.data.payer || verify.data.payer,
    };
  } catch (err) {
    // Fail closed on any transport/parsing error — never release the resource unpaid.
    return { ok: false, reason: `facilitator error: ${(err as Error).message}`, mode: "live" };
  }
}
