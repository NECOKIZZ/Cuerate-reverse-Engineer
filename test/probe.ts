/**
 * probe.ts — diagnostic: run stage0 + ensemble, print each pass status, then call the
 * aggregator RAW and show length / finish_reason / tail so we can see WHY parsing fails.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { config } from "../src/config.js";
import { identify } from "../src/stage0/identify.js";
import { runEnsemble } from "../src/stage1/describers.js";
import { AGGREGATOR_SYSTEM_PROMPT } from "../src/stage1/prompts.js";
import { toMediaType } from "../src/util.js";

const dir = resolve(process.cwd(), "../okx ai test");
const idx = Number(process.env.IMG_IDX || 0);
const img = readdirSync(dir)
  .filter((f) => extname(f).toLowerCase() === ".png" && statSync(join(dir, f)).size > 0)[idx];
console.log("Probing:", img, "\n");

const buf = readFileSync(join(dir, img));

async function rawChat(model: string, system: string, userText: string, maxTokens: number) {
  const res = await fetch(`${config.openrouter.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openrouter.apiKey}`,
      "HTTP-Referer": "https://cuerate.ai",
      "X-Title": "Cuerate probe",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });
  const data: any = await res.json();
  return { status: res.status, data };
}

async function main() {
  const stage0 = await identify(buf);
  console.log("stage0:", stage0.width + "x" + stage0.height, "grid:", stage0.resolution_match.model_family, "\n");

  const base64 = buf.toString("base64");
  const envelopes = await runEnsemble({ base64, mediaType: toMediaType(stage0.metadata.format), buffer: buf });
  console.log("── ensemble passes ──");
  for (const e of envelopes) {
    console.log(`  ${e.ok ? "✅" : "❌"} ${e.source}${e.ok ? "" : "  → " + e.envelope.subject_action.slice(0, 120)}`);
  }
  console.log("");

  const reports = envelopes.map((e, i) => ({ report_index: i + 1, source: e.source, ok: e.ok, fields: e.envelope }));
  const userPayload = JSON.stringify({ N: envelopes.length, reports }, null, 2);

  const MAXTOK = Number(process.env.MAXTOK || 5000);
  console.log(`── aggregator raw (maxTokens=${MAXTOK}) ──`);
  const { status, data } = await rawChat(
    config.aggregatorModel,
    AGGREGATOR_SYSTEM_PROMPT,
    "Merge and return ONLY the JSON object.\n\n" + userPayload,
    MAXTOK,
  );
  console.log("http status:", status);
  if (data?.error) console.log("API error:", JSON.stringify(data.error).slice(0, 400));
  const choice = data?.choices?.[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  console.log("finish_reason:", choice?.finish_reason);
  console.log("content length (chars):", content.length);
  console.log("usage:", JSON.stringify(data?.usage));
  console.log("HEAD:", content.slice(0, 200).replace(/\n/g, "\\n"));
  console.log("TAIL:", content.slice(-200).replace(/\n/g, "\\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
