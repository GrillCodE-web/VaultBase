# CC Manager Sync Server — API Documentation

**Version:** 2.2.0
**Base URL:** `https://api.eulivehub.com`

## Authentication

All API endpoints (except `/api/health`) require Bearer token authentication:

```http
Authorization: Bearer <your-license-token>
```

## Endpoints

### Health Check

```http
GET /api/health
```

**Response:** `200 OK`

```json
{ "status": "ok", "timestamp": "2026-03-25T12:00:00Z" }
```

---

### Catalog API

#### Get Items

```http
GET /api/catalog/items?search={query}&page={page}&per_page={per_page}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `search` | string | Search query (SQL injection protected) |
| `page` | number | Page number (default: 1) |
| `per_page` | number | Items per page (default: 20) |

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
| Name | Type | Description |
|------|------|-------------|
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
    "created_at": "2026-03-01T00:00:00Z",
    "last_seen": "2026-03-25T12:00:00Z"
  }
]
```

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
GET /admin/api/licenses/export
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
POST /api/footprint/check
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
POST /api/footprint
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

```http
POST /api/invite/generate
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
POST /api/invite/validate
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

**Authentication:**

```javascript
const ws = new WebSocket('wss://api.eulivehub.com/ws', licenseToken)
```

**Events:**

| Event           | Direction       | Payload                                           |
| --------------- | --------------- | ------------------------------------------------- |
| `sync_request`  | Client → Server | `{ type: 'cards', since: timestamp }`             |
| `sync_response` | Server → Client | `{ type: 'cards', items: [...] }`                 |
| `sync_update`   | Server → Client | `{ type: 'card', action: 'update', data: {...} }` |
| `heartbeat`     | Bidirectional   | `{ timestamp: number }`                           |

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

| Endpoint           | Limit   | Window |
| ------------------ | ------- | ------ |
| `/api/catalog/*`   | 100 req | 1 min  |
| `/api/bin/*`       | 30 req  | 1 min  |
| `/api/footprint/*` | 50 req  | 1 min  |
| `/admin/api/*`     | 20 req  | 1 min  |

**Headers:**

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1679745600
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
