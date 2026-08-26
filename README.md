# Klaviyo Abandoned-Checkout Recovery

Three-email recovery sequence, deployed to Klaviyo via API. Built to run across
four Shopify stores from one codebase.

## The sequence

| # | Timing | Angle | Why |
|---|--------|-------|-----|
| 1 | +1 hour | Plain reminder, no discount | Highest recovery rate, costs no margin |
| 2 | +24 hours | Trust objections (returns, security, support) | Targets hesitation, not price |
| 3 | +72 hours | Incentive (free shipping first) | Last resort -- never discount a sale you'd have won |

## Setup

1. Add each store's private API key to the environment (Templates: full access):

   ```
   KLAVIYO_STORE1_KEY=pk_...
   ```

2. Fill in the store's branding in `config/stores.json` -- logo URL, colors,
   incentive code.

3. Preview locally, then deploy:

   ```
   npm run preview        # writes preview/*.html, open in a browser
   npm run deploy:dry     # lists what would change
   npm run deploy store1  # creates or updates templates in Klaviyo
   ```

Deploy matches templates by name, so re-running updates in place rather than
creating duplicates.

## Adding the other stores

Add an entry to `config/stores.json` with its own `apiKeyEnv`, then
`npm run deploy store2`. Templates stay shared; only branding differs.

## Still done by hand in Klaviyo

The API does not cover these:

- **Sending domain authentication** -- DNS records at your registrar. Decides
  inbox vs. spam; do it before the first send.
- **Flow wiring** -- drop the three templates into an Abandoned Checkout flow at
  1h / 24h / 72h.
- **Setting the flow live** -- Klaviyo requires a human.

## Liquid variables

Templates use Klaviyo's Shopify `Started Checkout` event:
`event.extra.checkout_url`, `event.extra.line_items` (`title`, `line_price`,
`image_url`). Confirm these against a real event payload in your account before
going live -- the Shopify payload shape varies by integration version, and a
wrong variable renders as an empty block rather than an error.
