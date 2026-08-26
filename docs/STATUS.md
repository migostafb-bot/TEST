# Project status

Abandoned-checkout recovery for four French Shopify stores, via Klaviyo.

## Done

- Four Klaviyo accounts created, each connected to its Shopify store with
  onsite tracking enabled.
- Sending domains authenticated and **verified** on all four (e.g.
  `send.pharmafr.shop`, routing type Dynamic).
- Three French email templates deployed to all four accounts, named
  `[Store Name] Abandoned Checkout 1..3`.
- Abandoned-checkout flow created **via the API in all four accounts**, each in
  Draft, each wired to its own `Checkout Started` metric and its own three
  French templates, with the French subject lines from `src/templates.js`:

  | Store | Flow | Trigger metric |
  |-------|------|----------------|
  | Store One   | `Wh7PQn` | `RSjLxj` |
  | Store Two   | `Y7cHut` | `TtJ96p` |
  | Store Three | `S2gKYZ` | `X2dDNn` |
  | Store Four  | `XiVab4` | `Xy2rYJ` |

  Delays 1h / 23h / 2d (so 1h, 24h, 72h cumulative), profile filter excludes
  anyone who placed an order since flow start or was in the flow in the last
  7 days, re-entry 7 days -- all carried over from the original Store 1 flow.

- The **original** Store 1 flow `XVDXis` is superseded. It was never wired to
  the French templates: its three emails used stock Klaviyo drag-and-drop
  templates from 2024-10-22 (47KB `SYSTEM_DRAGGABLE`, English), emails 2 and 3
  shared the subject "Your cart is about to expire.", and the From name was
  `dropalizak2@gmail.com`. It was `live` in that state at the start of the
  session. **Archive or delete `XVDXis`** so it cannot run alongside `Wh7PQn`.

## Next

1. **Archive the old Store 1 flow `XVDXis`** -- see above. Two abandoned-checkout
   flows on the same trigger would both fire.
2. Test with a real abandoned checkout before going live -- confirm the cart
   block renders (product image, title, price) and lands in inbox.
3. Set the four flows live once tested (`PATCH /api/flows/:id` with `status`,
   or the UI). They are all in Draft and send nothing until then.
4. Create the `RETOUR` free-shipping discount code in all four Shopify stores;
   email 3 promises it.
5. Replace the shared From address -- see the sending-domain note below.

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
  logo, so emails show the store name as text with a generic blue button. The
  rendered HTML is currently *byte-identical across all four stores* -- the
  templates carry no per-store branding at all yet.

- **Sending domain (open, deliberate).** All four flows send from
  `mail@pharmafer.shop`, which is Store 1's domain, chosen so the flows could be
  built now. This pools deliverability reputation across four stores and shows
  Store 1's domain to the other stores' customers. Each store should move to its
  own verified domain via `sending.fromEmail` in `config/stores.json`, then
  re-create its flow. Note the domain in use is `pharmafer.shop`, not the
  `send.pharmafr.shop` this file previously claimed.

- **Account settings don't match the French/EUR assumption.** All four accounts
  report `preferred_currency: USD`, `locale: en-US`, timezone
  `Africa/Casablanca`, and an empty `default_sender_email`. Worth fixing before
  going live if the cart block should render euros.

## Environment note

The original session's egress policy blocked `a.klaviyo.com`. **This is fixed**
-- the host now answers from the session directly (401 on an unauthenticated
request, i.e. reachable), so deploys no longer need to be run from the user's
own machine via `dist/deploy-klaviyo.mjs`. Note `developers.klaviyo.com` is
still blocked, so the API reference has to be read outside the session.

## What the API can and cannot do here

Established against the live accounts this session:

- `POST /api/flows/` **creates flows** -- it is stable (no longer beta) from
  revision `2025-10-15`. `src/klaviyo.js` pins `FLOWS_API_REVISION` for this;
  the flow `definition` field is a 400 on the older `2024-10-15` the template
  deploys use.
- Flow definitions are **create-only**. `PATCH /api/flows/:id` accepts `status`
  and rejects `definition` outright ("'definition' is not a valid field"), and
  `/api/flow-messages/:id` is read-only -- PATCH and PUT both 405 on every
  revision tried. **To change a built flow's structure, templates or subjects,
  create a new flow and archive the old one.** That is why `XVDXis` was replaced
  rather than repaired.
- `OPTIONS` `allow` headers are not trustworthy here: `/api/flow-messages/:id`
  advertises `PATCH, PUT` and returns 405 for both.
- Klaviyo **copies** the template into a flow-owned template when a message is
  created, so the `template_id` read back off a flow is not the one sent. The
  copies were verified byte-identical (md5) to the deployed templates.
- `GET /api/sending-domains/` has no readable revision, so verified sending
  domains cannot be listed via the API -- check them in the UI.

## Keys

Not stored in the repo. Per-store private API keys go in `.env` as
`KLAVIYO_STORE1_KEY` .. `KLAVIYO_STORE4_KEY` (gitignored).
