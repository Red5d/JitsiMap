#!/bin/sh
# SPEC §12.2/§12.3: render /config.json + the CSP'd nginx.conf from the
# environment at container start (shell+awk renderer — the nginx image has
# no node), then exec nginx in the foreground.
set -eu

HTML=/usr/share/nginx/html

/opt/jitsimap/render-config.sh /opt/jitsimap/config.template.json "$HTML/config.json"
/opt/jitsimap/render-config.sh --nginx

exec nginx -g 'daemon off;'
