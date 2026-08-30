#!/usr/bin/env node
// MCP server exposing the Shopify store's Admin API to Claude.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.mjs";
import { adminGraphQL, assertReadOnly } from "./shopify.mjs";
import { fetchProduct } from "./scrape.mjs";
import { createProduct, findExisting, deleteProduct } from "./create.mjs";
import { readPage, installPage, findProduct } from "./clone.mjs";
import { computePrice } from "./pricing.mjs";

const server = new McpServer({ name: "shopify", version: "1.0.0" });

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

function tool(name, description, schema, handler) {
  server.registerTool(name, { description, inputSchema: schema }, async (args) => {
    try {
      return json(await handler(args ?? {}));
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });
}

tool("shop_info", "Get the store's name, domains, currency, plan and timezone.", {}, async () => {
  const data = await adminGraphQL(`{
    shop {
      name myshopifyDomain primaryDomain { host url } email
      currencyCode ianaTimezone weightUnit
      plan { displayName partnerDevelopment shopifyPlus }
      billingAddress { country countryCodeV2 city }
    }
  }`);
  return data.shop;
});

tool(
  "search_products",
  "Search products. `query` uses Shopify search syntax, e.g. 'title:serum status:active' or 'inventory_total:<5'.",
  { query: z.string().optional(), first: z.number().int().min(1).max(100).default(20) },
  async ({ query, first }) => {
    const data = await adminGraphQL(
      `query($q: String, $n: Int!) {
        products(first: $n, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title status vendor productType totalInventory
            featuredImage { url }
            priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
            variants(first: 10) { nodes { id title sku price inventoryQuantity } }
          }
        }
      }`,
      { q: query ?? null, n: first },
    );
    return data.products;
  },
);

tool(
  "get_product",
  "Get one product in full detail by its numeric ID, GID or handle.",
  { id: z.string().describe("Numeric ID, gid://shopify/Product/... or product handle") },
  async ({ id }) => {
    const gid = /^\d+$/.test(id)
      ? `gid://shopify/Product/${id}`
      : id.startsWith("gid://")
        ? id
        : null;
    if (gid) {
      const data = await adminGraphQL(
        `query($id: ID!) { product(id: $id) {
          id handle title status descriptionHtml vendor productType tags totalInventory
          createdAt updatedAt publishedAt
          options { name values }
          images(first: 20) { nodes { url altText } }
          variants(first: 100) { nodes { id title sku barcode price compareAtPrice inventoryQuantity } }
        } }`,
        { id: gid },
      );
      return data.product;
    }
    const data = await adminGraphQL(
      `query($h: String!) { productByIdentifier(identifier: { handle: $h }) {
        id handle title status descriptionHtml vendor productType tags totalInventory
        variants(first: 100) { nodes { id title sku price inventoryQuantity } }
      } }`,
      { h: id },
    );
    return data.productByIdentifier;
  },
);

tool(
  "list_orders",
  "List orders, newest first. `query` uses Shopify search syntax, e.g. 'financial_status:paid created_at:>2026-08-01'.",
  { query: z.string().optional(), first: z.number().int().min(1).max(100).default(20) },
  async ({ query, first }) => {
    const data = await adminGraphQL(
      `query($q: String, $n: Int!) {
        orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name createdAt displayFinancialStatus displayFulfillmentStatus
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            customer { id displayName email }
            shippingAddress { city province country }
            lineItems(first: 25) { nodes { title quantity sku
              originalTotalSet { shopMoney { amount currencyCode } } } }
          }
        }
      }`,
      { q: query ?? null, n: first },
    );
    return data.orders;
  },
);

tool(
  "list_customers",
  "List or search customers. `query` uses Shopify search syntax, e.g. 'email:*@gmail.com'.",
  { query: z.string().optional(), first: z.number().int().min(1).max(100).default(20) },
  async ({ query, first }) => {
    const data = await adminGraphQL(
      `query($q: String, $n: Int!) {
        customers(first: $n, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id displayName email phone createdAt numberOfOrders state
            amountSpent { amount currencyCode }
            defaultAddress { city province country }
          }
        }
      }`,
      { q: query ?? null, n: first },
    );
    return data.customers;
  },
);

tool(
  "inventory_levels",
  "Show on-hand and available inventory per location for variants matching a product query.",
  { query: z.string().optional(), first: z.number().int().min(1).max(50).default(20) },
  async ({ query, first }) => {
    const data = await adminGraphQL(
      `query($q: String, $n: Int!) {
        productVariants(first: $n, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title sku product { title handle }
            inventoryItem {
              tracked
              inventoryLevels(first: 10) {
                nodes { location { name } quantities(names: ["available","on_hand","committed"]) { name quantity } }
              }
            }
          }
        }
      }`,
      { q: query ?? null, n: first },
    );
    return data.productVariants;
  },
);

tool(
  "admin_graphql",
  "Run an arbitrary Shopify Admin GraphQL query against the store. Read-only unless SHOPIFY_ALLOW_MUTATIONS=true.",
  {
    query: z.string().describe("GraphQL document"),
    variables: z.record(z.any()).optional(),
  },
  async ({ query, variables }) => {
    assertReadOnly(query);
    return adminGraphQL(query, variables ?? {});
  },
);


tool(
  "fetch_competitor_product",
  "Fetch a competitor product page and extract its data: title, brand, EAN, price, images, " +
    "ingredients, usage, and the full source description. Use this before create_product, then " +
    "translate the listing into French.",
  { url: z.string().describe("Full URL of the competitor's product page") },
  async ({ url }) => fetchProduct(url),
);

tool(
  "check_duplicate",
  "Check whether a product is already listed in the store, by barcode (EAN) or exact title. " +
    "Run this before creating to avoid duplicate listings.",
  { barcode: z.string().optional(), title: z.string().optional() },
  async ({ barcode, title }) => {
    const matches = await findExisting({ barcode, title });
    return { already_listed: matches.length > 0, matches };
  },
);

tool(
  "create_product",
  "Create a product in the store from translated French listing data. Created as a DRAFT for review. " +
    "Pass French text in title, descriptionHtml and the SEO fields.",
  {
    title: z.string().describe("French product title"),
    descriptionHtml: z.string().optional().describe("French description as HTML, mirroring the source structure"),
    vendor: z.string().optional().describe("Brand name"),
    productType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    price: z.string().optional().describe("Selling price in store currency"),
    compareAtPrice: z.string().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional().describe("EAN / GTIN"),
    images: z.array(z.string()).optional().describe("Image URLs to attach"),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    handle: z.string().optional().describe("URL slug, French, lowercase-hyphenated"),
    sourceUrl: z.string().optional().describe("Competitor URL, recorded on the product for traceability"),
    status: z.enum(["DRAFT", "ACTIVE"]).optional().default("DRAFT"),
    bundles: z
      .array(z.object({ title: z.string(), price: z.string(), compareAtPrice: z.string().optional() }))
      .optional()
      .describe('Bundle tiers as real variants, e.g. [{title:"1 flacon",price:"64.90"},{title:"2 flacons",price:"103.90"}]'),
  },
  async (args) => createProduct(args),
);


// The fetched page (including ~1MB of theme CSS) is held here rather than
// returned, so only the strings needing translation cross into the model.
const pageCache = new Map();

tool(
  "read_competitor_page",
  "Fetch a competitor product page and return the text of every content section below the buy box, " +
    "ready to translate. Call install_product_page next with the French translations.",
  { url: z.string().describe("Competitor product page URL") },
  async ({ url }) => {
    const page = await readPage(url);
    pageCache.set(url, page);
    return {
      source_url: url,
      section_count: page.section_count,
      image_count: page.images.length,
      text_count: page.texts.length,
      // Translate these in order and pass the same number back, same order.
      texts: page.texts,
    };
  },
);

tool(
  "install_product_page",
  "Install the translated page as a theme template and assign it to the product. Pass `translations` " +
    "as the French version of every string from read_competitor_page, in the same order and count.",
  {
    url: z.string().describe("The same URL passed to read_competitor_page"),
    translations: z.array(z.string()).describe("French strings, same order and length as `texts`"),
    product: z.string().describe("Product handle, numeric id, or gid to attach the template to"),
    templateName: z.string().describe("Template name, normally the French product title"),
    themeName: z.string().optional().describe("Theme to write into; defaults to SHOPIFY_THEME or the live theme"),
  },
  async ({ url, translations, product, templateName, themeName }) => {
    const page = pageCache.get(url);
    if (!page) throw new Error("Call read_competitor_page for this URL first.");
    if (translations.length !== page.texts.length) {
      throw new Error(
        `Expected ${page.texts.length} translations, got ${translations.length}. ` +
          "Return one French string per source string, in the same order.",
      );
    }
    const target = await findProduct(product);
    return installPage({
      page,
      translations,
      productId: target.id,
      templateName,
      themeName: themeName ?? process.env.SHOPIFY_THEME,
    });
  },
);

tool(
  "compute_price",
  "Convert the competitor's price into this store's selling price using the rule in .env " +
    "(exchange rate, margin, price ending). Use this instead of doing the arithmetic yourself.",
  {
    reference_price: z.string().describe("The competitor's price, e.g. \"49.99\""),
    currency: z.string().describe("The competitor's currency, e.g. \"USD\""),
  },
  async ({ reference_price, currency }) => computePrice(reference_price, currency),
);

tool(
  "delete_product",
  "Permanently delete a product from the store. Used when re-importing a listing that already " +
    "exists. There is no undo.",
  { product: z.string().describe("Product handle, numeric id, or gid") },
  async ({ product }) => {
    const target = await findProduct(product);
    return deleteProduct(target.id);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`shopify mcp: connected to ${config.store} (API ${config.apiVersion})`);
