# PARAPHARMA FR — store assistant

MCP server linking the Shopify store `n4k6ze-uf.myshopify.com`
(www.parapharmafr.shop) to Claude. The store sells in **French**.

## Listing a competitor product

When given a competitor product URL, run this loop:

1. `fetch_competitor_product` with the URL.
2. `check_duplicate` with the EAN (`barcode`) and title. If it is already
   listed, stop and say so — do not create a second listing.
3. Translate the product's own fields into French — title, handle, SEO,
   product type, tags (see rules below).
4. `create_product` with those French fields, and **no `descriptionHtml`**. The
   imported template renders the page sections, so the description field is
   never shown; filling it in wastes a translation pass and leaves a second,
   divergent copy of the page to maintain. The page copy comes from steps 5-7.
5. `read_competitor_page` for the same URL — it returns every string from the
   page sections below the buy box.
6. Translate that list into French. Return exactly one French string per source
   string, same order, same count. Strings are page fragments and some are split
   mid-sentence by markup: translate each in place so the pieces read correctly
   when joined. Never merge, split, drop or reorder them.
7. `install_product_page` with those translations, the product, and
   `templateName` set to the French product title. This writes a theme section
   and a `product.<suffix>.json` template, and assigns it to the product.
   It also repoints every imported call-to-action button at this store's buy
   box, so they scroll to the quantity selector instead of the competitor.
   Check the returned `sections` count matches what `read_competitor_page`
   reported, and report `remaining_english` if it is not empty.
8. Report the admin URL and note anything that needs a human decision —
   especially price and any health claims.

## Translation rules

The French listing mirrors the source **faithfully**. This is a translation
job, not a rewrite:

- **Translate the whole page.** Every string returned by
  `read_competitor_page` gets a French counterpart — every section, heading,
  bullet, table row and caption. Never shorten, summarise, or drop one because
  it seems repetitive or marketing-heavy.
- Keep the same meaning, structure, order, headings, and bullet points.
- Do not add, drop, or embellish claims.
- Keep INCI ingredient names and dosages exactly as they appear — INCI is a
  standardised Latin nomenclature and is never translated.
- **Rebrand.** Replace the competitor's product and brand name everywhere with
  the store's own brand from `SHOPIFY_BRAND` (including the ™ symbol if the
  value has one), spelled identically every time — headings, body, alt text,
  reviews, buttons, badges. If `SHOPIFY_BRAND` is unset, keep the source name.
- **Localise, don't just translate.** Reviewer and testimonial names become
  common French names — first name and initial in the same shape as the source
  (`Patricia H.` → `Sylvie H.`, `Melissa T.` → `Céline T.`). US cities and
  states become French cities. Imperial units become metric. A US flag emoji is
  replaced or dropped.
- **Never reword. Translate the sentence and swap the country.** Keep the exact
  same sentence structure and length; only the language and the country change.
  "Certified USA Facilities" → "Établissements certifiés en France";
  "Made in the USA" → "Fabriqué en France". Do not drop the country, do not
  soften it, do not replace it with a neutral phrase. Every mention of the US —
  in text, badges, alt text and flag emoji — becomes France.
  List every origin claim you changed on the CLAIMS line, so the store owner
  can see what the listing now asserts about where the product is made.
- **Money in French format:** `39,99 €` — comma decimal, space before the
  euro sign. Convert the competitor's currency rather than copying the number.
- **Nothing stays in English.** Check buttons, badges, labels, `alt` text,
  `title` and `aria-label`. `install_product_page` reports anything it still
  finds in `remaining_english` — if that list is not empty, say so.
- Use standard French parapharmacy register (`peau sensible`, `application`,
  `soin`, `flacon`, `tube`), and vouvoiement.
- Convert units to metric if the source is imperial.
- `handle` is the French title, lowercase, hyphenated, unaccented.
- `seoTitle` ≤ 60 chars, `seoDescription` ≤ 155 chars, both French.

## Pricing

If `SHOPIFY_FIXED_TIERS` is set, the store's prices are fixed — `compute_price`
returns that ladder and the competitor's price is ignored. Pass every tier to
`create_product` as `bundles`, one variant each.

Otherwise, never copy the competitor's price across. Call `compute_price` with the
competitor's `reference_price` and `reference_currency`; it applies the store's
rule from `.env` — exchange rate, `SHOPIFY_MARGIN_PERCENT`, and the price
ending — and returns the euro price to pass to `create_product`. Do the
arithmetic with that tool, never by hand.

## Safety rails

- Use the status the run asks for: `SHOPIFY_PRODUCT_STATUS` decides `ACTIVE` or
  `DRAFT`, and the import prompt names it explicitly. Do not override it.
- An `ACTIVE` product must have a price. `create_product` refuses to publish one
  priced at 0, because a live product at 0,00 € can be bought for nothing.
- Theme writes need `write_themes` on the token and a theme named in
  `SHOPIFY_THEME`. The template is only used by products assigned to it, so
  writing it does not change any existing page.
- Writes require `SHOPIFY_ALLOW_WRITES=true` in `.env`.
- Flag any strong medical claim ("treats", "cures", "guarantees") for review —
  French/EU rules on health and cosmetic claims are strict, and the listing is
  the store owner's legal responsibility.
