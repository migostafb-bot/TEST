// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractProduct, htmlToText } from "../src/scrape.mjs";

const html = readFileSync(new URL("./fixtures/competitor-product.html", import.meta.url), "utf8");
const product = extractProduct(html, "https://competitor.example.com/p/cicalfate");

test("pulls factual fields out of JSON-LD", () => {
  assert.equal(product.title, "Avene Cicalfate+ Restorative Protective Cream 40ml");
  assert.equal(product.brand, "Avene");
  assert.equal(product.ean, "3282770149647");
  assert.equal(product.sku, "AVE-CICA-40");
  assert.equal(product.reference_price, "12.50");
  assert.equal(product.reference_currency, "GBP");
  assert.equal(product.availability, "InStock");
});

test("resolves relative image URLs against the source page", () => {
  assert.ok(product.images.includes("https://cdn.example.com/cica-1.jpg"));
  assert.ok(product.images.includes("https://competitor.example.com/img/cica-2.jpg"));
});

test("captures regulated factual sections", () => {
  assert.match(product.ingredients, /Zinc Oxide/);
  assert.match(product.usage, /twice daily/);
});

test("keeps the full source copy intact for faithful translation", () => {
  assert.match(product.description_html, /award-winning repair cream/);
  assert.match(product.description_text, /award-winning repair cream/);
  assert.ok(!/<script/i.test(product.description_html));
});

test("htmlToText strips scripts and collapses whitespace", () => {
  assert.equal(htmlToText("<div>a<script>var x=1</script>  b</div>"), "a b");
});
