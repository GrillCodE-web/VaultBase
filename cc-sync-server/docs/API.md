# CC Manager Sync Server — API Documentation

**Version:** 2.5.0
**Base URL:** `https://api.eulivehub.com`

## Authentication

Authentication is **per-endpoint**, not global. There are four tiers:

**1. License token (`Authorization: Bearer <license-token>`)** — enforced by the
`requireToken` middleware. Required by:

- `POST /sync/*` (all sync routes)
- `GET /api/bin/:bin`, `POST /api/bin`
- `POST /footprint`, `POST /footprint/check`

```http
Authorization: Bearer <your-license-token>
```

**2. Admin session or HTTP Basic** — enforced by `requireAdmin`. Required by all
routes under `<ADMIN_PATH>/api` and `<ADMIN_PATH>/upload`, and by the admin
static panel.

**3. Server secret (`X-Server-Secret: <SERVER_SECRET>`)** — required only by the
catalog write endpoints `POST /api/catalog/items` and `POST /api/catalog/shops`.

**4. No authentication.** These endpoints are publicly reachable:

- `GET /` (landing page), `GET /favicon.svg`, `GET /health`
- `GET /api/releases`, `GET /releases/*` (static release binaries)
- `POST /activate`, `POST /verify`
- `POST /invite/validate`
- `GET /api/catalog/items`, `GET /api/catalog/shops`
- `GET /version`, `GET /update`, `GET /update/check`
- `GET|POST <ADMIN_PATH>/login`, `POST <ADMIN_PATH>/logout`

Several unauthenticated endpoints are protected by rate limiting instead — see
[Rate Limiting](#rate-limiting).

## Endpoints

### License Activation & Verification

#### Activate License

```http
POST /activate
Content-Type: application/json
```

**Body:**

```json
{ "installation_id": "uuid-here", "activation_key": "KEY-FROM-ADMIN" }
```

**Response:** `200 OK`

```json
{ "token": "license-token-here", "role": "operator" }
```

- `role` is `"admin"` or `"operator"` and comes from the license record.
- The desktop client stores it locally (config `license_role`) and applies it to the
  current user.

#### Verify License

```http
POST /verify
Content-Type: application/json
```

**Body:**

```json
{ "token": "license-token-here" }
```

**Response:** `200 OK`

```json
{ "valid": true, "label": "My Device", "role": "operator" }
```

- Called on startup. If `role` changed on the server, the client updates the local role on
  the next launch. A revoked license returns `{ "valid": false }`.

---

### Health Check

```http
GET /health
```

**Response:** `200 OK`

```json
{ "status": "ok", "uptime": 12345.67, "ts": 1774440000000 }
```

---

### Catalog API

#### Get Items

```http
GET /api/catalog/items?search={query}&page={page}&per_page={per_page}
```

**Parameters:**

| Name       | Type   | Description                            |
| ---------- | ------ | -------------------------------------- |
| `search`   | string | Search query (SQL injection protected) |
| `page`     | number | Page number (default: 1)               |
| `per_page` | number | Items per page (default: 20)           |

**Response:** `200 OK`

```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "per_page": 20,
  "total_pages": 5
}
```

#### Get Shops

```http
GET /api/catalog/shops?search={query}
```

**Response:** `200 OK`

```json
[{ "id": 1, "name": "Shop Name", "domain": "shop.com" }]
```

---

### BIN Cache API

#### Get BIN Info

```http
GET /api/bin/:bin
```

**Parameters:**

| Name  | Type   | Description          |
| ----- | ------ | -------------------- |
| `bin` | string | 6-8 digit BIN number |

**Response:** `200 OK`

```json
{
  "bin": "411111",
  "bank_name": "Chase",
  "card_type": "Visa",
  "card_level": "Classic",
  "country": "US"
}
```

**Response:** `404 Not Found` (if not cached)

#### Save BIN Info

```http
POST /api/bin
Content-Type: application/json
```

**Body:**

```json
{
  "bin": "411111",
  "data": {
    "bank_name": "Chase",
    "card_type": "Visa",
    "card_level": "Classic",
    "country": "US"
  }
}
```

**Response:** `200 OK`

```json
{ "ok": true }
```

---

### Admin API

#### Get Licenses

```http
GET /admin/api/licenses
```

**Response:** `200 OK`

```json
[
  {
    "id": 1,
    "installation_id": "uuid-here",
    "token": "abc12345...xyz89012", // Masked
    "label": "My Device",
    "is_active": 1,
    "role": "operator", // admin | operator
    "created_at": "2026-03-01T00:00:00Z",
    "last_seen": "2026-03-25T12:00:00Z"
  }
]
```

#### Create License

```http
POST /admin/api/licenses
Content-Type: application/json
```

**Body:**

```json
{
  "installation_id": "uuid-here",
  "challenge": "CHALLENGE-CODE",
  "label": "Client X",
  "role": "operator"
}
```

- `role` is optional; defaults to `"operator"`. Accepts `"admin"` or `"operator"`.

**Response:** `200 OK` — `{ "ok": true, "activation_key": "KEY..." }`

#### Update License (label / role)

```http
PATCH /admin/api/licenses/:id
Content-Type: application/json
```

**Body:** `{ "label": "New label" }` and/or `{ "role": "admin" }`

**Response:** `200 OK` — `{ "ok": true }`

#### Rotate Token

```http
POST /admin/api/licenses/:id/rotate-token
```

**Response:** `200 OK`

```json
{
  "new_token": "new-secure-token-here",
  "rotated_at": "2026-03-25T12:00:00Z"
}
```

#### Set Auto-Rotate

```http
POST /admin/api/licenses/:id/set-auto-rotate
Content-Type: application/json
```

**Body:**

```json
{ "enabled": true }
```

**Response:** `200 OK`

```json
{ "ok": true }
```

#### Export Licenses (CSV)

```http
GET /admin/api/licenses/export.csv
Accept: text/csv
```

**Response:** `200 OK`

```csv
installation_id,token,label,is_active,created_at,last_seen
uuid-here,abc12345...xyz89012,My Device,1,2026-03-01,2026-03-25
```

---

### Footprint API

#### Check Footprint

```http
POST /footprint/check
Content-Type: application/json
```

**Body:**

```json
{
  "shop_domain": "shop.com",
  "hash_type": "sha256",
  "hash_value": "abc123..."
}
```

**Response:** `200 OK`

```json
{
  "exists": true,
  "user_token": "encrypted-token"
}
```

#### Save Footprint

```http
POST /footprint
Content-Type: application/json
```

**Body:**

```json
{
  "shop_domain": "shop.com",
  "hash_type": "sha256",
  "hash_value": "abc123...",
  "user_token": "encrypted-token"
}
```

**Response:** `200 OK`

```json
{ "ok": true }
```

---

### Invite Codes API

#### Generate Code

Invite creation is an **admin** operation; it is not exposed on the public
`/invite` router.

```http
POST <ADMIN_PATH>/api/invites
Content-Type: application/json
```

**Body:**

```json
{
  "label": "Beta Access",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

**Response:** `200 OK`

```json
{
  "code": "INVITE-XXXX-XXXX",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

#### Validate Code

```http
POST /invite/validate
Content-Type: application/json
```

**Body:**

```json
{
  "code": "INVITE-XXXX-XXXX"
}
```

**Response:** `200 OK`

```json
{
  "valid": true,
  "label": "Beta Access"
}
```

---

### WebSocket Sync

**Endpoint:** `wss://api.eulivehub.com/ws`

**Authentication:** the token is **not** sent as a subprotocol or header. The
client must send an `auth` message as its first frame; every other message type
is ignored until the server replies with `auth_ok`.

```javascript
const ws = new WebSocket('wss://api.eulivehub.com/ws')
ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: licenseToken }))
```

**Messages:**

| Type              | Direction       | Payload                                                                                 |
| ----------------- | --------------- | --------------------------------------------------------------------------------------- |
| `auth`            | Client → Server | `{ token: string }`                                                                     |
| `auth_ok`         | Server → Client | `{ installation_id, group_id }`                                                         |
| `auth_error`      | Server → Client | `{ error: 'missing_token' \| 'invalid_token' }`                                         |
| `ping` / `pong`   | Bidirectional   | `{}`                                                                                    |
| `full_pull`       | Client → Server | `{}` — requests all cards for the group                                                 |
| `full_data`       | Server → Client | `{ cards: [...], courier_tags: [...] }`                                                 |
| `push`            | Client → Server | `{ cards: [...] }` — max 100 per message                                                |
| `card_update`     | Server → Client | `{ cards, updated_by, updated_at }`                                                     |
| `courier_tag`     | Server → Client | `{ provider, courier_hash, tag, action, updated_by, updated_at }` — FEAT-010, see below |
| `catalog_update`  | Server → Client | `{ ... }`                                                                               |
| `refresh_group`   | Client → Server | `{}`                                                                                    |
| `group_refreshed` | Server → Client | `{ group_id }`                                                                          |
| `member_joined`   | Server → Client | `{ installation_id }`                                                                   |
| `member_left`     | Server → Client | `{ installation_id }`                                                                   |
| `error`           | Server → Client | `{ error: 'not_in_group' \| 'too_many_cards' \| ... }`                                  |

#### Courier Tags (FEAT-010)

Courier tags (e.g. "used under zoro.com") are synced between group members
as **hashes only**: the desktop client sends `provider` + SHA-256 of the
courier identity + tag. Names and addresses never leave the client.

**Push (HTTP):**

```http
POST /sync/courier_tag
Content-Type: application/json
```

**Body:**

```json
{
  "provider": "swat",
  "courier_hash": "9f2c...64-hex",
  "tag": "zoro.com",
  "action": "add"
}
```

- `courier_hash` — SHA-256 hex (64 lowercase chars) of the courier identity.
- `tag` — trimmed, lowercased, 1–100 chars.
- `action` — `"add"` or `"remove"`. Last write wins: upsert by
  `(group_id, provider, courier_hash, tag)`, no history is kept.

**Response:** `200 OK`

```json
{ "ok": true }
```

**Errors:** `400 invalid_courier_tag`, `403 not_found`, `404 not_in_group`,
`500 push_failed`.

**Broadcast:** on a successful push the server emits the `courier_tag` event
(table above) to all group members except the sender, and a socket.io
`courier_tag` event to the `group:<id>` room (browser admin). Reconnecting
clients receive current tags in `full_data.courier_tags` after `full_pull`.

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "invalid_request",
  "message": "Missing required parameter: bin"
}
```

### 401 Unauthorized

```json
{
  "error": "unauthorized",
  "message": "Invalid or expired token"
}
```

### 403 Forbidden

```json
{
  "error": "forbidden",
  "message": "License is not active"
}
```

### 404 Not Found

```json
{
  "error": "not_found",
  "message": "Resource not found"
}
```

### 429 Too Many Requests

```json
{
  "error": "rate_limited",
  "message": "Too many requests. Try again in 60 seconds.",
  "retry_after": 60
}
```

### 500 Internal Server Error

```json
{
  "error": "internal_error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limiting

Rate limiting is applied per-endpoint, not per-router. Only the endpoints listed
below are limited; the catalog, BIN and admin API routes have **no** rate limiter.

| Endpoint                  | Limit   | Window |
| ------------------------- | ------- | ------ |
| `POST /footprint`         | 100 req | 1 min  |
| `POST /footprint/check`   | 10 req  | 1 min  |
| `POST /activate`          | 10 req  | 15 min |
| `POST /verify`            | 60 req  | 15 min |
| `POST /sync/group/join`   | 10 req  | 15 min |
| `POST /sync/group/pair`   | 20 req  | 1 hour |
| `POST <ADMIN_PATH>/login` | 10 req  | 15 min |

The stricter limit on `/footprint/check` is deliberate: it is a cross-user lookup,
so a loose limit would allow enumeration. Requests are keyed by license token when
one is present, otherwise by client IP.

**Headers:** limiters use the standard `RateLimit-*` headers; the legacy
`X-RateLimit-*` headers are disabled.

```http
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 42
```

---

## Security Headers

All responses include:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## Changelog

### v2.5.1 (2026-08-06)

- Added `POST /activate` and `POST /verify` documentation
- Added `role` (admin/operator) to licenses (migration v9); returned by activate/verify
- Added `POST /admin/api/licenses` (create with role) and `PATCH /admin/api/licenses/:id`
  (edit label and/or role)

### v2.2.0 (2026-03-25)

- Added token rotation endpoints
- Added audit logging
- Improved BIN encryption (AES-256-GCM)
- Added rate limiting documentation

### v2.1.0 (2026-03-01)

- Added invite codes API
- Added footprint check endpoint
- Improved error responses

### v2.0.0 (2026-02-01)

- Initial release with catalog, BIN, and admin APIs
