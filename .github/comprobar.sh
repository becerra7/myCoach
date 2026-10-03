#!/usr/bin/env bash
# Comprueba un despliegue de myCoach: la web, la API, el conector (metadata OAuth y /mcp) y el login.
set -u
base="$1"
for intento in 1 2 3 4 5; do
  me=$(curl -fsS "$base/api/me" || true)
  html=$(curl -fsS "$base/" | head -c 200 || true)
  meta=$(curl -fsS "$base/.well-known/oauth-authorization-server" || true)
  if echo "$me" | grep -q '"conectado"' && echo "$html" | grep -qi '<!doctype html' && echo "$meta" | grep -q "\"issuer\": *\"$base\""; then
    echo "OK web, API y conector"; break
  fi
  echo "Intento $intento: api=$me"; sleep 6
  [ "$intento" = 5 ] && { echo "FALLO: $base no contesta bien"; echo "$meta"; exit 1; }
done
mcp=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$base/mcp" -H 'Content-Type: application/json' -d '{}')
echo "/mcp sin token: $mcp"; [ "$mcp" = 401 ] || exit 1
loc=$(curl -sS -o /dev/null -w '%{redirect_url}' "$base/api/login")
echo "login -> $loc"; echo "$loc" | grep -q "^$base/oauth/authorize?" || exit 1
auth=$(curl -sS -o /tmp/entrar.html -w '%{http_code}' "$loc")
echo "pantalla de entrar: $auth"
if [ "$auth" != 200 ]; then sed -e 's/<[^>]*>/ /g' /tmp/entrar.html | tr -s ' \n' ' ' | head -c 400; echo; exit 1; fi
