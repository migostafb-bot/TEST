#!/usr/bin/env python3
"""Complete Shopify's OAuth flow locally and print an Admin API access token.

The app's Client ID and Secret (Partners dashboard > App settings > Credentials)
exchange for a per-store access token. Set:

  SHOPIFY_CLIENT_ID      the app's Client ID
  SHOPIFY_CLIENT_SECRET  the app's Secret (shpss_...)

then run:

  python3 shopify/oauth.py --store n4k6ze-uf --scopes read_products,read_orders

A browser window opens for you to approve the install. The token is printed
once, to stdout only; it is never written to disk.

The app's "Allowed redirection URL(s)" must contain the redirect this script
uses (default http://localhost:3456/callback).
"""

import argparse
import hashlib
import hmac
import http.server
import json
import os
import secrets
import ssl
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from client import shop_domain, _ssl_context

DEFAULT_PORT = 3456
DEFAULT_SCOPES = "read_products,read_orders,read_inventory"

_result = {}
_done = threading.Event()


def verify_hmac(query, secret):
    """Constant-time check of Shopify's HMAC over the callback query string."""
    params = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
    received = params.pop("hmac", "")
    params.pop("signature", None)
    message = "&".join(
        "%s=%s" % (k, params[k]) for k in sorted(params)
    )
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received), params


class Handler(http.server.BaseHTTPRequestHandler):
    state = None
    secret = None
    expected_shop = None

    def log_message(self, *args):
        pass  # keep the console clean

    def _reply(self, code, text):
        body = ("<html><body style='font:16px system-ui;padding:3rem'>%s</body></html>"
                % text).encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self._reply(404, "Not found.")
            return

        ok, params = verify_hmac(parsed.query, Handler.secret)
        if not ok:
            _result["error"] = "HMAC verification failed - the callback was not signed by Shopify."
        elif not secrets.compare_digest(params.get("state", ""), Handler.state):
            _result["error"] = "State mismatch - possible CSRF; the request was discarded."
        elif params.get("shop") != Handler.expected_shop:
            _result["error"] = (
                "Callback was for %r, expected %r - refusing to send the code there."
                % (params.get("shop"), Handler.expected_shop))
        elif not params.get("code"):
            _result["error"] = "No authorization code in the callback."
        else:
            _result["code"] = params["code"]

        if "error" in _result:
            self._reply(400, "<h2>Authorization failed</h2><p>%s</p>"
                             "<p>Return to your terminal.</p>" % _result["error"])
        else:
            self._reply(200, "<h2>Authorized</h2><p>You can close this tab and "
                             "return to your terminal.</p>")
        _done.set()


def exchange(domain, client_id, client_secret, code):
    url = "https://%s/admin/oauth/access_token" % domain
    body = json.dumps({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, context=_ssl_context(), timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        raise SystemExit("Token exchange failed (HTTP %s): %s" % (exc.code, detail))


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--store", default=os.environ.get("SHOPIFY_STORE"),
                        help="store handle, e.g. n4k6ze-uf")
    parser.add_argument("--scopes", default=DEFAULT_SCOPES,
                        help="comma-separated scopes (default: %s)" % DEFAULT_SCOPES)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    client_id = os.environ.get("SHOPIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SHOPIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise SystemExit(
            "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from the app's\n"
            "Partners dashboard > App settings > Credentials.")
    if not args.store:
        raise SystemExit("Pass --store or set SHOPIFY_STORE.")

    domain = shop_domain(args.store)
    redirect_uri = "http://localhost:%d/callback" % args.port
    state = secrets.token_urlsafe(24)

    Handler.state = state
    Handler.secret = client_secret
    Handler.expected_shop = domain

    server = http.server.HTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    authorize = "https://%s/admin/oauth/authorize?%s" % (domain, urllib.parse.urlencode({
        "client_id": client_id,
        "scope": args.scopes,
        "redirect_uri": redirect_uri,
        "state": state,
    }))

    print("Listening on %s" % redirect_uri)
    print("\nApprove the install here (opening your browser):\n\n  %s\n" % authorize)
    try:
        webbrowser.open(authorize)
    except Exception:
        pass

    print("Waiting for the callback... (Ctrl-C to abort)")
    try:
        if not _done.wait(timeout=300):
            raise SystemExit("Timed out after 5 minutes with no callback.")
    except KeyboardInterrupt:
        raise SystemExit("Aborted.")
    finally:
        server.shutdown()

    if "error" in _result:
        raise SystemExit("error: %s" % _result["error"])

    payload = exchange(domain, client_id, client_secret, _result["code"])
    token = payload.get("access_token")
    if not token:
        raise SystemExit("No access_token in the response: %s" % json.dumps(payload))

    print("\nGranted scopes: %s" % payload.get("scope", "?"))
    print("\nRun this to use it:\n")
    print("  export SHOPIFY_STORE=%s" % args.store)
    print("  export SHOPIFY_ADMIN_TOKEN=%s" % token)
    print("\n  python3 shopify/cli.py check")


if __name__ == "__main__":
    main()
