import { config, readToken } from "./config.mjs";

export async function adminGraphQL(query, variables = {}) {
  const url = `https://${config.store}/admin/api/${config.apiVersion}/graphql.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": readToken(),
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify API ${response.status}: ${text.slice(0, 800)}`);
  }
  const body = JSON.parse(text);
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors).slice(0, 800)}`);
  }
  return body.data;
}

// Mutations stay off unless explicitly enabled, so a read-only link cannot
// change store data by accident.
export function assertReadOnly(query) {
  if (process.env.SHOPIFY_ALLOW_MUTATIONS === "true" || process.env.SHOPIFY_ALLOW_WRITES === "true") return;
  if (/^\s*(#[^\n]*\n\s*)*mutation\b/i.test(query)) {
    throw new Error("Mutations are disabled. Set SHOPIFY_ALLOW_WRITES=true to allow writes.");
  }
}
