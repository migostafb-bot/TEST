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
5. Report the admin URL and note anything that needs a human decision —
   especially price and any health claims.

## Translation rules

The French listing mirrors the source **faithfully**. This is a translation
job, not a rewrite:

- Keep the same meaning, structure, order, headings, and bullet points.
- Keep the same paragraph and list markup in `descriptionHtml`.
- Do not add, drop, or embellish claims.
- Keep brand names, INCI ingredient names, product line names and dosages
  exactly as they appear — INCI is a standardised Latin nomenclature and is
  never translated.
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
- Writes require `SHOPIFY_ALLOW_WRITES=true` in `.env`.
- Flag any strong medical claim ("treats", "cures", "guarantees") for review —
  French/EU rules on health and cosmetic claims are strict, and the listing is
  the store owner's legal responsibility.
