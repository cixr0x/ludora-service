# Public Nginx configuration

`ludora.conf` is the tracked source for the public site configuration installed at
`/etc/nginx/sites-available/ludora` on the `ludora` VM.

The site-level gzip directives compress textual responses, including the proxied
JSON API and the static JavaScript and CSS bundles. Already-compressed image formats
are intentionally excluded.

## Production installation

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
