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
| `fetch_competitor_product` | Extract product data from a competitor's product URL |
| `check_duplicate` | Check if an item is already listed, by EAN or title |
| `create_product` | Create a French listing in the store (as a draft) |

`query` arguments take [Shopify search syntax](https://shopify.dev/docs/api/usage/search-syntax),
e.g. `status:active vendor:Avene`, `financial_status:paid created_at:>2026-08-01`.

## Listing competitor products in French

Paste a competitor's product URL into Claude and ask it to list the product.
It will extract the page's data, check the store for an existing listing,
translate everything into French, and create the product as a **draft** for you
to review and publish.

The translation rules live in `CLAUDE.md` and are followed automatically: the
French listing mirrors the source faithfully — same structure, same claims —
with brand names and INCI ingredient names left untouched.

Prices are never copied across. The competitor's price is reported as a
reference in their currency; you decide the margin.

### Enabling it

Creating products needs write access, which is off by default:

1. Add `write_products` to `SHOPIFY_SCOPES` in `.env` (already in the example).
2. Set `SHOPIFY_ALLOW_WRITES=true`.
3. Re-run `npm run auth` to get a token carrying the new scope.

Products are always created as drafts. `SHOPIFY_ALLOW_PUBLISH=true` lifts that,
but leaving it off means every imported listing gets a human read before it goes
live — worth it for regulated parapharmacy copy.

## Web app (Fly.io)

`web/` is a small site wrapping the same import flow: paste a competitor URL,
review the French translation, create the draft. No terminal, and no Claude
Code usage limits — translation runs through the Claude API instead.

It is password-protected. Anyone who can reach the URL and knows the password
can create products in your store, so pick a real password.

### Deploy

```bash
fly launch --no-deploy      # edit `app` in fly.toml to a name you like
fly secrets set \
  APP_PASSWORD='<a long password you choose>' \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  SHOPIFY_CLIENT_ID='<from Shopify>' \
  SHOPIFY_CLIENT_SECRET='<from Shopify>' \
  SHOPIFY_ACCESS_TOKEN="$(node -p "require('./.shopify-token.json').access_token")" \
  ANTHROPIC_API_KEY='<from console.anthropic.com>'
fly deploy
```

`SHOPIFY_ACCESS_TOKEN` comes from the local `.shopify-token.json` written by
`npm run auth`, so run that first. Secrets live in Fly, never in the repo.

The machine scales to zero when idle and wakes on the first request, so it
costs nothing while you are not using it.

### Run it locally

```bash
APP_PASSWORD=test npm run web    # http://localhost:8080
```

### Cost

Shopify and Fly are free at this volume. The Claude API is billed per
translation — a typical listing is a few thousand tokens, so cents per product
rather than euros.

## Tests

```bash
npm test
```

## Security notes

- `.env` and `.shopify-token.json` are gitignored. Keep them that way.
- The access token carries every granted scope — request only the scopes needed.
- If the client secret is ever exposed (screenshot, chat, log), rotate it in the
  app's **Settings → Credentials → Rotate**, then update `.env`.
