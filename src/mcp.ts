/**
 * mcp.ts — the A2MCP surface OKX.AI lists.
 *
 * Exposes the agent as an MCP tool `reverse_engineer_image` over stdio. Any MCP-capable
 * agent (or the OKX A2MCP router) can discover and call it. Payment is enforced at the
 * marketplace/A2MCP layer for the hosted listing; when run standalone it executes directly
 * so you can test the tool locally.
 *
 * Run: `npm run mcp`  (speaks MCP over stdio)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { assertConfigured, VERSION } from "./config.js";
import { reverseEngineer } from "./pipeline.js";
import { identify } from "./stage0/identify.js";
import { fetchImageBuffer } from "./util.js";

function bufFromInput(input: { image_url?: string; image_base64?: string }): Promise<Buffer> {
  if (input.image_base64) {
    const cleaned = input.image_base64.replace(/^data:[^;]+;base64,/, "");
    return Promise.resolve(Buffer.from(cleaned, "base64"));
  }
  if (input.image_url) return fetchImageBuffer(input.image_url);
  return Promise.reject(new Error("provide image_url or image_base64"));
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "cuerate-image-reverse-engineer",
    version: VERSION,
  });

  server.registerTool(
    "reverse_engineer_image",
    {
      title: "Reverse-engineer an image into a prompt",
      description:
        "Given an AI-generated image (image_url or image_base64), return the structured prompt " +
        "that would plausibly reproduce it: subject, composition, camera, lighting, style, text, " +
        "aspect ratio, artifacts, provenance — each with a confidence score — plus a single " +
        "flattened reconstructed_prompt and an overall trust score. Reconstruction is lossy.",
      inputSchema: {
        image_url: z.string().url().optional().describe("HTTPS URL of the image to decode"),
        image_base64: z.string().optional().describe("Base64 image data (with or without data: prefix)"),
      },
    },
    async (input) => {
      const buf = await bufFromInput(input);
      const result = await reverseEngineer(buf);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "identify_image",
    {
      title: "Free deterministic image identify (Stage 0)",
      description:
        "Instant, free, no-model Stage 0: pixel dimensions, resolution-grid model-family match, " +
        "EXIF/C2PA metadata, and a provenance heuristic. Use before paying for a full reverse-engineer.",
      inputSchema: {
        image_url: z.string().url().optional(),
        image_base64: z.string().optional(),
      },
    },
    async (input) => {
      const buf = await bufFromInput(input);
      const result = await identify(buf);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] ? import.meta.url.endsWith(process.argv[1].split("/").pop()!) : false);

if (invokedDirectly) {
  assertConfigured();
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    // MCP speaks on stdout; log to stderr so we don't corrupt the protocol stream.
    process.stderr.write(`[cuerate-re-agent] MCP server ready (v${VERSION}) — tools: reverse_engineer_image, identify_image\n`);
  });
}
