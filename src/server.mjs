#!/usr/bin/env node
// MCP server exposing the Shopify store's Admin API to Claude.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.mjs";
import { adminGraphQL, assertReadOnly } from "./shopify.mjs";

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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`shopify mcp: connected to ${config.store} (API ${config.apiVersion})`);
