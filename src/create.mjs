// Creates products in the Shopify store from translated listing data.
import { adminGraphQL } from "./shopify.mjs";

export function assertWritesAllowed() {
  if (process.env.SHOPIFY_ALLOW_WRITES !== "true") {
    throw new Error(
      "Writing to the store is disabled. Set SHOPIFY_ALLOW_WRITES=true in .env, and make sure the " +
        "access token was granted write_products (re-run `npm run auth` after adding it to SHOPIFY_SCOPES).",
    );
  }
}

// Guards against listing the same item twice - matches on barcode first
// (authoritative), then falls back to an exact title match.
export async function findExisting({ barcode, title }) {
  const matches = [];
  if (barcode) {
    const data = await adminGraphQL(
      `query($q: String!) { productVariants(first: 5, query: $q) {
        nodes { id barcode product { id handle title status } } } }`,
      { q: `barcode:${JSON.stringify(String(barcode))}` },
    );
    for (const node of data.productVariants.nodes) {
      matches.push({ reason: "barcode", barcode: node.barcode, ...node.product });
    }
  }
  if (!matches.length && title) {
    const data = await adminGraphQL(
      `query($q: String!) { products(first: 5, query: $q) { nodes { id handle title status } } }`,
      { q: `title:${JSON.stringify(title)}` },
    );
    for (const node of data.products.nodes) {
      if (node.title.trim().toLowerCase() === title.trim().toLowerCase()) {
        matches.push({ reason: "title", ...node });
      }
    }
  }
  return matches;
}

export async function createProduct(input) {
  assertWritesAllowed();

  const {
    title,
    descriptionHtml,
    vendor,
    productType,
    tags = [],
    price,
    compareAtPrice,
    sku,
    barcode,
    images = [],
    seoTitle,
    seoDescription,
    handle,
    status = process.env.SHOPIFY_PRODUCT_STATUS || "DRAFT",
    sourceUrl,
  } = input;

  if (!title?.trim()) throw new Error("title is required.");
  if (
    status !== "DRAFT" &&
    process.env.SHOPIFY_ALLOW_PUBLISH !== "true" &&
    process.env.SHOPIFY_PRODUCT_STATUS !== "ACTIVE"
  ) {
    throw new Error(
      `Refusing to create a product with status ${status}. Set SHOPIFY_PRODUCT_STATUS=ACTIVE ` +
        "(or SHOPIFY_ALLOW_PUBLISH=true) to publish imported products immediately.",
    );
  }

  // A published product with no price sells for nothing.
  if (status === "ACTIVE" && !(Number(price) > 0)) {
    throw new Error(
      "Refusing to publish a product with no price: an ACTIVE product at 0,00 € can be bought " +
        "for free. Pass a price, or create it as DRAFT and price it in Shopify.",
    );
  }

  const product = {
    title: title.trim(),
    status,
    ...(descriptionHtml ? { descriptionHtml } : {}),
    ...(vendor ? { vendor } : {}),
    ...(productType ? { productType } : {}),
    ...(handle ? { handle } : {}),
    ...(tags.length ? { tags } : {}),
    ...(seoTitle || seoDescription
      ? { seo: { ...(seoTitle ? { title: seoTitle } : {}), ...(seoDescription ? { description: seoDescription } : {}) } }
      : {}),
    ...(sourceUrl
      ? {
          metafields: [
            { namespace: "import", key: "source_url", type: "url", value: sourceUrl },
            { namespace: "import", key: "imported_at", type: "date_time", value: new Date().toISOString() },
          ],
        }
      : {}),
  };

  const media = images
    .filter(Boolean)
    .slice(0, 10)
    .map((url) => ({ originalSource: url, alt: title.trim().slice(0, 512), mediaContentType: "IMAGE" }));

  const created = await adminGraphQL(
    `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id handle title status onlineStoreUrl variants(first: 1) { nodes { id } } }
        userErrors { field message }
      }
    }`,
    { product, media },
  );

  const errors = created.productCreate.userErrors;
  if (errors?.length) throw new Error(`productCreate: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);

  const result = created.productCreate.product;
  const variantId = result.variants.nodes[0]?.id;
  let variant = null;

  if (variantId && (price || compareAtPrice || sku || barcode)) {
    const updated = await adminGraphQL(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice barcode inventoryItem { sku } }
          userErrors { field message }
        }
      }`,
      {
        productId: result.id,
        variants: [
          {
            id: variantId,
            ...(price ? { price: String(price) } : {}),
            ...(compareAtPrice ? { compareAtPrice: String(compareAtPrice) } : {}),
            ...(barcode ? { barcode: String(barcode) } : {}),
            ...(sku ? { inventoryItem: { sku: String(sku) } } : {}),
          },
        ],
      },
    );
    const variantErrors = updated.productVariantsBulkUpdate.userErrors;
    if (variantErrors?.length) {
      throw new Error(
        `Product created (${result.handle}) but variant update failed: ` +
          variantErrors.map((e) => `${e.field}: ${e.message}`).join("; "),
      );
    }
    variant = updated.productVariantsBulkUpdate.productVariants[0];
  }

  const numericId = result.id.split("/").pop();
  return {
    ...result,
    variant,
    admin_url: `https://admin.shopify.com/store/${process.env.SHOPIFY_STORE?.split(".")[0] ?? ""}/products/${numericId}`,
    note:
      status === "DRAFT"
        ? "Created as a draft. Review it in Shopify admin, then publish."
        : "Created ACTIVE - live on the storefront now.",
  };
}
