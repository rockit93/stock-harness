#!/usr/bin/env python3
"""Small dependency-free client for the Stock Harness Node API."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def request(base, method, path, token=None, body=None, stream=False):
    url = base.rstrip("/") + "/" + path.lstrip("/")
    headers = {"accept": "application/x-ndjson" if stream else "application/json"}
    data = None
    if token:
        headers["x-jwt-token"] = token
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    with urllib.request.urlopen(req, timeout=60) as response:
        if stream:
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if line:
                    print(line, flush=True)
            return None
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def main():
    parser = argparse.ArgumentParser(description="Call the Stock Harness API")
    parser.add_argument("method")
    parser.add_argument("path")
    parser.add_argument("--base", default=os.getenv("STOCK_HARNESS_API_BASE", "http://127.0.0.1:8787"))
    parser.add_argument("--json", dest="json_body", help="JSON request body")
    parser.add_argument("--token-env", default="STOCK_HARNESS_TOKEN", help="Environment variable containing the JWT")
    parser.add_argument("--login", action="store_true", help="Log in using STOCK_HARNESS_USERNAME/PASSWORD first")
    parser.add_argument("--stream", action="store_true", help="Print NDJSON response events as they arrive")
    args = parser.parse_args()

    token = os.getenv(args.token_env, "")
    try:
        if args.login and not token:
            username = os.getenv("STOCK_HARNESS_USERNAME")
            password = os.getenv("STOCK_HARNESS_PASSWORD")
            if not username or not password:
                raise ValueError("--login requires STOCK_HARNESS_USERNAME and STOCK_HARNESS_PASSWORD")
            login = request(args.base, "POST", "/auth/login", body={"username": username, "password": password})
            token = (login or {}).get("token") or (login or {}).get("accessToken") or ""
            if not token:
                raise ValueError("Login succeeded but the response did not contain a token")

        body = json.loads(args.json_body) if args.json_body else None
        result = request(args.base, args.method, args.path, token=token, body=body, stream=args.stream)
        if not args.stream:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(json.dumps({"status": error.code, "error": detail}, ensure_ascii=False), file=sys.stderr)
        return 1
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
