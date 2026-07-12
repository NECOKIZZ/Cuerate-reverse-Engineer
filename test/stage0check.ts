import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { identify } from "../src/stage0/identify.js";

const dir = resolve(process.cwd(), "../okx ai test");
const imgs = readdirSync(dir).filter((f) => extname(f).toLowerCase() === ".png" && statSync(join(dir, f)).size > 0);
for (const f of imgs) {
  const s = await identify(readFileSync(join(dir, f)));
  console.log(
    `${s.width}x${s.height}  matched=${s.resolution_match.matched}  family=${s.resolution_match.model_family}  aspect=${s.aspect_ratio}  conf=${s.resolution_match.confidence}  provenance=${s.provenance_signal.label}`,
  );
}
