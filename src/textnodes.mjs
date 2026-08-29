// Pulls the human-readable strings out of a chunk of HTML and puts translated
// ones back, leaving every tag, class and attribute exactly as it was.
// Translating whole HTML through a model rewrites markup; translating only the
// strings cannot.

const SKIP_ELEMENTS = new Set(["script", "style", "noscript", "svg", "template", "code", "pre"]);
const TRANSLATABLE_ATTRS = ["alt", "title", "placeholder", "aria-label", "data-text", "value"];

// A string worth sending to a translator: has letters, is not a bare number,
// URL, hex colour, or CSS-looking fragment.
export function isTranslatable(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // Flag emoji carry country meaning even with no letters, so they need to
  // reach the translator to be swapped or dropped.
  if (/\p{Regional_Indicator}{2}/u.test(trimmed)) return true;
  if (!/\p{L}{2}/u.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return false;
  if (/^[\d\s.,%€$£+-]+$/.test(trimmed)) return false;
  if (/^[a-z-]+:\s*[^;]+;/i.test(trimmed)) return false; // inline CSS
  if (/^\{\{|\{%/.test(trimmed)) return false; // Liquid
  return true;
}

// Printable and distinctive: safe inside HTML text, attributes and JSON alike,
// and vanishingly unlikely to occur in real copy.
const MARKER = (index) => `«T${index}»`;
const MARKER_PATTERN = /«T(\d+)»/g;

// Review widgets, bundle pickers and FAQ blocks often keep their copy in a
// JSON <script> and render it with JavaScript. That text is invisible to a
// tag-based scan, so the widget prints the original language back onto the
// page. Walk the JSON and mark its strings too.
// Any <script>, whatever its type: widgets hold their copy as a bare JSON
// body, or as `window.reviews = {...}` in ordinary JavaScript. Matching only
// type="application/json" missed the common case and left reviews in English.
const JSON_SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;

// Returns [prefix, jsonText, suffix] when a script body holds a JSON payload,
// so the surrounding JavaScript is preserved byte for byte.
function findJsonPayload(body) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const lead = body.slice(0, body.indexOf(trimmed[0]));
    return [lead, trimmed, body.slice(lead.length + trimmed.length)];
  }

  // `var x = {...}` / `window.data = [...]`, optionally with a trailing ;
  const assignment = /^([\s\S]*?=\s*)([[{][\s\S]*[\]}])(\s*;?\s*)$/.exec(body);
  if (assignment) return [assignment[1], assignment[2], assignment[3]];

  return null;
}

// Keys holding identifiers, URLs or markup are left untouched - translating
// them would break whatever reads them.
const OPAQUE_KEY = /^(id|_id|url|href|src|handle|type|class|className|sku|code|key|slug|tag|locale|currency)$/i;

function markJsonStrings(value, texts) {
  if (typeof value === "string") {
    if (!isTranslatable(value)) return value;
    const marker = MARKER(texts.length);
    texts.push(value);
    return marker;
  }
  if (Array.isArray(value)) return value.map((item) => markJsonStrings(item, texts));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = OPAQUE_KEY.test(key) ? item : markJsonStrings(item, texts);
    }
    return out;
  }
  return value;
}

export function extractJsonScripts(html, texts) {
  return html.replace(JSON_SCRIPT, (whole, open, body, close) => {
    const payload = findJsonPayload(body);
    if (!payload) return whole;
    const [lead, json, trail] = payload;
    try {
      const marked = markJsonStrings(JSON.parse(json), texts);
      // Re-serialised through JSON.stringify, so translated text containing
      // quotes or backslashes is escaped correctly when it is put back.
      return `${open}${lead}${JSON.stringify(marked)}${trail}${close}`;
    } catch {
      return whole; // not valid JSON - leave it exactly as it was
    }
  });
}

// Returns { template, texts }. `template` is the HTML with every translatable
// string replaced by a marker; `texts` is the list to translate, in order.
export function extractTexts(html) {
  const texts = [];
  // JSON scripts first: the tag scan below skips <script>, so their markers
  // simply survive into the template untouched.
  const source = extractJsonScripts(html, texts);

  let out = "";
  let index = 0;
  let skipDepth = 0;
  let skipTag = null;

  const takeText = (chunk) => {
    if (skipDepth === 0 && isTranslatable(chunk)) {
      // Preserve the surrounding whitespace so layout is unchanged.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(chunk);
      out += lead + MARKER(texts.length) + trail;
      texts.push(core);
    } else {
      out += chunk;
    }
  };

  const tagPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
  let match;

  while ((match = tagPattern.exec(source))) {
    const between = source.slice(index, match.index);
    if (between) takeText(between);

    const tag = match[0];
    const name = (match[1] || "").toLowerCase();

    if (!tag.startsWith("<!--") && SKIP_ELEMENTS.has(name)) {
      if (tag.startsWith("</")) {
        if (skipTag === name && skipDepth > 0) skipDepth -= 1;
      } else if (!tag.endsWith("/>")) {
        skipTag = name;
        skipDepth += 1;
      }
    }

    out += skipDepth > 0 ? tag : replaceAttributes(tag, texts);
    index = match.index + tag.length;
  }

  const tail = source.slice(index);
  if (tail) takeText(tail);

  return { template: out, texts };
}

function replaceAttributes(tag, texts) {
  if (tag.startsWith("</") || tag.startsWith("<!--")) return tag;
  let result = tag;
  for (const attr of TRANSLATABLE_ATTRS) {
    const pattern = new RegExp(`(\\b${attr}=)(["'])([^"']*)\\2`, "gi");
    result = result.replace(pattern, (whole, prefix, quote, value) => {
      if (!isTranslatable(value)) return whole;
      const marker = MARKER(texts.length);
      texts.push(value);
      return `${prefix}${quote}${marker}${quote}`;
    });
  }
  return result;
}

// Byte ranges covered by JSON <script> blocks, so a replacement landing inside
// one can be escaped rather than breaking the JSON.
function jsonRanges(template) {
  const ranges = [];
  for (const match of template.matchAll(JSON_SCRIPT)) {
    const start = match.index + match[1].length;
    ranges.push([start, start + match[2].length]);
  }
  return ranges;
}

// Puts translated strings back. A missing or empty translation falls back to
// the original, so a short model response degrades rather than blanking text.
export function applyTexts(template, translations, originals = []) {
  const ranges = jsonRanges(template);
  const insideJson = (offset) => ranges.some(([from, to]) => offset >= from && offset < to);

  return template.replace(MARKER_PATTERN, (whole, index, offset) => {
    const position = Number(index);
    const candidate = translations[position];
    const value =
      typeof candidate === "string" && candidate.trim() ? candidate : (originals[position] ?? "");
    // A quote or backslash in French copy would otherwise break the widget's
    // JSON and blank the whole block.
    return insideJson(offset) ? JSON.stringify(value).slice(1, -1) : value;
  });
}

export function markerCount(template) {
  return (template.match(MARKER_PATTERN) ?? []).length;
}
