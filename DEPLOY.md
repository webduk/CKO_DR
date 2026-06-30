# Deploying to Cloudflare Pages

This is a Vite + React single-page app. The build produces static files in
`dist/` that Cloudflare Pages serves from its CDN.

## Build settings

| Setting             | Value              |
| ------------------- | ------------------ |
| Build command       | `npm run build`    |
| Build output dir    | `dist`             |
| Node version        | 20.19+ or 22.12+   |

> Vite 8 requires Node `^20.19.0 || >=22.12.0`. The version is pinned for
> Cloudflare's build environment in [`.node-version`](.node-version) (Cloudflare
> reads `.node-version` / `.nvmrc`). Without it the build image may default to
> an older Node and `npm run build` fails with an engine error before producing
> `dist/`.

SPA routing is configured in [`wrangler.jsonc`](wrangler.jsonc) via
`assets.not_found_handling: "single-page-application"`, which serves
`index.html` for any path that isn't a built asset, so deep links like
`/accounts/report` work on direct load and refresh.

> Note: do **not** use a `_redirects` file with `/* /index.html 200` here.
> The Workers Static Assets validator rejects that rule as an infinite loop —
> use `not_found_handling` instead.

## Environment variables

The app needs these three vars (see [.env.example](.env.example) for the full
list). Use the same values that are in your local `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

Set them where Cloudflare can read them **during the build**:

- **Workers Build** (this project — `wrangler.jsonc` defines a Worker named
  `cko-dr`): **Workers & Pages → `cko-dr` → Settings → Build → Variables and
  secrets**.
- **Pages project** (if set up that way instead): **Settings → Environment
  variables → Production** (and **Preview**, if you use it).

> ⚠️ **They must be build-time variables, not runtime Worker Secrets.** Vite
> inlines `VITE_*` into the bundle at build time, so a value that only exists at
> runtime (a Worker Secret / binding, or a `vars` entry in `wrangler.jsonc`) is
> invisible to `npm run build` and will NOT work. The symptom of getting this
> wrong: the site loads but shows **no data** (`supabase` is `null` because the
> URL/key were `undefined` at build), and the map reports a missing key.
>
> `.env` is gitignored, so these values never reach the repo — they MUST be set
> in the Cloudflare project or the build bakes in `undefined`.

After adding or changing them, **trigger a new deployment** — existing builds
are not rebuilt retroactively.

These end up in the public client bundle, so only use the Supabase **anon** key
and a Google Maps key restricted to your site's domain.

## Option A — Git-connected (recommended)

1. Push this project to a GitHub/GitLab repo.
2. In Cloudflare Pages: **Create a project → Connect to Git**, pick the repo.
3. Enter the build settings from the table above.
4. Add the environment variables.
5. Deploy. Every push to the production branch redeploys automatically.

## Option B — Direct upload via Wrangler (Workers Static Assets)

No repo required — builds locally and uploads `dist/` to the Worker named in
[`wrangler.jsonc`](wrangler.jsonc):

```sh
npm install -D wrangler          # one-time
npm run build                    # produces dist/
npx wrangler deploy              # uploads ./dist per wrangler.jsonc
```

Wrangler will prompt you to log in to Cloudflare on first use. For this path,
set the env vars **before** `npm run build` (locally in `.env`, or exported in
your shell) since the build is what bakes them in.

## After deploying

Add your Pages URL (e.g. `https://<project>.pages.dev`) to the allowed origins
in your Supabase project (Auth / API settings) and to the HTTP-referrer
restrictions on the Google Maps API key.
## test

