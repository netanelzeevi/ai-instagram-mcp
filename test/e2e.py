# End-to-end check of the password sign-in and the MCP OAuth flow against `wrangler dev`.
import base64, hashlib, json, re, secrets, sys, urllib.parse, urllib.request, http.client
BASE = "http://127.0.0.1:8788"
PW = sys.argv[1]
H = http.client.HTTPConnection("127.0.0.1", 8788, timeout=30)

def req(method, path, body=None, headers=None):
    headers = dict(headers or {})
    if isinstance(body, dict):
        body = urllib.parse.urlencode(body); headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    H.request(method, path, body=body, headers=headers)
    r = H.getresponse(); data = r.read().decode("utf-8", "replace")
    return r.status, r.getheader("Location"), r.headers.get_all("Set-Cookie") or [], data

def cookies(set_cookies):
    return "; ".join(c.split(";")[0] for c in set_cookies if not re.search(r"Max-Age=0", c))

out = {}
s, _, _, _ = req("GET", "/dash"); out["dash_redirects_to_login"] = s == 302
s, _, _, body = req("GET", "/dash/login"); out["login_page"] = s == 200 and "DASH_PASSWORD" in body
s, _, _, _ = req("POST", "/dash/login", {"password": "nope"}, {"Origin": BASE}); out["wrong_pw_403"] = s == 403
s, _, _, _ = req("POST", "/dash/login", {"password": PW}, {"Origin": "https://evil.test"}); out["cross_origin_403"] = s == 403
s, loc, sc, _ = req("POST", "/dash/login", {"password": PW}, {"Origin": BASE}); out["right_pw_302"] = s == 302 and loc == "/dash"
s, _, _, body = req("GET", "/dash", headers={"Cookie": cookies(sc)}); out["dash_200"] = s == 200 and "הגדרות Meta" in body and "/privacy" in body

# MCP OAuth: register, authorize with PKCE, consent with password, token, then call the MCP endpoint.
redirect = "http://127.0.0.1:9999/cb"
s, _, _, body = req("POST", "/register", json.dumps({"client_name": "E2E", "redirect_uris": [redirect], "token_endpoint_auth_method": "none"}), {"Content-Type": "application/json"})
client = json.loads(body); out["register"] = s in (200, 201) and "client_id" in client
verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
q = urllib.parse.urlencode({"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect, "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz", "resource": BASE + "/mcp"})
s, _, sc, body = req("GET", "/authorize?" + q)
handle = re.search(r'name="handle" value="([^"]+)"', body)
out["consent_page"] = s == 200 and bool(handle) and 'type="password"' in body
h = handle.group(1).replace("&#45;", "-") if handle else ""
import html; h = html.unescape(h)
ck = cookies(sc)
s, _, _, _ = req("POST", "/authorize", {"handle": h, "decision": "approve", "password": "wrong"}, {"Cookie": ck, "Origin": BASE})
out["consent_wrong_pw_403"] = s == 403
s, loc, sc2, _ = req("POST", "/authorize", {"handle": h, "decision": "approve", "password": PW}, {"Cookie": ck, "Origin": BASE})
out["consent_right_pw_redirects"] = s == 302 and bool(loc) and loc.startswith(redirect) and "code=" in loc and "state=xyz" in loc
code = urllib.parse.parse_qs(urllib.parse.urlparse(loc or "").query).get("code", [""])[0]
s, _, _, body = req("POST", "/token", {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect, "client_id": client["client_id"], "code_verifier": verifier, "resource": BASE + "/mcp"})
tok = json.loads(body) if body.startswith("{") else {}
out["token"] = s == 200 and "access_token" in tok
mcp_h = {"Authorization": "Bearer " + tok.get("access_token", ""), "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
s, _, _, body = req("POST", "/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1"}}}), mcp_h)
out["mcp_initialize"] = s == 200
s, _, _, body = req("POST", "/mcp", json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}), mcp_h)
m = re.search(r"\{.*\}", body, re.S); tools = json.loads(m.group(0))["result"]["tools"] if m else []
out["mcp_16_tools"] = len(tools) == 16
s, _, _, body = req("POST", "/mcp", json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "ig_accounts", "arguments": {}}}), mcp_h)
out["mcp_tool_call"] = s == 200 and "[]" in body
s, _, _, _ = req("POST", "/mcp", json.dumps({"jsonrpc": "2.0", "id": 4, "method": "tools/list", "params": {}}), {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
out["mcp_without_token_401"] = s == 401
for k in ("/privacy", "/terms"):
    s, _, _, _ = req("GET", k); out[k] = s == 200
print(json.dumps(out, indent=1)); print("ALL", all(out.values()))
