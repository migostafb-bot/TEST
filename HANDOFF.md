# Handoff — continuing this project on another machine or account

Everything needed is in this repository. Nothing lives only in a chat.

## What this is

A tool for listing competitor products in the Shopify store
`n4k6ze-uf.myshopify.com` (www.parapharmafr.shop) in French. Give it a
competitor product URL and it creates the product, clones the competitor's
page sections into a theme template, translates everything into French, and
assigns the template to the product.

One command:

```bash
npm run import -- --replace https://competitor.com/products/thing
```

It runs on the local Claude Code subscription — no API key, no per-product
cost. Roughly 3-5 minutes per product.

## Getting set up somewhere new

```bash
git clone https://github.com/migostafb-bot/TEST.git shopify-link
cd shopify-link
git checkout claude/link-shopify-store-qnzneh
npm install
cp .env.example .env
npm run auth        # opens the browser, click Update app
```

`.env` and `.shopify-token.json` are gitignored and do **not** transfer. The
current working values are:

```
SHOPIFY_STORE=n4k6ze-uf.myshopify.com
SHOPIFY_SCOPES=write_products,write_themes,read_themes,read_orders,read_customers,read_inventory,read_locations
SHOPIFY_ALLOW_WRITES=true
SHOPIFY_PRODUCT_STATUS=ACTIVE
SHOPIFY_THEME=                      # empty = the live theme
SHOPIFY_FIXED_TIERS=32.90,49.90,59.90
```

`SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` come from the Shopify app's
Settings → Credentials page. The secret in the original screenshots should be
rotated — treat it as public.

Theme: **PHARMA-clone**, Shrine 1.3.1.

## How it works

| File | Does |
| --- | --- |
| `scripts/import.mjs` | The CLI. Spawns `claude -p` per URL with a fixed prompt and a tool allow-list |
| `scripts/inspect.mjs` | Diagnostic. Reports what the importer can and cannot read on a page. **Costs no Claude usage** — use it first whenever a page imports wrong |
| `src/server.mjs` | MCP server exposing the tools to Claude Code |
| `src/scrape.mjs` | Product data: title, brand, EAN, price, images |
| `src/sections.mjs` | Splits the competitor page into Shopify sections, prunes and scopes their CSS |
| `src/textnodes.mjs` | Pulls translatable strings out of HTML, JSON and JavaScript, and puts translations back |
| `src/clone.mjs` | Orchestrates read → translate → install |
| `src/theme.mjs` | Reads and writes theme files, assigns templates |
| `src/create.mjs` | Creates products, tier discounts, deletes |
| `src/pricing.mjs` | The price ladder |
| `CLAUDE.md` | The listing and translation rules Claude follows |

The design decision worth knowing: **only the strings are translated, never
the markup**. HTML goes in, strings come out, translations go back into the
identical HTML. That is why the layout survives.

## Rules the owner has set

- Translate the whole page faithfully — never reword, shorten or summarise
- Every mention of the USA becomes France, in text, badges and flag emoji
- Reviewer names become French names, US cities become French cities
- Prices are the fixed ladder above, not derived from the competitor
- Products are created ACTIVE, into the live theme
- No product description — the template renders the page
- Inventory is not tracked

## Where it got to

Working: product creation, page cloning, section extraction, CSS pruning and
scoping, French translation including review widgets, the untranslated-English
guard, CTA buttons repointed at the buy box, fixed-tier pricing, automatic
quantity discounts, `--replace`.

**Unverified — the next thing to check.** The last change removed a duplicate
buy box, switched bundle tiers from variants to automatic quantity discounts,
and set inventory untracked. That has not been run against the store yet.
Run an import and confirm:

1. Only **one** quantity selector and **one** add-to-cart button on the page
2. The button is not "ÉPUISÉ" / sold out
3. Adding 2 units charges 49,90 € at checkout, 3 units charges 59,90 €

**Known open items.**

- Some content sits outside Shopify sections (`npm run inspect` reports the
  percentage) and is not imported
- Section text baked into images cannot be translated
- Imported images hotlink to the competitor's CDN; they are not copied into
  Shopify Files
- Imported sections are not editable in the theme customizer — the copy is
  fixed HTML rather than schema settings

## Working method that proved fastest

1. Run `npm run inspect -- <url>` first when something is wrong. It is free
   and it says what the importer can actually see.
2. Fix one thing, push, re-import.
3. Guessing costs more than measuring — every wrong assumption here cost a
   full import cycle.

## Opening message for a new chat

Paste this into a fresh Claude session, after running `git pull`:

```
I'm continuing a project. Read HANDOFF.md and CLAUDE.md in this repo first,
then continue from "Where it got to".

Repo: ~/shopify-link, branch claude/link-shopify-store-qnzneh

The immediate task: the last commit is untested against the store. Run
  npm run import -- --replace https://trygoodgrove.com/products/tart-cherry-extract
then verify on the product page:
  1. only one quantity selector and one add-to-cart button
  2. the button is not "ÉPUISÉ"
  3. 2 units charges 49,90 € at checkout, 3 units charges 59,90 €

Always give me easy numbered steps. Use npm run inspect -- <url> before
guessing — it costs no usage.
```

## If the terminal forgets everything

Switching Claude accounts does not affect this project. The Shopify
connection lives in `.env` and `.shopify-token.json` in this folder, not in
the Claude account. Log out, log in as anyone, and `npm run import` still
works. Only moving to a different computer requires re-running `npm run auth`.
