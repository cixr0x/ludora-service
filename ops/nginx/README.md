# Public Nginx configuration

`ludora.conf` is the tracked source for the public site configuration installed at
`/etc/nginx/sites-available/ludora` on the `ludora` VM.

The site-level gzip directives compress textual responses, including the proxied
JSON API and the static JavaScript and CSS bundles. Already-compressed image formats
are intentionally excluded.

## Production installation

Daily SEO publication requires public service `f975d302e2b0727a83da720aa7fb08a9d914870d`
or a later reviewed compatible release. Its `/api/published-route` resolver reads the
private `routes.json` beside the public directory selected by
`/opt/ludora/ludora-ui/dist`; aliases resolve only to files in that generation.
Missing/removed games, malformed paths and out-of-range catalog/category pages
return 404. New database names cannot create redirect loops to unpublished pages.

For this SEO rollout install only `ludora-app.conf` at
`/etc/nginx/snippets/ludora-app.conf`, using the UI repository's
`ops/seo/Deploy-LudoraSeo.ps1` finalization phase. It holds the same real lock as the
daily refresh, checks the recorded baseline hash, retains the previous snippet,
runs `nginx -t`, reloads and then publishes the validated managed generation. The
site-level configuration remains unchanged. The UI's
`docs/seo-refresh-operations.md` documents exact paths, staged resource evidence,
true-404/canonical checks and rollback. Runtime bundles/manifests/routes must never
be placed inside Nginx's public root.

For a separate site-level configuration change, follow the procedure below.

Before replacing the live file, verify that its SHA-256 checksum matches the
expected deployment baseline. Preserve a timestamped copy under
`/etc/nginx/sites-available/`, install the tracked file as `root:root` with mode
`0644`, run `nginx -t`, and reload Nginx only when validation succeeds.

After reload, verify all of the following:

- Nginx remains active.
- The homepage and `/api/front-page` return HTTP 200.
- Requests with `Accept-Encoding: gzip` receive `Content-Encoding: gzip` and
  `Vary: Accept-Encoding` for HTML, JavaScript, CSS, and JSON.
- WebP, JPEG, and PNG responses are not recompressed.
