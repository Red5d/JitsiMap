# Runtime maps (mounted read-only into the app container)

Drop Tiled maps here to serve them **without rebuilding the image**:

1. Add `<id>.tmj` (plus any tileset PNGs under `tilesets/` — paths in the
   `.tmj` are relative to `/maps/`, so `tilesets/my-sheet.png` lands in
   `maps-extra/tilesets/my-sheet.png`).
2. Validate first: `npm run validate:maps -- maps-extra/<id>.tmj`
3. Join with `http(s)://<app-host>/s/<space>?map=<id>` (the Lobby shows the
   active map), or set `DEFAULT_MAP=<id>` in `.env` to make it the default.

The container merges this directory into its built-in `/maps/` at startup:
files added here override built-ins by name; built-in maps (`office`,
templates) are never deleted. Restart the app container after changes
(`docker compose restart app`) — map HTTP responses cache for 1 h.

Keep the filename slug lowercase (`[a-z0-9-_]`) — the `map` URL parameter is
sanitized to that set. See `docs/map-guide.md` for the map schema.
