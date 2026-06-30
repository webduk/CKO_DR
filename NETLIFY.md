# Deploying to Netlify

This is a Vite + React single-page app. `npm run build` produces static files in
`dist/` that Netlify serves from its CDN. Build settings, SPA routing, and the
Node version are all configured in [`netlify.toml`](netlify.toml) +
[`.node-version`](.node-version), so a connected repo deploys with no extra setup
in the dashboard — **except the environment variables** (see below).

## Build settings

These come from [`netlify.toml`](netlify.toml); you don't need to type them into
the dashboard, but for reference:

| Setting          | Value           |
| ---------------- | --------------- |
| Build command    | `npm run build` |
| Publish directory | `dist`          |
| Node version     | 22.12.0 (pinned in `.node-version`) |

SPA routing is handled by the `/*  ->  /index.html  200` redirect in
`netlify.toml`, so deep links like `/accounts/report` work on direct load and
refresh.

## Environment variables (required)

The app needs these three vars (see [.env.example](.env.example)). Use the same
values that are in your local `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

Set them in **Site configuration → Environment variables** (scope: Builds, for
the Production — and Deploy Preview, if used — contexts).

> ⚠️ **They must exist at build time.** Vite inlines `VITE_*` into the bundle
> when `npm run build` runs, so a value missing during the build bakes in
> `undefined`. The symptom of getting this wrong: the site loads but shows **no
> data** (`supabase` is `null`) and the map reports a missing key.
>
> `.env` is gitignored, so these values never reach the repo — they MUST be set
> in Netlify or the build bakes in `undefined`. After adding or changing them,
> **trigger a new deploy** (Deploys → Trigger deploy → Deploy site); existing
> builds are not rebuilt retroactively.

These end up in the public client bundle, so only use the Supabase **anon** key
and a Google Maps key restricted to your site's domain.

## Option A — Git-connected (recommended)

1. Push this project to a GitHub/GitLab/Bitbucket repo.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build command / publish dir are read from `netlify.toml` — just confirm them.
4. Add the environment variables above.
5. Deploy. Every push to the production branch redeploys automatically.

## Option B — Netlify CLI (direct upload)

No repo required — builds locally and uploads `dist/`:

```sh
npm install -g netlify-cli   # one-time
npm run build                # produces dist/
netlify deploy --prod        # uploads ./dist (publish dir from netlify.toml)
```

The CLI prompts you to log in and link a site on first use. For this path, set
the env vars **before** `npm run build` (locally in `.env`, or exported in your
shell), since the build is what bakes them in.

## After deploying

Add your Netlify URL (e.g. `https://<site>.netlify.app`) to the allowed origins
in your Supabase project (Auth / API settings) and to the HTTP-referrer
restrictions on the Google Maps API key.
