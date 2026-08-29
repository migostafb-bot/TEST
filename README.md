# TEST — Shopify store link for Claude

An MCP server that gives Claude read access to the Shopify store
`n4k6ze-uf.myshopify.com` (PARAPHARMA FR, `www.parapharmafr.shop`) through the
Admin GraphQL API.

Credentials live only in a local `.env` and a local token file — nothing secret
is committed.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` from the custom app's **Settings → Credentials** page:

| Variable | Where it comes from |
| --- | --- |
| `SHOPIFY_STORE` | `n4k6ze-uf.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Client ID |
| `SHOPIFY_CLIENT_SECRET` | Secret |
| `SHOPIFY_SCOPES` | Subset of the app's configured scopes |
| `SHOPIFY_REDIRECT_URI` | Must match an **Allowed redirection URL** exactly — the app already has `http://localhost:3456/callback` |

Then install the app on the store to get an access token:

```bash
npm run auth
```

This opens the store's authorize screen, catches the redirect on
`localhost:3456`, verifies Shopify's HMAC, and writes an offline access token to
`.shopify-token.json` (mode 600, gitignored). Offline tokens do not expire, so
this is a one-time step — rerun it only after changing scopes.

## Connecting Claude

`.mcp.json` in this repo already registers the server, so `claude` started from
this directory picks it up. Confirm with `/mcp`.

To use it from anywhere:

```bash
claude mcp add shopify --scope user -- node /absolute/path/to/TEST/src/server.mjs
```

## Tools

| Tool | Purpose |
| --- | --- |
| `shop_info` | Store name, domains, currency, plan, timezone |
| `search_products` | Product search with variants and price ranges |
| `get_product` | One product by numeric ID, GID, or handle |
| `list_orders` | Recent orders with line items and customer |
| `list_customers` | Customer search with lifetime spend |
| `inventory_levels` | Per-location available / on-hand / committed |
| `admin_graphql` | Any Admin GraphQL query |

`query` arguments take [Shopify search syntax](https://shopify.dev/docs/api/usage/search-syntax),
e.g. `status:active vendor:Avene`, `financial_status:paid created_at:>2026-08-01`.

## Write access

Mutations through `admin_graphql` are refused by default. To allow them, set
`SHOPIFY_ALLOW_MUTATIONS=true` in `.env` and make sure the app's granted scopes
include the matching `write_*` permissions.

## Security notes

- `.env` and `.shopify-token.json` are gitignored. Keep them that way.
- The access token carries every granted scope — request only the scopes needed.
- If the client secret is ever exposed (screenshot, chat, log), rotate it in the
  app's **Settings → Credentials → Rotate**, then update `.env`.
