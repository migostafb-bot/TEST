// Verifies that a Shopify storefront's full product record is preferred over
// the truncated meta-tag summary.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchProduct } from "../src/scrape.mjs";

const LONG_BODY = `<h2>What it is</h2><p>${"A".repeat(400)}</p>
<h2>Benefits</h2><ul><li>First benefit</li><li>Second benefit</li></ul>
<h2>How to use</h2><p>Take two capsules daily.</p>
<h2>Ingredients</h2><p>Tart Cherry Extract, Vegetable Cellulose.</p>`;

const HTML = `<!doctype html><html><head>
<meta property="og:description" content="Short truncated summary.">
<script type="application/ld+json">
{"@type":"Product","name":"Tart Cherry Extract","description":"Short truncated summary.",
 "offers":{"price":"49.99","priceCurrency":"USD"}}
</script></head><body><h1>Tart Cherry Extract</h1></body></html>`;

const PRODUCT_JSON = {
  product: {
    title: "Tart Cherry Extract 1500mg",
    vendor: "GoodGrove",
    product_type: "Supplements",
    tags: "supplements, joint",
    body_html: LONG_BODY,
    images: [{ src: "https://cdn.example.com/a.jpg" }, { src: "/img/b.jpg" }],
    variants: [{ title: "60 capsules", sku: "GG-TC-60", barcode: "0123456789012", price: "49.99", option1: "60" }],
  },
};

let server;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/products/tart-cherry.json") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(PRODUCT_JSON));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end(HTML);
    }
  });
  await new Promise((r) => server.listen(8801, r));
});
after(() => server.close());

test("prefers the full body_html over the meta summary", async () => {
  const product = await fetchProduct("http://localhost:8801/products/tart-cherry");
  assert.equal(product.extraction.shopify_json, true);
  assert.match(product.description_html, /Benefits/);
  assert.match(product.description_html, /How to use/);
  assert.match(product.description_html, /Ingredients/);
  assert.ok(product.description_html.length > 400, "full description should not be truncated");
  assert.ok(!/Short truncated summary/.test(product.description_html));
});

test("takes the richer product fields from the Shopify record", async () => {
  const product = await fetchProduct("http://localhost:8801/products/tart-cherry");
  assert.equal(product.title, "Tart Cherry Extract 1500mg");
  assert.equal(product.brand, "GoodGrove");
  assert.equal(product.category, "Supplements");
  assert.equal(product.sku, "GG-TC-60");
  assert.equal(product.ean, "0123456789012");
  assert.deepEqual(product.source_tags, ["supplements", "joint"]);
  assert.equal(product.variants.length, 1);
});

test("collects every image, resolving relative paths", async () => {
  const product = await fetchProduct("http://localhost:8801/products/tart-cherry");
  assert.ok(product.images.includes("https://cdn.example.com/a.jpg"));
  assert.ok(product.images.includes("http://localhost:8801/img/b.jpg"));
});

test("falls back to page extraction when there is no Shopify record", async () => {
  const product = await fetchProduct("http://localhost:8801/pages/not-a-product");
  assert.equal(product.extraction.shopify_json, undefined);
  assert.equal(product.title, "Tart Cherry Extract");
});
