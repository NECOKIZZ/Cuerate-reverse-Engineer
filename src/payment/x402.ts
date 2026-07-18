/**
 * x402.ts — the machine-payable gate, built on the official OKX Payment SDK
 * (@okxweb3/x402-fastify + @okxweb3/x402-core + @okxweb3/x402-evm).
 *
 * The whole wedge of this agent is that ANOTHER AGENT can pay per call with no
 * account and no human. That convention is HTTP 402 (x402 v2):
 *
 *   1. Agent calls the paid endpoint with no payment.
 *   2. SDK middleware replies 402 + a `PAYMENT-REQUIRED` header: base64 JSON of
 *      {x402Version: 2, resource: {url, description, mimeType}, accepts: [...]}.
 *   3. Agent signs an EIP-3009 authorization for the advertised requirement and
 *      retries with the payload in the `PAYMENT-SIGNATURE` header.
 *   4. Middleware verifies via the OKX facilitator (/api/v6/pay/x402/verify), runs
 *      our handler, settles after a 2xx (/settle), and attaches a `PAYMENT-RESPONSE`
 *      receipt header. Non-2xx responses are never charged.
 *
 * This file wires the SDK to our config:
 *   - scheme  : "exact"      (one-shot pay-per-call — the A2MCP standard)
 *   - network : "eip155:196" (CAIP-2 for X Layer mainnet)
 *   - asset   : USD₮0 on X Layer (OKX's official settlement stablecoin)
 *
 * DEV MODE (PAYMENT_DEV_MODE=true): an onProtectedRequest hook grants access when
 * X-Payment equals PAYMENT_DEV_TOKEN, so the whole system runs locally end-to-end
 * with no onchain money. Unpaid requests still get the real v2 402 challenge.
 *
 * Docs: https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp
 *       https://web3.okx.com/onchainos/dev-docs/payments/sdk-nodejs
 */
import type { FastifyInstance } from "fastify";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@okxweb3/x402-fastify";
import type { FacilitatorClient, RoutesConfig } from "@okxweb3/x402-core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@okxweb3/x402-core/types";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { AggrDeferredEvmScheme } from "@okxweb3/x402-evm/deferred/server";
import type { Network } from "@okxweb3/x402-core/types";
import { config, paymentLiveConfigured } from "../config.js";

/**
 * The payment schemes we sell under. BOTH are required in practice:
 *   - "exact"         : one-shot EIP-3009 transfer — plain EOA wallets.
 *   - "aggr_deferred" : session-cert deferred settlement — OKX agentic (AA)
 *     wallets, which is what the OKX marketplace review bot and OKX.AI user
 *     agents pay with. Advertising only "exact" means the platform tester
 *     receives a challenge it cannot satisfy → verify never succeeds → the
 *     review task times out ("unable to receive a response", 3rd rejection).
 */
const SCHEME = "exact";
const SCHEME_AGGR = "aggr_deferred";
const SCHEMES = [SCHEME, SCHEME_AGGR] as const;

/** config.payment.network as the SDK's CAIP-2 Network type (normalized in config.ts). */
const NETWORK = config.payment.network as Network;

export const PAID_PATH = "/reverse-engineer";

const DESCRIPTION =
  "Cuerate Lens — one full Prompt Reverse-Engineer call " +
  "(image → structured prompt + per-field confidence + trust score).";

/**
 * Convert a human decimal amount (0.35) to atomic token units ("350000") without float
 * error. Pure string/BigInt math so 0.35 @ 6dp is exact.
 */
export function toAtomic(amount: number, decimals: number): string {
  const [intPart, fracRaw = ""] = amount.toString().split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const digits = (intPart + frac).replace(/^0+(?=\d)/, "");
  return BigInt(digits === "" ? "0" : digits).toString();
}

/** Full public URL of the paid resource — v2 requires an absolute URL, not a path. */
export function resourceUrl(): string {
  return `${config.publicBaseUrl}${PAID_PATH}`;
}

/**
 * The v2 402 challenge as plain JSON. The SDK middleware base64s exactly this
 * object into the PAYMENT-REQUIRED header (verified live: header == body), so
 * this IS the shape the marketplace validator sees. Mirror the shape of a
 * KNOWN-APPROVED listing (Vouch #4984) exactly: each accepts entry carries
 * `decimals` AND its own `resource` object, and there is no extra `error` key.
 * The 07-18 rejection ("not passed x402 standard validation") hit after the
 * SDK migration dropped `decimals` — the pre-SDK gate had it (commit 2d0bbfc).
 */
export function buildChallenge(): Record<string, unknown> {
  const resource = {
    url: resourceUrl(),
    description: DESCRIPTION,
    mimeType: "application/json",
  };
  return {
    x402Version: 2,
    resource,
    accepts: SCHEMES.map((scheme) => ({
      scheme,
      network: config.payment.network,
      amount: toAtomic(config.payment.priceUsd, config.payment.assetDecimals),
      decimals: config.payment.assetDecimals,
      asset: config.payment.assetAddress,
      payTo: config.payment.payTo,
      maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
      resource,
      extra: { name: config.payment.asset, version: "1" },
    })),
  };
}

// ── Facilitator client ────────────────────────────────────────────────────────

/** The supported-kinds we sell under — used as fallback + guaranteed registration. */
function staticSupported(): SupportedResponse {
  return {
    kinds: SCHEMES.map((scheme) => ({ x402Version: 2, scheme, network: NETWORK })),
    extensions: [],
    signers: {},
  };
}

/**
 * Wraps the real OKX facilitator so the 402 challenge NEVER depends on facilitator
 * availability:
 *   - getSupported(): tries the real endpoint, falls back to (and always merges in)
 *     our static exact/X-Layer kind — so route validation and the 402 path stay up
 *     even if /supported hiccups. verify/settle still hit the real facilitator.
 *   - In dev mode (no OKX API keys) there is no inner client: getSupported() is
 *     static and verify/settle fail closed (dev access is granted by the dev-token
 *     hook BEFORE payment processing, so these are never reached in the happy path).
 */
class ResilientFacilitator implements FacilitatorClient {
  constructor(private inner: OKXFacilitatorClient | null) {}

  async getSupported(): Promise<SupportedResponse> {
    const fallback = staticSupported();
    if (!this.inner) return fallback;
    try {
      const real = await this.inner.getSupported();
      for (const ours of fallback.kinds) {
        const present = real.kinds?.some(
          (k) =>
            k.x402Version === 2 && k.scheme === ours.scheme && k.network === ours.network,
        );
        if (!present) real.kinds = [...(real.kinds ?? []), ours];
      }
      return real;
    } catch (err) {
      console.warn(
        `[x402] facilitator getSupported failed (${(err as Error).message}) — using static kinds`,
      );
      return fallback;
    }
  }

  async verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> {
    if (!this.inner) {
      return {
        isValid: false,
        invalidReason: "dev_mode",
        invalidMessage: "PAYMENT_DEV_MODE=true — real settlement is disabled; use the dev token",
      };
    }
    try {
      const out = await this.inner.verify(p, r);
      if (!out.isValid) {
        lastVerifyFailure = `verify rejected: ${out.invalidReason ?? "?"} — ${out.invalidMessage ?? ""}`;
        console.warn(`[x402] ${lastVerifyFailure}`);
      } else {
        lastVerifyFailure = null;
      }
      return out;
    } catch (err) {
      lastVerifyFailure = `verify threw: ${(err as Error).message}`;
      console.warn(`[x402] ${lastVerifyFailure}`);
      throw err;
    }
  }

  async settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> {
    if (!this.inner) {
      return {
        success: false,
        errorReason: "dev_mode",
        errorMessage: "PAYMENT_DEV_MODE=true — real settlement is disabled",
        transaction: "",
        network: r.network,
      };
    }
    return this.inner.settle(p, r);
  }

  async getSettleStatus(txHash: string) {
    if (!this.inner) throw new Error("dev mode: no facilitator");
    return this.inner.getSettleStatus(txHash);
  }
}

/**
 * DIAGNOSTIC (temporary): last verify failure reason, surfaced on 402 responses to
 * requests that DID attach a payment. Both `exact` (EOA) and `aggr_deferred` (OKX
 * agentic wallet, via OKX's own CLI) live payments currently bounce with a bare
 * re-challenge, and the onSend rewrite below hides the SDK's error body — so
 * without this the facilitator's actual rejection reason is unobservable from
 * outside Railway. Module-level is fine for a diagnostic (worst case a concurrent
 * request reads a neighbour's reason). Remove once the live path settles.
 */
let lastVerifyFailure: string | null = null;

function makeFacilitator(): ResilientFacilitator {
  if (config.payment.devMode) return new ResilientFacilitator(null);
  const live = paymentLiveConfigured();
  if (!live.ok) {
    // assertConfigured() refuses to boot in this state; belt-and-braces here.
    throw new Error(`live payment misconfigured: missing ${live.missing.join(", ")}`);
  }
  return new ResilientFacilitator(
    new OKXFacilitatorClient({
      apiKey: config.okx.apiKey,
      secretKey: config.okx.apiSecret,
      passphrase: config.okx.passphrase,
      baseUrl: config.okx.baseURL,
    }),
  );
}

// ── The gate ──────────────────────────────────────────────────────────────────

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer event topic. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Confirm a settle tx directly on X Layer via public JSON-RPC. Used only by the
 * settlement-timeout recovery hook. "Confirmed" means: the receipt exists, the tx
 * succeeded (status 0x1), and its logs contain an ERC-20 Transfer on our settlement
 * asset contract paying OUR payTo address — not merely "some tx with this hash
 * exists". Read-only; fails closed (false) on any RPC error.
 */
export async function txSucceededOnChain(txHash: string): Promise<boolean> {
  try {
    const res = await fetch(config.payment.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const { result } = (await res.json()) as {
      result?: {
        status?: string;
        logs?: { address?: string; topics?: string[] }[];
      } | null;
    };
    if (!result || result.status !== "0x1") return false;
    const asset = config.payment.assetAddress.toLowerCase();
    const payToTopic =
      "0x" + config.payment.payTo.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    return (result.logs ?? []).some(
      (log) =>
        log.address?.toLowerCase() === asset &&
        log.topics?.[0] === TRANSFER_TOPIC &&
        log.topics?.[2]?.toLowerCase() === payToTopic,
    );
  } catch (err) {
    console.warn(`[x402] on-chain settle confirmation failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Register the x402 payment gate on the Fastify app. Every method on PAID_PATH is
 * protected: unpaid requests (including the OKX x402-check GET probe) receive the
 * standard 402 + PAYMENT-REQUIRED header; paid requests are verified before our
 * handler runs and settled after it succeeds. Must be called before app.listen().
 */
export function registerX402Gate(app: FastifyInstance): void {
  const server = new x402ResourceServer(makeFacilitator())
    .register(NETWORK, new ExactEvmScheme())
    .register(NETWORK, new AggrDeferredEvmScheme());

  const routes: RoutesConfig = {
    // No verb prefix = every method (GET/HEAD probes must see the 402 challenge too).
    [PAID_PATH]: {
      // One PaymentOption per scheme: exact (EOA) + aggr_deferred (OKX agentic/AA
      // wallets — the scheme the marketplace review bot pays with).
      accepts: SCHEMES.map((scheme) => ({
        scheme,
        network: NETWORK,
        payTo: config.payment.payTo,
        // AssetAmount form: exact atomic units of the exact contract we list on-chain —
        // never derived from a token-list lookup, so challenge and listing can't drift.
        price: {
          amount: toAtomic(config.payment.priceUsd, config.payment.assetDecimals),
          asset: config.payment.assetAddress,
        },
        maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
        // EIP-712 domain of the asset — buyers sign against this; it must match the
        // token contract's own domain (USD₮0 / "1" for USDT0 on X Layer).
        extra: { name: config.payment.asset, version: "1" },
      })),
      resource: resourceUrl(),
      description: DESCRIPTION,
      mimeType: "application/json",
      // Mirror the challenge in the body (the header is what's validated; the body
      // is a courtesy for humans + validators that read x402Version from the body).
      unpaidResponseBody: async () => ({
        contentType: "application/json",
        body: buildChallenge(),
      }),
    },
  };

  const httpServer = new x402HTTPResourceServer(server, routes);

  // DEV MODE bypass: the shared token stands in for settlement so the whole system
  // runs locally end-to-end with no onchain money. Runs BEFORE payment processing.
  httpServer.onProtectedRequest(async (ctx) => {
    if (!config.payment.devMode) return;
    const token = ctx.adapter.getHeader("x-payment");
    if (token && token === config.payment.devToken) return { grantAccess: true };
  });

  // Settlement-timeout recovery (the Keryx battle scar): the OKX facilitator often
  // reports status:"timeout" on slow settle confirmation even though the USDT0
  // transfer already landed on-chain. Without recovery the SDK turns that into a
  // 402 AFTER the buyer paid — which the marketplace reads as a failed service.
  // Recovery order inside the SDK's processSettlement:
  //   1. pollSettleStatus() against the facilitator for up to pollDeadlineMs;
  //   2. this hook — confirm the tx receipt directly on X Layer RPC;
  //   3. only if BOTH fail does the caller get a 402.
  httpServer.setPollDeadline(10_000);
  httpServer.onSettlementTimeout(async (txHash: string) => ({
    confirmed: await txSucceededOnChain(txHash),
  }));

  paymentMiddlewareFromHTTPServer(app, httpServer);

  // The SDK builds its own PAYMENT-REQUIRED header and it omits `decimals` and the
  // per-entry `resource` object — fields every approved listing (e.g. Vouch #4984)
  // carries and the marketplace validator checks. Rewrite the header (and body) of
  // every 402 on the paid path with our canonical challenge so header == body ==
  // the approved shape, regardless of SDK internals.
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode !== 402 || !req.url.startsWith(PAID_PATH)) return payload;
    // DIAGNOSTIC (temporary): when the caller attached a payment and still got a 402,
    // expose why on a side-channel header. The canonical challenge header/body below
    // stay byte-identical, so the marketplace validator sees the exact approved shape.
    const attemptedPayment =
      req.headers["payment-signature"] ?? req.headers["x-payment"] ?? null;
    if (attemptedPayment && lastVerifyFailure) {
      reply.header("x-verify-failure", lastVerifyFailure.slice(0, 900));
    }
    const challenge = JSON.stringify(buildChallenge());
    reply.header("PAYMENT-REQUIRED", Buffer.from(challenge).toString("base64"));
    reply.header("content-type", "application/json; charset=utf-8");
    return challenge;
  });
}
