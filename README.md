# TEST

Tools for working with the City Pharma Shopify store (`city-pharma-2`) through
an existing custom (dev) app's Admin API.

## Setup

1. In the Shopify admin, open **Settings > Apps and sales channels > Develop
   apps > _your app_ > API credentials** and copy the **Admin API access
   token** (`shpat_...`). It is shown once; regenerate it if you no longer have
   it.
2. On the same app, under **API access**, confirm the scopes you need are
   granted — `read_products`, `read_inventory`, `read_orders`, plus any
   `write_*` scopes if you want the tools to make changes. Reinstall the app
   after changing scopes.
3. Export the credentials:

   ```bash
   export SHOPIFY_STORE=city-pharma-2
   export SHOPIFY_ADMIN_TOKEN=shpat_...
   ```

   Or copy `shopify/.env.example` to `.env` and source it. `.env` is
   gitignored — keep the token out of version control.

## Usage

```bash
python3 shopify/cli.py check                    # verify the token, print granted scopes
python3 shopify/cli.py versions                 # API versions this store supports
python3 shopify/cli.py products --limit 100
python3 shopify/cli.py orders --limit 25
python3 shopify/cli.py inventory --threshold 5
python3 shopify/cli.py graphql query.graphql    # or - to read stdin
```

Run `check` first — it fails with a specific message for a bad token (401) or a
missing scope (403).

Python 3.9+; standard library only, no dependencies.

## Using it from code

```python
import sys; sys.path.insert(0, "shopify")
from client import Shopify

api = Shopify()
print(api.graphql("{ shop { name } }"))
print(api.rest("products/count.json"))

for product in api.paginate(QUERY, {}, "products"):   # follows cursors
    ...
```

## Network access

This repository's Claude Code environment blocks outbound connections to
`*.myshopify.com` (the agent proxy answers `403` to `CONNECT`). The tools here
therefore cannot reach the store from inside a Claude Code web session — run
them from your own machine or CI, or have the environment's network policy
updated to allow `city-pharma-2.myshopify.com` before running them here.
