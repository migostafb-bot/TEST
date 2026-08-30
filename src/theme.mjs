// Reads and writes theme files, and points a product at a template.
import { adminGraphQL } from "./shopify.mjs";
import { assertWritesAllowed } from "./create.mjs";

export async function findTheme(name) {
  const data = await adminGraphQL(`{ themes(first: 50) { nodes { id name role } } }`);
  const themes = data.themes.nodes;
  if (name) {
    const wanted = name.trim().toLowerCase();
    const match =
      themes.find((t) => t.name.trim().toLowerCase() === wanted) ??
      themes.find((t) => t.name.trim().toLowerCase().includes(wanted));
    if (!match) {
      throw new Error(
        `No theme named "${name}". Available: ${themes.map((t) => `${t.name} (${t.role})`).join(", ")}`,
      );
    }
    return match;
  }
  const live = themes.find((t) => t.role === "MAIN");
  if (!live) throw new Error("No published theme found.");
  return live;
}

export async function readThemeFile(themeId, filename) {
  const data = await adminGraphQL(
    `query($id: ID!, $filenames: [String!]) {
      theme(id: $id) {
        files(filenames: $filenames, first: 1) {
          nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }`,
    { id: themeId, filenames: [filename] },
  );
  return data.theme?.files?.nodes?.[0]?.body?.content ?? null;
}

export async function writeThemeFiles(themeId, files) {
  assertWritesAllowed();
  const data = await adminGraphQL(
    `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles { filename }
        userErrors { field message }
      }
    }`,
    {
      themeId,
      files: files.map(({ filename, content }) => ({
        filename,
        body: { type: "TEXT", value: content },
      })),
    },
  );

  const errors = data.themeFilesUpsert.userErrors;
  if (errors?.length) {
    throw new Error(`Theme write failed: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  }
  return data.themeFilesUpsert.upsertedThemeFiles.map((f) => f.filename);
}

export async function setProductTemplate(productId, templateSuffix) {
  assertWritesAllowed();
  const data = await adminGraphQL(
    `mutation($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle templateSuffix }
        userErrors { field message }
      }
    }`,
    { product: { id: productId, templateSuffix } },
  );
  const errors = data.productUpdate.userErrors;
  if (errors?.length) {
    throw new Error(`Could not set the template: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  }
  return data.productUpdate.product;
}

// A Shopify section file: the imported markup, its scoped styles, and a schema
// block so the section is valid and appears in the theme editor.
export function buildSectionLiquid({ sectionName, scope, html, css, script = "" }) {
  const schema = {
    name: sectionName.slice(0, 25), // Shopify caps section names
    settings: [],
    presets: [{ name: sectionName.slice(0, 25) }],
  };

  return [
    `{%- comment -%}`,
    `  Imported product page section. Generated - edit in the theme editor or`,
    `  re-run the importer rather than hand-editing.`,
    `{%- endcomment -%}`,
    ``,
    `<style>`,
    css,
    `</style>`,
    ``,
    `<div class="${scope.replace(/^\./, "")}">`,
    html,
    `</div>`,
    ``,
    script,
    ``,
    `{% schema %}`,
    JSON.stringify(schema, null, 2),
    `{% endschema %}`,
    ``,
  ].join("\n");
}

// Builds templates/product.<suffix>.json by taking the theme's default product
// template and appending the imported section, so the buy box, gallery and
// everything else the theme already does is preserved.
export function buildProductTemplate(defaultTemplateJson, sectionFileName, buyBoxKey) {
  const key = sectionFileName.replace(/^sections\//, "").replace(/\.liquid$/, "");
  let template;

  try {
    template = JSON.parse(stripJsonComments(defaultTemplateJson ?? ""));
  } catch {
    template = null;
  }

  const extra = {};
  if (buyBoxKey) extra[buyBoxKey] = { type: buyBoxKey };
  extra[key] = { type: key };

  if (!template?.sections) {
    // No usable default - a minimal template that still renders the product.
    return JSON.stringify(
      { sections: { main: { type: "main-product" }, ...extra }, order: ["main", ...Object.keys(extra)] },
      null,
      2,
    );
  }

  template.sections = { ...template.sections, ...extra };
  const added = Object.keys(extra);
  const order = (template.order ?? Object.keys(template.sections)).filter((o) => !added.includes(o));
  // The buy box belongs directly under the theme's product section; the
  // imported page content follows it.
  const mainAt = order.findIndex((o) => /^main/.test(o));
  if (buyBoxKey && mainAt !== -1) {
    order.splice(mainAt + 1, 0, buyBoxKey);
    template.order = [...order, key];
  } else {
    template.order = [...order, ...added];
  }
  return JSON.stringify(template, null, 2);
}

// Shopify's template JSON allows /* */ comments, which JSON.parse rejects.
function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}
