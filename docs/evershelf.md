# EverShelf integration notes

Status: **idea, nothing implemented.** These notes record what was checked so
far, so the decision can be picked up later without starting from scratch.

[EverShelf](https://github.com/dadaloop82/EverShelf) is a self-hosted pantry
manager (PHP 8 + SQLite, Docker, PWA, MIT license). It does more than Pantry
Keeper (inventory, barcodes via Open Food Facts, recipes, shopping lists, Home
Assistant, ntfy alerts). It has no native mobile app.

The API details below come from its README, wiki "API-Reference", and
`docs/openapi.yaml` as read on 2026-10-11. Verify them against a running
instance before building on them.

## Relevant API surface

All calls go to `https://<server>/api/index.php?action=<action>`.

| Action | Method | Notes |
|---|---|---|
| `gemini_identify` | POST | body `{ "image": "data:image/jpeg;base64,..." }`, identifies the product from a photo |
| `gemini_expiry` | POST | same body, reads the expiry date from a photo |
| `search_barcode` / `lookup_barcode` | GET | `?barcode=`, local DB / Open Food Facts |
| `product_save` | POST | create a product (inventory rows reference `product_id`) |
| `inventory_list` | GET | items with `product_name`, `quantity`, `location`, `expiry_date`, `opened` |
| `inventory_add` | POST | `product_id`, `quantity`, `location`, optional `expiry_date` (YYYY-MM-DD) |
| `inventory_update` / `inventory_delete` / `inventory_use` | POST | |

- **Auth:** when the server sets `API_TOKEN`, every request needs an
  `X-API-Token` header (or `?api_token=`). New devices get the token through a
  one-time pairing code (Settings → System → Security).
- **Locations** are a fixed enum (`dispensa`, `frigo`, `freezer`, `altro`),
  while Pantry Keeper has free-form user-named shelves.
- **Response shapes** for the AI actions are not documented. CORS isn't either,
  but it doesn't matter for a native app.
- The server picks its own AI backend (Gemini, OpenAI or Llama).

## How it could fit

1. **EverShelf as a label-reading provider (smallest step).** Add a third
   `aiProvider` value next to `openrouter`/`local`. It would call
   `gemini_identify` / `gemini_expiry` instead of a chat-completions endpoint.
   The app already builds the exact `data:image/jpeg;base64,...` string that
   these actions expect. Settings would need a server URL plus a token, with the
   token stored in SecureStore like the OpenRouter key. The point where this
   plugs in is `chatTarget` / `readLabelPhoto` in `app/index.tsx`, which would
   branch to a non-chat request.
2. **EverShelf as the storage backend (sync).** Replace or mirror AsyncStorage
   items with `inventory_*` calls, mapping shelves to EverShelf locations. That
   mapping is lossy: an upstream PR for custom locations would be needed, or we
   accept the fixed set. `@tanstack/react-query` is already wired in
   `app/_layout.tsx` and fits this use. Reminders could stay local or come from
   EverShelf's own alerts.
3. **Upstream PR.** If (2) is the goal, Pantry Keeper becomes a native
   companion app for EverShelf. Candidate PRs: documented response schemas for
   the AI actions, custom locations, and a pairing flow usable from a native
   app.

## Removed code that might come back

EverShelf ships an OpenAPI spec. The Orval codegen pipeline that generated a
typed React Query client from `openapi.yaml` was removed together with the
unused API server. Restore it from git if a typed client becomes useful:

```sh
git show 8054286:lib/api-spec/orval.config.ts
git checkout 8054286 -- lib/api-spec lib/api-client-react
```

The removed server (`artifacts/api-server`) only proxied OpenRouter. EverShelf
would replace it, so there's no need to restore it.
