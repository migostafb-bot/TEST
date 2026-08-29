// Extracts factual product data from a competitor product page.
// Facts only - names, brand, EAN, volume, ingredients, reference price.
// The marketing copy is written fresh in French, never lifted from the source.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è" };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

export function htmlToText(html) {
  if (!html) return "";
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// Walks arbitrary JSON-LD (objects, arrays, @graph) collecting Product nodes.
function collectProducts(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) collectProducts(item, found);
    return found;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /product/i.test(t))) found.push(node);
  for (const key of ["@graph", "mainEntity", "itemListElement", "hasVariant"]) {
    if (node[key]) collectProducts(node[key], found);
  }
  return found;
}

function parseJsonLd(html) {
  const products = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      collectProducts(JSON.parse(match[1].trim().replace(/^﻿/, "")), products);
    } catch {
      // Malformed block - skip it, other extractors still apply.
    }
  }
  return products;
}

function meta(html, ...keys) {
  for (const key of keys) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]+content=["']([^"']*)["']`,
      "i",
    );
    const direct = pattern.exec(html);
    if (direct?.[1]) return decodeEntities(direct[1]).trim();
    const reversed = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${key}["']`,
      "i",
    ).exec(html);
    if (reversed?.[1]) return decodeEntities(reversed[1]).trim();
  }
  return null;
}

function firstOffer(product) {
  const offers = product?.offers;
  if (!offers) return {};
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer || typeof offer !== "object") return {};
  return {
    price: offer.price ?? offer.lowPrice ?? offer.highPrice ?? null,
    currency: offer.priceCurrency ?? null,
    availability: typeof offer.availability === "string" ? offer.availability.split("/").pop() : null,
  };
}

function imageUrls(product, html, baseUrl) {
  const raw = [];
  const push = (value) => {
    if (!value) return;
    if (typeof value === "string") raw.push(value);
    else if (Array.isArray(value)) value.forEach(push);
    else if (typeof value === "object") push(value.url ?? value.contentUrl);
  };
  push(product?.image);
  push(meta(html, "og:image"));
  const seen = new Set();
  return raw
    .map((url) => {
      try {
        return new URL(url, baseUrl).href;
      } catch {
        return null;
      }
    })
    .filter((url) => url && !seen.has(url) && seen.add(url));
}

// Ingredient / composition blocks are factual and regulated, so they are
// captured separately to be carried across verbatim.
function findSection(text, labels) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const label of labels) {
    const heading = new RegExp(`^\\s*${label}\\s*:?\\s*$`, "i");
    const inline = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "is");
    for (let i = 0; i < blocks.length; i += 1) {
      const inlineMatch = inline.exec(blocks[i]);
      if (inlineMatch && inlineMatch[1].trim().length > 20) return inlineMatch[1].trim().slice(0, 2000);
      if (heading.test(blocks[i])) {
        const body = blocks.slice(i + 1, i + 3).join("\n\n").trim();
        if (body.length > 20) return body.slice(0, 2000);
      }
    }
  }
  return null;
}

// The full source description, kept intact so it can be translated faithfully.
function descriptionHtml(product, html) {
  const fromJsonLd = typeof product?.description === "string" ? product.description.trim() : "";
  if (fromJsonLd) return fromJsonLd;
  const container =
    /<div[^>]+(?:id|class)=["'][^"']*(?:product[-_ ]?description|description[-_ ]?content|rte)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
  if (container?.[1] && htmlToText(container[1]).length > 40) return container[1].trim();
  return meta(html, "og:description", "description") ?? "";
}

export function extractProduct(html, sourceUrl) {
  const products = parseJsonLd(html);
  const product = products[0] ?? {};
  const offer = firstOffer(product);
  const bodyText = htmlToText(html);

  const brandValue = product.brand;
  const brand =
    (typeof brandValue === "string" ? brandValue : brandValue?.name) ??
    meta(html, "og:brand", "product:brand") ??
    null;

  const title =
    product.name ??
    meta(html, "og:title") ??
    decodeEntities(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").trim() ??
    null;

  const descHtml = descriptionHtml(product, html);

  return {
    source_url: sourceUrl,
    // Factual attributes, safe to reuse.
    title: title || null,
    brand,
    ean: product.gtin13 ?? product.gtin ?? product.gtin12 ?? product.gtin8 ?? null,
    mpn: product.mpn ?? null,
    sku: product.sku ?? null,
    reference_price: offer.price ? String(offer.price) : null,
    reference_currency: offer.currency ?? null,
    availability: offer.availability ?? null,
    weight: product.weight?.value ? `${product.weight.value} ${product.weight.unitCode ?? ""}`.trim() : null,
    category: product.category ?? null,
    images: imageUrls(product, html, sourceUrl),
    ingredients: findSection(bodyText, ["ingredients", "composition", "ingr[ée]dients"]),
    usage: findSection(bodyText, ["how to use", "directions", "utilisation", "conseils d.utilisation", "application"]),
    // Full source copy, kept intact and untruncated so the French listing can
    // mirror it faithfully, including its heading and list structure.
    description_html: descHtml || null,
    description_text: htmlToText(descHtml) || null,
    extraction: {
      json_ld_found: products.length > 0,
      warnings: [
        !title && "No product title found - page may not be a product page.",
        products.length === 0 && "No JSON-LD Product data; fell back to meta tags, fields may be sparse.",
      ].filter(Boolean),
    },
  };
}

export async function fetchProduct(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}. Paste the full address, including https://`);
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error("Only http(s) URLs are supported.");

  const response = await fetch(target.href, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Fetch failed (${response.status} ${response.statusText}) for ${target.href}`);

  const html = await response.text();
  return extractProduct(html, response.url || target.href);
}
