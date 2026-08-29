#!/usr/bin/env python3
"""Command line access to the City Pharma Shopify store.

Usage:
  python3 shopify/cli.py check                 verify credentials and scopes
  python3 shopify/cli.py versions              list supported API versions
  python3 shopify/cli.py products [--limit N]  list products
  python3 shopify/cli.py inventory [--limit N] list variants low on stock
  python3 shopify/cli.py orders [--limit N]    list recent orders
  python3 shopify/cli.py graphql <file|->      run an arbitrary GraphQL query
"""

import argparse
import json
import sys

from client import Shopify, ShopifyError

SHOP_QUERY = """
{
  shop { name myshopifyDomain email currencyCode plan { displayName } }
}
"""

PRODUCTS_QUERY = """
query($cursor: String) {
  products(first: 50, after: $cursor, sortKey: TITLE) {
    edges { node {
      id title status totalInventory vendor productType
      priceRangeV2 { minVariantPrice { amount currencyCode } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

VARIANTS_QUERY = """
query($cursor: String) {
  productVariants(first: 50, after: $cursor) {
    edges { node {
      id title sku inventoryQuantity
      product { title status }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 25, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    edges { node {
      name createdAt displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { displayName }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
"""


def take(iterable, limit):
    for i, item in enumerate(iterable):
        if limit and i >= limit:
            return
        yield item


def cmd_check(api, args):
    data = api.graphql(SHOP_QUERY)["shop"]
    print("Connected to %s" % data["myshopifyDomain"])
    print("  name     : %s" % data["name"])
    print("  email    : %s" % data.get("email", "-"))
    print("  currency : %s" % data.get("currencyCode", "-"))
    print("  plan     : %s" % (data.get("plan") or {}).get("displayName", "-"))
    print("  api      : %s" % api.api_version)
    scopes = api.rest("oauth/access_scopes.json").get("access_scopes", [])
    print("  scopes   : %s" % ", ".join(sorted(s["handle"] for s in scopes)))


def cmd_versions(api, args):
    for v in api.rest("../../api_versions.json").get("api_versions", []):
        flag = " (current default)" if v["handle"] == api.api_version else ""
        print("%s  %s%s" % (v["handle"], v["display_name"], flag))


def cmd_products(api, args):
    rows = take(api.paginate(PRODUCTS_QUERY, {}, "products"), args.limit)
    for p in rows:
        price = p["priceRangeV2"]["minVariantPrice"]
        print("%-45s %-8s stock=%-6s from %s %s" % (
            p["title"][:45], p["status"], p["totalInventory"],
            price["amount"], price["currencyCode"]))


def cmd_inventory(api, args):
    rows = take(api.paginate(VARIANTS_QUERY, {}, "productVariants"), args.limit)
    low = [v for v in rows if (v["inventoryQuantity"] or 0) <= args.threshold]
    low.sort(key=lambda v: v["inventoryQuantity"] or 0)
    for v in low:
        print("%-40s %-16s qty=%s" % (
            v["product"]["title"][:40], v["sku"] or "-", v["inventoryQuantity"]))
    print("\n%d variant(s) at or below %d." % (len(low), args.threshold))


def cmd_orders(api, args):
    rows = take(api.paginate(ORDERS_QUERY, {}, "orders"), args.limit)
    for o in rows:
        money = o["currentTotalPriceSet"]["shopMoney"]
        print("%-10s %-20s %-10s %-12s %s %s" % (
            o["name"], o["createdAt"][:19], o["displayFinancialStatus"],
            o["displayFulfillmentStatus"] or "-", money["amount"], money["currencyCode"]))


def cmd_graphql(api, args):
    query = sys.stdin.read() if args.source == "-" else open(args.source).read()
    print(json.dumps(api.graphql(query), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="verify credentials and show granted scopes")
    sub.add_parser("versions", help="list API versions the store supports")

    p = sub.add_parser("products", help="list products")
    p.add_argument("--limit", type=int, default=50)

    p = sub.add_parser("inventory", help="list variants low on stock")
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--threshold", type=int, default=5)

    p = sub.add_parser("orders", help="list recent orders")
    p.add_argument("--limit", type=int, default=25)

    p = sub.add_parser("graphql", help="run a GraphQL query from a file or stdin")
    p.add_argument("source", help="path to a .graphql file, or - for stdin")

    args = parser.parse_args()
    handler = globals()["cmd_" + args.command]
    try:
        handler(Shopify(), args)
    except ShopifyError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
