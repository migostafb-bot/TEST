#!/usr/bin/env node
// Reports what the importer can and cannot see on a competitor page, so a
// half-translated result can be diagnosed instead of guessed at.
//
//   npm run inspect -- https://competitor.com/products/thing
import "../src/config.mjs";
import { contentSections } from "../src/sections.mjs";
import { extractTexts } from "../src/textnodes.mjs";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run inspect -- <competitor product url>");
  process.exit(1);
}

const response = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },
  redirect: "follow",
});
const html = await response.text();
console.log(`Page: ${(html.length / 1024) | 0} KB\n`);

const sections = contentSections(html);
console.log(`Content sections below the buy box: ${sections.length}\n`);

let total = 0;
for (const section of sections) {
  const { texts } = extractTexts(section.html);
  total += texts.length;
  const name = section.id.replace(/^shopify-section-template--\d+__/, "");
  const sample = texts.find((t) => t.split(/\s+/).length > 4) ?? texts[0] ?? "(no text)";
  console.log(`  ${name}`);
  console.log(`    ${texts.length} strings, ${(section.html.length / 1024) | 0} KB`);
  console.log(`    e.g. ${JSON.stringify(sample.slice(0, 70))}`);

  // Text held in scripts only reaches the translator if the JSON inside can be
  // parsed. Say plainly which scripts were read and which were not.
  const scripts = [...section.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const body of scripts) {
    if (body.trim().length < 500) continue;
    const { texts: fromScript } = extractTexts(`<script>${body}</script>`);
    if (fromScript.length) {
      console.log(`    script (${(body.length / 1024) | 0} KB): ${fromScript.length} strings READ`);
    } else {
      console.log(`    script (${(body.length / 1024) | 0} KB): NOT READ - text here stays English`);
      console.log(`      starts: ${JSON.stringify(body.trim().slice(0, 120))}`);
    }
  }
  console.log();
}

console.log(`Total strings the importer would translate: ${total}`);
console.log(`Roughly ${Math.round(total * 12)} tokens - one translation pass.\n`);

// Anything below the buy box that never made it into a section would be lost.
const kept = sections.map((s) => s.html).join("").length;
const buyBox = html.indexOf("shopify-section-template");
const below = buyBox === -1 ? 0 : html.length - buyBox;
if (below && kept / below < 0.4) {
  console.log(
    `NOTE: kept markup is ${Math.round((kept / below) * 100)}% of the page below the buy box - ` +
      `some content may sit outside Shopify sections and would not be imported.`,
  );
}
