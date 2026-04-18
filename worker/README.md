# Contact worker

Cloudflare Worker that receives contact-form POSTs from
`https://luhadiagarvit.me/contact`, validates a Turnstile token, and sends
the message to your inbox via Cloudflare Email Routing's `send_email`
binding — no third-party mailer.

## One-time setup

### 1. Email Routing destination (required)

The recipient address must be a **verified destination** in Email Routing.

1. `dash.cloudflare.com` → zone `luhadiagarvit.me` → **Email → Email Routing → Destination addresses**.
2. **Add destination**: `garvit.luhadia@un.org`.
3. Check that inbox for a verification email; click the confirm link.

Outbound sends from the Worker will only deliver to addresses verified
here. This is Cloudflare's anti-abuse guard — not a limitation for
personal forms.

### 2. Turnstile (free CAPTCHA)

Turnstile is **account-level**, not zone-level. In the dashboard sidebar
click your **account name** (top-left) to leave the zone view.

1. Account sidebar → **Turnstile** → **Add widget**.
2. Widget name: `luhadiagarvit.me contact`. Domain: `luhadiagarvit.me`.
   Mode: **Managed**.
3. Copy the **Site Key** into `src/site.config.ts` (the
   `turnstileSiteKey` constant).
4. Copy the **Secret Key** — you'll paste it in step 4 below.

### 3. Install wrangler and dependencies

```sh
cd worker
pnpm install
pnpm dlx wrangler login
```

### 4. Set the Turnstile secret

```sh
pnpm dlx wrangler secret put TURNSTILE_SECRET_KEY
# paste the Turnstile Secret Key from step 2
```

### 5. Deploy

```sh
pnpm run deploy
```

This pushes the Worker and binds it to the route
`luhadiagarvit.me/api/contact`. First deploy may take ~30 s for the
route to propagate.

## Local dev

```sh
pnpm run dev            # http://localhost:8787
pnpm run tail           # stream production logs
```

Note: `send_email` does **not** work in `wrangler dev` — it logs the
email instead of sending. Real sends only happen on deployed Workers.

## Environment

| Name | Type | Where set |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | Secret | `wrangler secret put` |
| `TO_EMAIL` | Var | `wrangler.jsonc` (`garvit.luhadia@un.org`) |
| `FROM_EMAIL` | Var | `wrangler.jsonc` (`form@luhadiagarvit.me`) |
| `MAIL` | Binding | `wrangler.jsonc` `send_email` block, destination pinned to `garvit.luhadia@un.org` |

## Verification

```sh
# OPTIONS preflight
curl -X OPTIONS -i https://luhadiagarvit.me/api/contact

# Missing captcha → 400
curl -X POST https://luhadiagarvit.me/api/contact \
  -d "name=Test" -d "email=t@example.com" -d "message=hi"
```

End-to-end test: submit the real form at
`https://luhadiagarvit.me/contact` and check
`garvit.luhadia@un.org`.
