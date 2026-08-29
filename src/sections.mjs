// Pulls a competitor product page apart into its Shopify sections, keeps the
// content sections below the buy box, and prunes the theme stylesheet down to
// only the rules those sections actually use.

// Sections that belong to the storefront chrome or the buy box rather than to
// the product's content, matched against the section id.
const CHROME = [
  /__main\b/,
  /__header\b/,
  /__footer\b/,
  /announcement/i,
  /sticky[-_]?add[-_]?to[-_]?cart/i,
  /breadcrumb/i,
  /newsletter/i,
  /cart[-_]?drawer/i,
  /popup/i,
  /recently[-_]?viewed/i,
];

export function splitSections(html) {
  const sections = [];
  const open = /<section\b[^>]*\bid=["'](shopify-section-[^"']+)["'][^>]*>/gi;
  let match;

  while ((match = open.exec(html))) {
    const start = match.index;
    // Walk forward counting nested <section> tags to find this one's close.
    let depth = 0;
    let index = start;
    const tag = /<\/?section\b[^>]*>/gi;
    tag.lastIndex = start;
    let end = -1;
    let inner;
    while ((inner = tag.exec(html))) {
      depth += inner[0].startsWith("</") ? -1 : 1;
      index = inner.index + inner[0].length;
      if (depth === 0) {
        end = index;
        break;
      }
    }
    if (end === -1) continue;
    sections.push({ id: match[1], html: html.slice(start, end) });
    open.lastIndex = end;
  }
  return sections;
}

export function isContentSection({ id }) {
  return !CHROME.some((pattern) => pattern.test(id));
}

// Everything after the buy box. Sections before it are gallery/price/form,
// which the destination theme renders itself.
export function contentSections(html) {
  const all = splitSections(html);
  const mainIndex = all.findIndex(({ id }) => /__main\b/.test(id));
  const after = mainIndex === -1 ? all : all.slice(mainIndex + 1);
  return after.filter(isContentSection);
}

// Class names, ids and element names referenced by a chunk of HTML, used to
// decide which CSS rules are worth keeping.
export function selectorsUsed(html) {
  const classes = new Set();
  const ids = new Set();
  const tags = new Set();

  for (const [, value] of html.matchAll(/\bclass=["']([^"']+)["']/gi)) {
    for (const name of value.split(/\s+/)) if (name) classes.add(name);
  }
  for (const [, value] of html.matchAll(/\bid=["']([^"']+)["']/gi)) ids.add(value);
  for (const [, name] of html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) tags.add(name.toLowerCase());

  return { classes, ids, tags };
}

const ROOTISH = /^\s*(:root|html|body|\*)\b/;

function selectorMatches(selector, { classes, ids, tags }) {
  // Kept for their custom properties only - see pruneCss.
  if (ROOTISH.test(selector)) return true;

  const usedClass = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const usedId = [...selector.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);

  if (usedClass.length || usedId.length) {
    return usedClass.some((name) => classes.has(name)) || usedId.some((name) => ids.has(name));
  }

  // Bare element selectors (h2, p, img...) - keep if the tag appears.
  const bare = selector.replace(/::?[a-z-]+(\([^)]*\))?/gi, "").trim().split(/[\s>+~,]+/).filter(Boolean);
  return bare.length > 0 && bare.every((name) => tags.has(name.toLowerCase()) || /^[[:]/.test(name));
}

// A small CSS walker - enough for pruning, without pulling in a full parser.
// Handles nested at-rules (@media, @supports, @layer) and skips @font-face and
// keyframes, which have no selectors to match.
export function pruneCss(css, used) {
  const out = [];
  let index = 0;

  const readBlock = (from) => {
    let depth = 0;
    for (let i = from; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return css.length - 1;
  };

  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace === -1) break;
    const prelude = css.slice(index, brace).trim();
    const close = readBlock(brace);
    const body = css.slice(brace + 1, close);

    if (/^@(media|supports|layer|container)/i.test(prelude)) {
      const nested = pruneCss(body, used);
      if (nested.trim()) out.push(`${prelude} {\n${nested}\n}`);
    } else if (/^@(font-face|keyframes|-webkit-keyframes|import|charset)/i.test(prelude)) {
      // Font faces and keyframes are cheap and referenced indirectly - keep.
      if (/^@(font-face|keyframes|-webkit-keyframes)/i.test(prelude)) out.push(`${prelude} {${body}}`);
    } else if (prelude) {
      const kept = prelude
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && selectorMatches(s, used));

      if (kept.length && kept.every((s) => ROOTISH.test(s))) {
        // A rule on :root/html/body is kept only for the custom properties it
        // defines. Its other declarations (page-load fades, resets) would be
        // retargeted onto the wrapper and break the imported markup.
        const vars = body
          .split(";")
          .map((d) => d.trim())
          .filter((d) => d.startsWith("--"));
        if (vars.length) out.push(`${kept.join(", ")} {${vars.join(";")};}`);
      } else if (kept.length) {
        out.push(`${kept.join(", ")} {${body}}`);
      }
    }

    index = close + 1;
  }

  return out.join("\n");
}

// Prefix every kept selector so the imported styles cannot leak into the rest
// of the destination theme. At-rules keep their own structure: @media and
// friends are scoped inside, @keyframes and @font-face are left alone.
export function scopeCss(css, scope) {
  const out = [];
  let index = 0;

  const readBlock = (from) => {
    let depth = 0;
    for (let i = from; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return css.length - 1;
  };

  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace === -1) break;
    const prelude = css.slice(index, brace).trim();
    const close = readBlock(brace);
    const body = css.slice(brace + 1, close);

    if (/^@(media|supports|layer|container)/i.test(prelude)) {
      out.push(`${prelude} {\n${scopeCss(body, scope)}\n}`);
    } else if (prelude.startsWith("@")) {
      out.push(`${prelude} {${body}}`); // @keyframes, @font-face - never scoped
    } else if (prelude) {
      const scoped = prelude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        // :root/html/body rules carry theme variables; retarget them at the
        // wrapper so custom properties still resolve inside it.
        .map((s) => (/^(:root|html|body)\b/.test(s) ? scope : `${scope} ${s}`))
        .join(", ");
      out.push(`${scoped} {${body}}`);
    }

    index = close + 1;
  }

  return out.join("\n");
}

// Themes hide scroll-reveal elements until their own JavaScript adds a class
// on scroll. That script does not come across with the markup, so without
// these overrides the imported sections render blank.
export function visibilityOverrides(scope) {
  return [
    `/* Imported markup carries scroll-reveal classes but not the script that`,
    `   reveals them - force everything visible. */`,
    `${scope} .scroll-trigger,`,
    `${scope} [class*="animate--"],`,
    `${scope} .scroll-trigger.animate--fade-in,`,
    `${scope} .scroll-trigger.animate--slide-in {`,
    `  opacity: 1 !important;`,
    `  transform: none !important;`,
    `  animation: none !important;`,
    `  visibility: visible !important;`,
    `}`,
  ].join("\n");
}

export function imageUrls(html) {
  const urls = new Set();
  for (const [, value] of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) urls.add(value);
  for (const [, value] of html.matchAll(/\bstyle=["'][^"']*url\(["']?([^"')]+)/gi)) urls.add(value);
  for (const [, value] of html.matchAll(/<source\b[^>]*\bsrcset=["']([^"']+)["']/gi)) {
    for (const candidate of value.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  return [...urls];
}
