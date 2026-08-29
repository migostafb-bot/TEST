// Exercised against a page shaped like a real Shopify product page: chrome
// sections around a buy box, content sections after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSections,
  contentSections,
  selectorsUsed,
  pruneCss,
  scopeCss,
  visibilityOverrides,
  imageUrls,
} from "../src/sections.mjs";

const PAGE = `
<section id="shopify-section-sections--1__header"><nav class="site-nav">nav</nav></section>
<section id="shopify-section-template--1__main"><div class="product-form">
  <input class="quantity" value="1"><button class="add-to-cart">Add</button>
</div></section>
<section id="shopify-section-template--1__image_with_text_A">
  <div class="image-text-section scroll-trigger animate--fade-in">
    <img src="https://cdn.example.com/a.jpg" alt="a">
    <h2 class="image-text-heading">How it works</h2>
    <p class="subtitle">Apply once daily.</p>
  </div>
</section>
<section id="shopify-section-template--1__sticky_add_to_cart_B"><div class="sticky-cart">buy</div></section>
<section id="shopify-section-template--1__guarantee_C">
  <div class="guarantee-box"><h2>Money-Back Guarantee</h2></div>
</section>
<section id="shopify-section-sections--1__footer"><div class="footer">footer</div></section>
`;

test("splits the page into its Shopify sections", () => {
  assert.equal(splitSections(PAGE).length, 6);
});

test("keeps only content sections that follow the buy box", () => {
  const kept = contentSections(PAGE).map((s) => s.id);
  assert.deepEqual(kept, ["shopify-section-template--1__image_with_text_A", "shopify-section-template--1__guarantee_C"]);
});

test("drops the header, buy box, sticky cart and footer", () => {
  const kept = contentSections(PAGE).map((s) => s.id).join(" ");
  for (const unwanted of ["header", "__main", "sticky_add_to_cart", "footer"]) {
    assert.ok(!kept.includes(unwanted), `${unwanted} should not be kept`);
  }
});

test("collects the selectors the kept markup uses", () => {
  const used = selectorsUsed(contentSections(PAGE).map((s) => s.html).join("\n"));
  assert.ok(used.classes.has("image-text-heading"));
  assert.ok(used.classes.has("guarantee-box"));
  assert.ok(!used.classes.has("site-nav"), "chrome classes should not appear");
  assert.ok(used.tags.has("img"));
});

test("prunes stylesheet rules that the markup never uses", () => {
  const css = `
    .image-text-heading { font-size: 2rem; }
    .site-nav { color: red; }
    .guarantee-box { border: 1px solid; }
    .unrelated-widget { display: none; }
    @media (max-width: 600px) { .image-text-heading { font-size: 1.5rem; } .site-nav { color: blue; } }
  `;
  const pruned = pruneCss(css, selectorsUsed(contentSections(PAGE).map((s) => s.html).join("\n")));
  assert.match(pruned, /image-text-heading/);
  assert.match(pruned, /guarantee-box/);
  assert.ok(!pruned.includes("site-nav"));
  assert.ok(!pruned.includes("unrelated-widget"));
  assert.match(pruned, /@media/, "media queries with used selectors survive");
});

test("keeps only custom properties from global rules", () => {
  const pruned = pruneCss(":root { --brand: #0f0; }\nbody { opacity: 0; --gap: 2rem; }", selectorsUsed(PAGE));
  assert.match(pruned, /--brand/);
  assert.match(pruned, /--gap/);
  assert.ok(!pruned.includes("opacity"), "a global fade must not survive to hide the section");
});

test("scopes every selector under the wrapper", () => {
  const scoped = scopeCss(".a { color: red; }\n.b, .c { color: blue; }", ".pf");
  assert.match(scoped, /\.pf \.a \{/);
  assert.match(scoped, /\.pf \.b, \.pf \.c \{/);
});

test("never scopes at-rules that have no selectors", () => {
  const scoped = scopeCss("@keyframes spin { 0% { opacity: 0; } }\n.a { color: red; }", ".pf");
  assert.match(scoped, /@keyframes spin \{/);
  assert.ok(!/\.pf @keyframes/.test(scoped), "@keyframes must not be prefixed");
});

test("scopes inside media queries, not the query itself", () => {
  const scoped = scopeCss("@media (min-width: 700px) { .a { color: red; } }", ".pf");
  assert.match(scoped, /@media \(min-width: 700px\) \{/);
  assert.match(scoped, /\.pf \.a \{/);
});

test("produces balanced CSS", () => {
  const scoped = scopeCss(pruneCss("@media screen { .image-text-heading { color: red; } }", selectorsUsed(PAGE)), ".pf");
  let depth = 0;
  for (const character of scoped) {
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
  }
  assert.equal(depth, 0);
});

test("overrides scroll-reveal styles so imported sections are visible", () => {
  const overrides = visibilityOverrides(".pf");
  assert.match(overrides, /\.pf \.scroll-trigger/);
  assert.match(overrides, /opacity: 1 !important/);
});

test("finds the images the sections reference", () => {
  const urls = imageUrls(contentSections(PAGE).map((s) => s.html).join("\n"));
  assert.deepEqual(urls, ["https://cdn.example.com/a.jpg"]);
});
