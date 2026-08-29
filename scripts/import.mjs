#!/usr/bin/env node
// Hands competitor URLs to Claude Code one at a time and lets it run the
// listing workflow from CLAUDE.md. Uses the local Claude Code subscription,
// so there is no API key and no per-product cost.
//
//   npm run import -- https://competitor.com/product/a
//   npm run import -- https://a.com/p1 https://b.com/p2
//   npm run import -- --file urls.txt
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = resolve(ROOT, "import-log.txt");

// Only the three import tools are allowed, so an automated run cannot touch
// orders, customers, or anything else in the store.
const ALLOWED = [
  "mcp__shopify__fetch_competitor_product",
  "mcp__shopify__check_duplicate",
  "mcp__shopify__create_product",
];

// --restricted drops the shell and file tools, but only exists in newer Claude
// Code releases. The allow-list below is what actually constrains the run, so
// on older versions we simply leave the flag out.
const SUPPORTS_RESTRICTED = (() => {
  try {
    return execFileSync("claude", ["--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes(
      "--restricted",
    );
  } catch {
    return false;
  }
})();

function parseArgs(argv) {
  const urls = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") {
      const file = argv[i + 1];
      i += 1;
      if (!file || !existsSync(file)) throw new Error(`No such file: ${file}`);
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) urls.push(trimmed);
      }
    } else if (argv[i].startsWith("http")) {
      urls.push(argv[i]);
    } else {
      throw new Error(`Unrecognised argument: ${argv[i]}`);
    }
  }
  return urls;
}

function prompt(url) {
  return [
    `Import this competitor product into the store: ${url}`,
    "",
    "Follow the listing workflow in CLAUDE.md exactly:",
    "1. fetch_competitor_product for the URL.",
    "2. check_duplicate with the EAN (barcode) and the source title. If it is already",
    "   listed, stop and report that - do not create a second listing.",
    "3. Translate the listing into French, faithfully, per the translation rules.",
    "4. create_product with the French fields. Leave the price unset - the owner sets it.",
    "",
    "Then reply with exactly one line, no other prose:",
    "  CREATED <admin url> | <french title>",
    "  or SKIPPED <reason>",
    "  or FAILED <reason>",
    "If any health claim needs review, add a second line starting with CLAIMS.",
  ].join("\n");
}

function runClaude(url) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "claude",
      [
        "-p",
        prompt(url),
        "--allowedTools",
        ALLOWED.join(","),
        "--permission-mode",
        "acceptEdits",
        ...(SUPPORTS_RESTRICTED ? ["--restricted"] : []),
        "--output-format",
        "json",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) =>
      resolvePromise({ ok: false, text: `Could not run claude: ${error.message}` }));

    child.on("close", (code) => {
      if (code !== 0) {
        return resolvePromise({ ok: false, text: stderr.trim() || `claude exited with code ${code}` });
      }
      try {
        const parsed = JSON.parse(stdout);
        const text = (parsed.result ?? "").trim();
        resolvePromise({ ok: !parsed.is_error && Boolean(text), text: text || "No output from Claude." });
      } catch {
        resolvePromise({ ok: false, text: `Could not read Claude's output: ${stdout.slice(0, 300)}` });
      }
    });
  });
}

const urls = parseArgs(process.argv.slice(2));
if (!urls.length) {
  console.error("Usage: npm run import -- <url> [url...]   |   npm run import -- --file urls.txt");
  process.exit(1);
}

console.log(`Importing ${urls.length} product${urls.length === 1 ? "" : "s"}.\n`);
let created = 0;
let skipped = 0;
let failed = 0;

for (const [index, url] of urls.entries()) {
  process.stdout.write(`[${index + 1}/${urls.length}] ${url}\n`);
  const started = Date.now();
  const { ok, text } = await runClaude(url);
  const seconds = Math.round((Date.now() - started) / 1000);

  for (const line of text.split("\n")) console.log(`    ${line}`);
  console.log(`    (${seconds}s)\n`);

  if (!ok || text.startsWith("FAILED")) failed += 1;
  else if (text.startsWith("SKIPPED")) skipped += 1;
  else created += 1;

  appendFileSync(LOG, `${new Date().toISOString()}\t${url}\t${text.replace(/\n/g, " ")}\n`);
}

console.log(`Done. ${created} created, ${skipped} skipped, ${failed} failed.`);
console.log(`Log: ${LOG}`);
console.log("Everything lands as a draft - review and publish in Shopify admin.");
