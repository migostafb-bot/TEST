"""Minimal Shopify Admin API client (standard library only).

Credentials come from the environment:
  SHOPIFY_STORE        store handle or full domain (e.g. "city-pharma-2")
  SHOPIFY_ADMIN_TOKEN  Admin API access token from the custom app (shpat_...)
  SHOPIFY_API_VERSION  optional, defaults to API_VERSION below
"""

import json
import os
import ssl
import time
import urllib.error
import urllib.request

API_VERSION = "2025-10"
_USER_AGENT = "city-pharma-tools/0.1"


class ShopifyError(RuntimeError):
    pass


def _ssl_context():
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
        path = os.environ.get(var)
        if path and os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    bundle = "/root/.ccr/ca-bundle.crt"
    if os.path.exists(bundle):
        return ssl.create_default_context(cafile=bundle)
    return ssl.create_default_context()


def shop_domain(store=None):
    store = store or os.environ.get("SHOPIFY_STORE", "")
    store = store.strip().rstrip("/")
    if not store:
        raise ShopifyError("SHOPIFY_STORE is not set (e.g. city-pharma-2)")
    store = store.replace("https://", "").replace("http://", "")
    if store.startswith("admin.shopify.com/store/"):
        store = store.split("/store/", 1)[1].split("/")[0]
    if not store.endswith(".myshopify.com"):
        store = store + ".myshopify.com"
    return store


class Shopify:
    def __init__(self, store=None, token=None, api_version=None):
        self.domain = shop_domain(store)
        self.token = token or os.environ.get("SHOPIFY_ADMIN_TOKEN", "").strip()
        if self.token.startswith("shpss_"):
            raise ShopifyError(
                "That looks like an app client secret (shpss_...), not an Admin "
                "API access token. The client secret only signs the OAuth "
                "handshake and verifies webhook HMACs; the Admin API will reject "
                "it. Get a token starting with shpat_ from the store admin under "
                "Settings > Apps and sales channels > Develop apps > your app > "
                "API credentials, or complete the OAuth flow to obtain one."
            )
        if not self.token:
            raise ShopifyError(
                "SHOPIFY_ADMIN_TOKEN is not set. In the Shopify admin open "
                "Settings > Apps and sales channels > Develop apps > your app > "
                "API credentials, and copy the Admin API access token."
            )
        self.api_version = (
            api_version or os.environ.get("SHOPIFY_API_VERSION") or API_VERSION
        )
        self._ctx = _ssl_context()

    # -- transport ---------------------------------------------------------
    def _request(self, method, url, body=None, retries=4):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("X-Shopify-Access-Token", self.token)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", _USER_AGENT)

        delay = 2
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, context=self._ctx, timeout=60) as resp:
                    raw = resp.read().decode()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:500]
                if exc.code == 401:
                    raise ShopifyError(
                        "401 Unauthorized - the access token was rejected. Check "
                        "SHOPIFY_ADMIN_TOKEN and that it belongs to %s." % self.domain
                    ) from None
                if exc.code == 403:
                    raise ShopifyError(
                        "403 Forbidden - the app is missing a required API scope. "
                        "Grant it in the app's API access settings and reinstall. "
                        "Server said: %s" % detail
                    ) from None
                if exc.code == 404:
                    raise ShopifyError(
                        "404 Not Found - check the store domain (%s) and API "
                        "version (%s)." % (self.domain, self.api_version)
                    ) from None
                if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                    wait = int(exc.headers.get("Retry-After", 0)) or delay
                    time.sleep(wait)
                    delay *= 2
                    continue
                raise ShopifyError("HTTP %s from Shopify: %s" % (exc.code, detail)) from None
            except urllib.error.URLError as exc:
                if attempt < retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise ShopifyError("Network error talking to %s: %s" % (self.domain, exc.reason)) from None

    # -- APIs --------------------------------------------------------------
    def graphql(self, query, variables=None):
        url = "https://%s/admin/api/%s/graphql.json" % (self.domain, self.api_version)
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        result = self._request("POST", url, payload)
        if result.get("errors"):
            raise ShopifyError(json.dumps(result["errors"], indent=2))
        for key, block in (result.get("data") or {}).items():
            if isinstance(block, dict) and block.get("userErrors"):
                raise ShopifyError("%s userErrors: %s" % (key, json.dumps(block["userErrors"])))
        return result.get("data", {})

    def rest(self, path, method="GET", body=None):
        path = path.lstrip("/")
        url = "https://%s/admin/api/%s/%s" % (self.domain, self.api_version, path)
        return self._request(method, url, body)

    def paginate(self, query, variables, path):
        """Yield nodes from a GraphQL connection, following cursors.

        `path` is the dotted path to the connection, e.g. "products".
        The query must accept $cursor and request pageInfo{hasNextPage endCursor}.
        """
        variables = dict(variables or {})
        cursor = None
        while True:
            variables["cursor"] = cursor
            data = self.graphql(query, variables)
            node = data
            for part in path.split("."):
                node = node[part]
            for edge in node.get("edges", []):
                yield edge["node"]
            info = node.get("pageInfo") or {}
            if not info.get("hasNextPage"):
                return
            cursor = info.get("endCursor")
