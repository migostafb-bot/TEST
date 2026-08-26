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
3. Set Store 1's flow live, then clone it to stores 2-4:

   ```
   npm run deploy store2                        # templates first
   node src/deploy-flow.js --from store1 --to store2,store3,store4
   node src/deploy-flow.js --from store1 --to store2,store3,store4 --confirm
   ```

   Clone only *after* steps 1-2, or all three copies inherit Store 1's
   unfinished emails.
4. Create the `RETOUR` free-shipping discount code in all four Shopify stores;
   email 3 promises it.

## Open questions

- ~~**Can flows be created via the Klaviyo API?**~~ **Yes.** `POST /api/flows/`
  exists and takes a whole flow definition. Two caveats: it is a beta endpoint
  behind the `.pre` revision (`2024-10-15.pre`, not the stable revision the
  template deploys use), and there is no way to author a definition from
  scratch in practice -- you build one flow in the UI, read it back with
  `GET /api/flows/:id?additional-fields[flow]=definition`, and post modified
  copies. Store 1's flow is that source. `src/deploy-flow.js` does the copy.
  Created flows land in **Draft**, so nothing goes live by accident.
  Unverified until a key is available: whether the endpoint has since gone GA
  on a stable revision, and the exact definition shape (the retargeting logic
  is tested against a synthetic definition only).
- **Branding.** `config/stores.json` still holds placeholder colors and no
  logo, so emails show the store name as text with a generic blue button.

## Environment note

The original session's egress policy blocked `a.klaviyo.com`. **This is fixed**
-- the host now answers from the session directly (401 on an unauthenticated
request, i.e. reachable), so deploys no longer need to be run from the user's
own machine via `dist/deploy-klaviyo.mjs`. Note `developers.klaviyo.com` is
still blocked, so the API reference has to be read outside the session.

## Keys

Not stored in the repo. Per-store private API keys go in `.env` as
`KLAVIYO_STORE1_KEY` .. `KLAVIYO_STORE4_KEY` (gitignored).
