# PARAPHARMA FR — store assistant

MCP server linking the Shopify store `n4k6ze-uf.myshopify.com`
(www.parapharmafr.shop) to Claude. The store sells in **French**.

## Listing a competitor product

When given a competitor product URL, run this loop:

1. `fetch_competitor_product` with the URL.
2. `check_duplicate` with the EAN (`barcode`) and title. If it is already
   listed, stop and say so — do not create a second listing.
3. Translate the listing into French (see rules below).
4. `create_product` with the French fields. It lands as a **DRAFT**.
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

- **Translate the whole page.** Every section, heading, bullet, table row and
  caption in `description_html` must appear in the French `descriptionHtml`.
  Never shorten, summarise, or drop a section because it seems repetitive or
  marketing-heavy. The French HTML should be roughly as long as the source.
- Keep the same meaning, structure, order, headings, and bullet points.
- Keep the same paragraph and list markup in `descriptionHtml`: the same
  `<p>`, `<ul>`, `<li>`, `<h2>`, `<table>`, `<strong>` structure as the source.
- Do not add, drop, or embellish claims.
- Keep INCI ingredient names and dosages exactly as they appear — INCI is a
  standardised Latin nomenclature and is never translated.
- **Rebrand.** Replace the competitor's product and brand name everywhere with
  the store's own brand from `SHOPIFY_BRAND` (including the ™ symbol if the
  value has one), spelled identically every time — headings, body, alt text,
  reviews, buttons, badges. If `SHOPIFY_BRAND` is unset, keep the source name.
- **Localise, don't just translate.** First names in reviews and testimonials
  become common French first names; US cities, states and references become
  French equivalents; imperial units become metric.
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

Never copy the competitor's price straight across. `reference_price` is the
competitor's price in **their** currency. Surface it, convert it, and ask
what margin to apply, unless the user has already given a rule.

## Safety rails

- Products are created as `DRAFT`. Do not pass `status: ACTIVE`.
- Theme writes need `write_themes` on the token and a theme named in
  `SHOPIFY_THEME`. The template is only used by products assigned to it, so
  writing it does not change any existing page.
- Writes require `SHOPIFY_ALLOW_WRITES=true` in `.env`.
- Flag any strong medical claim ("treats", "cures", "guarantees") for review —
  French/EU rules on health and cosmetic claims are strict, and the listing is
  the store owner's legal responsibility.
