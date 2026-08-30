// Copies a competitor's product page sections onto a product in this store.
// Split in two so the translation happens in between: `readPage` returns the
// strings to translate, `installPage` puts the translated page into the theme.
import {
  contentSections,
  selectorsUsed,
  pruneCss,
  scopeCss,
  visibilityOverrides,
  imageUrls,
  rewriteCtas,
  ctaScript,
} from "./sections.mjs";
import { extractTexts, applyTexts } from "./textnodes.mjs";
import { findTheme, readThemeFile, writeThemeFiles, setProductTemplate, buildSectionLiquid, buildProductTemplate } from "./theme.mjs";
import { adminGraphQL } from "./shopify.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Static Liquid: it reads the product's own variants at render time, so the
// same file serves every import and never needs translating.
const BUY_BOX = readFileSync(resolve(HERE, "buybox.liquid"), "utf8");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_STYLESHEETS = 12;

async function get(url, accept) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${url}`);
  return response.text();
}

// The theme's CSS lives in linked stylesheets plus inline <style> blocks.
async function collectCss(html, baseUrl) {
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);

  const hrefs = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((tag) => /rel=["'][^"']*stylesheet/i.test(tag[0]))
    .map((tag) => /href=["']([^"']+)["']/i.exec(tag[0])?.[1])
    .filter(Boolean)
    .slice(0, MAX_STYLESHEETS)
    .map((href) => new URL(href, baseUrl).href);

  const linked = await Promise.all(
    hrefs.map((href) => get(href, "text/css").catch(() => "")), // a missing sheet is not fatal
  );

  return [...linked, ...inline].join("\n");
}

// Absolute URLs so images and links keep working from another domain.
function absolutise(html, baseUrl) {
  return html
    .replace(/\b(src|href)=["'](\/[^"'][^"']*)["']/gi, (_, attr, path) => `${attr}="${new URL(path, baseUrl).href}"`)
    .replace(/\bsrcset=["']([^"']+)["']/gi, (whole, value) => {
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [url, ...rest] = candidate.trim().split(/\s+/);
          if (!url) return candidate.trim();
          return [url.startsWith("/") ? new URL(url, baseUrl).href : url, ...rest].join(" ");
        })
        .join(", ");
      return `srcset="${rewritten}"`;
    });
}

export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Step one: fetch the page and return everything needed to translate it.
export async function readPage(url) {
  const html = await get(url, "text/html");
  const sections = contentSections(html);
  if (!sections.length) {
    throw new Error(
      "No content sections found below the buy box. The page may not be a Shopify storefront, " +
        "or its content may be rendered by JavaScript.",
    );
  }

  const prepared = sections.map((section) => {
    const { template, texts } = extractTexts(absolutise(section.html, url));
    return { id: section.id, template, texts };
  });

  const css = await collectCss(html, url);

  return {
    source_url: url,
    section_count: prepared.length,
    sections: prepared,
    css,
    images: imageUrls(sections.map((s) => s.html).join("\n")),
    // Flat, ordered list for translation. Indices map back by walking sections.
    texts: prepared.flatMap((s) => s.texts),
  };
}

// Step two: rebuild the page with translated strings and install it.
export async function installPage({ page, translations, productId, templateName, themeName, scope = ".pf-imported" }) {
  const suffix = slugify(templateName);
  if (!suffix) throw new Error("templateName is required and must contain letters or numbers.");

  // Refuse to install a half-translated page: it is the failure the shopper
  // sees first, and it is silent otherwise.
  const stuck = untranslatedStrings(page.texts, translations);
  if (stuck.length) {
    throw new Error(
      `${stuck.length} of ${page.texts.length} strings came back unchanged in English. ` +
        `Translate all of them and call this tool again. Still English at indices: ` +
        stuck
          .slice(0, 15)
          .map((s) => `[${s.index}] ${JSON.stringify(s.text)}`)
          .join(", ") +
        (stuck.length > 15 ? `, and ${stuck.length - 15} more.` : ""),
    );
  }

  // Hand each section back its own slice of the translated list.
  let cursor = 0;
  const translated = page.sections
    .map((section) => {
      const slice = translations.slice(cursor, cursor + section.texts.length);
      cursor += section.texts.length;
      return applyTexts(section.template, slice, section.texts);
    })
    .join("\n");

  const { html, count: ctaCount } = rewriteCtas(translated);
  const used = selectorsUsed(html);
  const css = [scopeCss(pruneCss(page.css, used), scope), visibilityOverrides(scope)].join("\n");

  const theme = await findTheme(themeName);
  const sectionFile = `sections/${suffix}.liquid`;
  const templateFile = `templates/product.${suffix}.json`;

  const defaultTemplate = await readThemeFile(theme.id, "templates/product.json");

  const written = await writeThemeFiles(theme.id, [
    { filename: "sections/pf-buybox.liquid", content: BUY_BOX },
    {
      filename: sectionFile,
      content: buildSectionLiquid({ sectionName: templateName, scope, html, css, script: ctaScript() }),
    },
    {
      filename: templateFile,
      content: buildProductTemplate(defaultTemplate, sectionFile, "pf-buybox"),
    },
  ]);

  const product = productId ? await setProductTemplate(productId, suffix) : null;

  return {
    theme: { id: theme.id, name: theme.name, role: theme.role },
    written,
    template_suffix: suffix,
    product,
    css_bytes: css.length,
    html_bytes: html.length,
    sections: page.section_count,
    cta_buttons_repointed: ctaCount,
    remaining_english: findEnglishLeftovers(html),
    note:
      theme.role === "MAIN"
        ? "Written to the LIVE theme. The template is only used by products assigned to it."
        : "Written to an unpublished theme - preview it before publishing.",
  };
}

export async function findProduct(handleOrId) {
  if (/^gid:\/\//.test(handleOrId)) return { id: handleOrId };
  if (/^\d+$/.test(handleOrId)) return { id: `gid://shopify/Product/${handleOrId}` };
  const data = await adminGraphQL(
    `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id title handle templateSuffix } }`,
    { h: handleOrId },
  );
  if (!data.productByIdentifier) throw new Error(`No product with handle "${handleOrId}".`);
  return data.productByIdentifier;
}

// Strings handed back unchanged are the main way a page ends up half English:
// the counts line up, so nothing complains, but whole sections were skipped.
// Proper nouns and numbers legitimately survive translation, so only flag text
// that looks like English prose.
const ENGLISH_WORDS = new RegExp(
  "\\b(" +
    [
      "the,and,you,your,with,that,this,for,from,have,has,had,was,were,are,is,it,its",
      "my,our,their,his,her,not,but,all,can,could,will,would,should,about,after,before",
      "more,most,just,when,what,how,why,who,been,they,them,she,he,we,me,him,us,i",
      "to,of,in,on,at,as,by,or,if,so,do,did,does,get,got,make,made,one,two,first,last",
      "very,still,even,only,also,than,then,there,here,over,into,out,up,down,back,off",
      "like,know,think,take,took,use,used,need,want,feel,felt,work,works,worked,keep",
      "day,days,week,weeks,month,months,year,years,time,really,actually,every,everything",
      "something,nothing,anything,now,without,because,while,being,other,some,any,each",
    ].join(",").split(",").join("|") +
    ")\\b",
  "gi",
);

export function untranslatedStrings(sources, translations) {
  const stuck = [];
  for (const [index, source] of sources.entries()) {
    const translated = translations[index];
    if (typeof translated !== "string") continue;
    if (translated.trim() !== source.trim()) continue;

    const words = source.trim().split(/\s+/);
    if (words.length < 2) continue; // "GoodGrove", "500 mg" - fine as-is
    // One English word is enough: short headings like "One Simple Ingredient"
    // slipped through a stricter threshold and stayed English on the page.
    const englishHits = (source.match(ENGLISH_WORDS) ?? []).length;
    if (englishHits >= 1) stuck.push({ index, text: source.slice(0, 80) });
  }
  return stuck;
}

// A last check before delivery: obvious English that slipped through. Reported
// rather than fixed, so it is visible instead of silently wrong.
const ENGLISH_GIVEAWAYS =
  /\b(add to cart|buy now|checkout|free shipping|money[- ]back|guarantee|reviews?|shop now|learn more|sold out|in stock|customer|benefits|how it works|ingredients|shipping|returns)\b/gi;

export function findEnglishLeftovers(html) {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const hits = [...new Set((text.match(ENGLISH_GIVEAWAYS) ?? []).map((h) => h.toLowerCase()))];
  return hits.slice(0, 12);
}
