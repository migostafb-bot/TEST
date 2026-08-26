# Project status

Abandoned-checkout recovery for four French Shopify stores, via Klaviyo.

## Done

- Four Klaviyo accounts created, each connected to its Shopify store with
  onsite tracking enabled.
- Sending domains authenticated and **verified** on all four (e.g.
  `send.pharmafr.shop`, routing type Dynamic).
- Three French email templates deployed to all four accounts, named
  `[Store Name] Abandoned Checkout 1..3`.
- Store 1 flow partly built in the Klaviyo UI: trigger `Checkout Started`,
  SMS branch and conditional split removed, delays set to 1h / 23h / 48h,
  three email placeholders in place.

## Next

1. Load the saved templates into Store 1's three flow emails, set subjects,
   confirm the From address uses the verified domain.
2. Test with a real abandoned checkout before going live -- confirm the cart
   block renders (product image, title, price in euros) and lands in inbox.
3. Set Store 1's flow live, then repeat for stores 2-4.
4. Create the `RETOUR` free-shipping discount code in all four Shopify stores;
   email 3 promises it.

## Open questions

- **Can flows be created via the Klaviyo API?** The flow builder is a UI tool
  and the API is limited here. Worth probing `/api/flows/` with a Flows-scoped
  key before assuming stores 2-4 must be built by hand.
- **Branding.** `config/stores.json` still holds placeholder colors and no
  logo, so emails show the store name as text with a generic blue button.

## Environment note

The original session's egress policy blocked `a.klaviyo.com`, so every deploy
was run from the user's own machine via `dist/deploy-klaviyo.mjs`. A new
environment allowing that host removes the need for that workaround.

## Keys

Not stored in the repo. Per-store private API keys go in `.env` as
`KLAVIYO_STORE1_KEY` .. `KLAVIYO_STORE4_KEY` (gitignored).
