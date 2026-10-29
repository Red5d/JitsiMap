#!/bin/sh
# Runtime config injection (SPEC §12.3): renders /config.json from
# public/config.template.json + container environment, and nginx.conf from
# its template (with a CSP computed from JITSI_DOMAIN, §14).
#
# Chosen renderer: POSIX shell + awk (the nginx image ships no node; busybox
# awk is always present). Placeholder syntax: ${VAR} (required) and
# ${VAR:-fallback}; the literal JITSI_DOMAIN inside a fallback expands to the
# resolved domain (derived defaults, e.g. conference.<domain>).
# Exits non-zero when a required variable (JITSI_DOMAIN, §13) is missing.

set -eu

render() {
  # $1=template $2=output $3=json|plain
  awk -v mode="$3" '
    function esc(v) {
      if (mode == "json") { gsub(/\\/, "\\\\", v); gsub(/"/, "\\\"", v) }
      return v
    }
    {
      line = $0; out = ""
      while (match(line, /\$\{[A-Z0-9_]+(:-[^}]*)?\}/)) {
        out = out substr(line, 1, RSTART - 1)
        tok = substr(line, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
        inner = substr(tok, 3, length(tok) - 3)
        p = index(inner, ":-")
        if (p > 0) { name = substr(inner, 1, p - 1); fb = substr(inner, p + 2) }
        else       { name = inner; fb = "" }
        val = ENVIRON[name]
        if (val == "" && fb == "__null__") { out = out "null"; continue }
        if (val == "" && fb != "") { val = fb; gsub(/JITSI_DOMAIN/, ENVIRON["JITSI_DOMAIN"], val) }
        if (val == "") { print "missing required env: " name > "/dev/stderr"; bad = 1; val = "" }
        if (fb == "__null__") out = out "\"" esc(val) "\""
        else out = out esc(val)
      }
      print out line
      if (bad) exit 1
    }
    END { if (bad) exit 1 }
  ' "$1" > "$2"
}

if [ "${1:-}" = "--nginx" ]; then
  [ $# -eq 1 ] || { echo "usage: render-config.sh --nginx" >&2; exit 2; }
  : "${JITSI_DOMAIN:?JITSI_DOMAIN is required (SPEC §13)}"
  CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: mediastream:; connect-src 'self' blob: data: wss://${JITSI_DOMAIN} wss://*.${JITSI_DOMAIN} https://${JITSI_DOMAIN} https://*.${JITSI_DOMAIN}; worker-src 'self' blob:; child-src 'self' blob:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
  export CSP
  mkdir -p /etc/nginx/snippets
  cat > /etc/nginx/snippets/security-headers.conf <<CSP_EOF
add_header Content-Security-Policy "${CSP}" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
CSP_EOF
  render /opt/jitsimap/nginx.conf.template /etc/nginx/nginx.conf plain
  nginx -t
else
  [ $# -eq 2 ] || { echo "usage: render-config.sh <template> <output>" >&2; exit 2; }
  render "$1" "$2" json
fi
