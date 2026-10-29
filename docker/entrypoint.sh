#!/bin/sh
# SPEC §12.2/§12.3: render /config.json + the CSP'd nginx.conf from the
# environment at container start (shell+awk renderer — the nginx image has
# no node), then exec nginx in the foreground.
set -eu

HTML=/usr/share/nginx/html

/opt/jitsimap/render-config.sh /opt/jitsimap/config.template.json "$HTML/config.json"
/opt/jitsimap/render-config.sh --nginx

# Runtime maps (README §Maps): if /opt/maps-extra is volume-mounted, merge it
# into the baked-in maps dir at start (adds/overwrites files, deletes none).
if [ -d /opt/maps-extra ] && [ -n "$(ls -A /opt/maps-extra 2>/dev/null)" ]; then
  cp -a /opt/maps-extra/. "$HTML/maps/"
fi

exec nginx -g 'daemon off;'
