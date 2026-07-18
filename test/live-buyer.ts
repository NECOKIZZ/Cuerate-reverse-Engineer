/**
 * live-buyer.ts — REAL end-to-end x402 buyer test against the deployed endpoint.
 *
 * Unlike demo/buyer-agent.ts (dev-token bypass), this signs a real EIP-3009 "exact"
 * payment with a funded buyer wallet and measures true wall-clock latency of the
 * paid call — exactly what the marketplace review bot experiences:
 *
 *   402 challenge → sign PAYMENT-SIGNATURE → verify → pipeline → settle → 200 + receipt
 *
 * Usage:
 *   # one-time: generate a buyer wallet (prints address to fund, writes .buyer-wallet.json)
 *   npx tsx test/live-buyer.ts --generate
 *
 *   # check the wallet's USDT0/OKB balance on X Layer
 *   npx tsx test/live-buyer.ts --balance
 *
 *   # run the paid call (defaults: deployed URL + bundled sample image)
 *   npx tsx test/live-buyer.ts [image_url]
 *
 * The wallet file (.buyer-wallet.json) is git-ignored — NEVER commit it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";

const WALLET_FILE = new URL("../.buyer-wallet.json", import.meta.url).pathname;
const BASE = process.env.RE_BASE_URL || "https://cuerate-reverse-engineer-production.up.railway.app";
const RPC = process.env.PAYMENT_RPC_URL || "https://rpc.xlayer.tech";
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const DEFAULT_IMAGE =
  process.argv[2] && /^https?:/i.test(process.argv[2])
    ? process.argv[2]
    : "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1024px-Fronalpstock_big.jpg";

function loadWallet(): { address: string; privateKey: `0x${string}` } {
  if (!existsSync(WALLET_FILE)) {
    console.error("No .buyer-wallet.json — run with --generate first.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(WALLET_FILE, "utf8"));
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as any;
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function balances(address: string) {
  const okbHex = await rpc("eth_getBalance", [address, "latest"]);
  // balanceOf(address) selector 0x70a08231
  const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const usdtHex = await rpc("eth_call", [{ to: USDT0, data }, "latest"]);
  return {
    okb: Number(BigInt(okbHex)) / 1e18,
    usdt0: Number(BigInt(usdtHex === "0x" ? "0x0" : usdtHex)) / 1e6,
  };
}

async function main() {
  const mode = process.argv[2];

  if (mode === "--generate") {
    if (existsSync(WALLET_FILE)) {
      const w = loadWallet();
      console.log(`Wallet already exists: ${w.address}`);
      return;
    }
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    writeFileSync(
      WALLET_FILE,
      JSON.stringify({ address: account.address, privateKey }, null, 2),
      { mode: 0o600 },
    );
    console.log(`Buyer wallet generated: ${account.address}`);
    console.log(`Fund it with ~0.5 USDT0 on X Layer (eip155:196), token ${USDT0}.`);
    console.log(`Key saved to ${WALLET_FILE} (git-ignored, chmod 600). Do not commit.`);
    return;
  }

  const wallet = loadWallet();

  if (mode === "--balance") {
    const b = await balances(wallet.address);
    console.log(`${wallet.address}\n  USDT0: ${b.usdt0}\n  OKB:   ${b.okb}`);
    return;
  }

  // ── The real paid call ──────────────────────────────────────────────────────
  const account = privateKeyToAccount(wallet.privateKey);
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: account,
    // exact = EIP-3009 transferWithAuthorization: gasless for the buyer (facilitator
    // submits), so the wallet only needs USDT0, no OKB.
    schemeOptions: { rpcUrl: RPC },
  });
  const http = new x402HTTPClient(client);

  const body = JSON.stringify({ image_url: DEFAULT_IMAGE });
  console.log(`endpoint : ${BASE}/reverse-engineer`);
  console.log(`buyer    : ${wallet.address}`);
  console.log(`image    : ${DEFAULT_IMAGE.slice(0, 80)}`);

  const t0 = Date.now();
  const unpaid = await fetch(`${BASE}/reverse-engineer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const tChallenge = Date.now();
  console.log(`\n[1] challenge : HTTP ${unpaid.status} in ${tChallenge - t0}ms`);
  if (unpaid.status !== 402) {
    console.error(`expected 402, got ${unpaid.status}: ${(await unpaid.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const paymentRequired = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n));
  const accepts = (paymentRequired as any).accepts ?? [];
  console.log(
    `    accepts : ${accepts.map((a: any) => `${a.scheme}@${a.network} ${a.amount ?? a.maxAmountRequired}`).join(" | ")}`,
  );

  const payload = await http.createPaymentPayload(paymentRequired);
  const headers = http.encodePaymentSignatureHeader(payload);
  const tSigned = Date.now();
  console.log(`[2] signed    : payment payload in ${tSigned - tChallenge}ms`);

  const paid = await fetch(`${BASE}/reverse-engineer`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  const tDone = Date.now();
  const paidBody = await paid.text();
  const settleHeader = paid.headers.get("payment-response");

  console.log(`[3] paid call : HTTP ${paid.status} in ${((tDone - tSigned) / 1000).toFixed(1)}s`);
  console.log(`    PAYMENT-RESPONSE: ${settleHeader ? "present" : "MISSING"}`);
  if (settleHeader) {
    try {
      const receipt = JSON.parse(Buffer.from(settleHeader, "base64").toString("utf8"));
      console.log(
        `    settle  : success=${receipt.success} status=${receipt.status ?? "-"} tx=${(receipt.transaction ?? "").slice(0, 20)}…`,
      );
    } catch {
      console.log(`    settle  : (unparseable header) ${settleHeader.slice(0, 60)}`);
    }
  }

  console.log(`\nTOTAL end-to-end: ${((tDone - t0) / 1000).toFixed(1)}s (marketplace window target: <30s)`);

  if (paid.status === 200) {
    const json = JSON.parse(paidBody);
    const prompt = json.reconstructed_prompt ?? json.stage1?.reconstructed_prompt;
    console.log(`\nreconstructed_prompt (first 200 chars):\n  ${String(prompt ?? "").slice(0, 200)}`);
    console.log(`\n✅ LIVE TEST PASSED${tDone - t0 < 30_000 ? " inside the 30s window" : " — but OVER 30s, keep cutting latency"}`);
  } else {
    console.error(`\n❌ paid call failed:\n${paidBody.slice(0, 500)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
