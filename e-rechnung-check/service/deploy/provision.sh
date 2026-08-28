#!/usr/bin/env bash
# Richtet den E-Rechnung-Check-Dienst auf einem frischen Debian/Ubuntu-vServer ein.
# Auf dem SERVER als root ausfuehren, nachdem der Ordner service/ nach
# /opt/e-rechnung-check/service kopiert wurde (siehe README, Schritt 2).
#
#   bash /opt/e-rechnung-check/service/deploy/provision.sh
set -euo pipefail

APP_DIR=/opt/e-rechnung-check/service
SERVICE_USER=erechnung

echo "== Pakete =="
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip default-jre-headless nginx

NODE_MAJOR=0
command -v node >/dev/null 2>&1 && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "== Node.js 20 (NodeSource) =="
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "node $(node -v) · java $(java -version 2>&1 | head -1)"

echo "== Dienst-Benutzer =="
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

echo "== Abhaengigkeiten =="
cd "$APP_DIR"
[ -f .env ] || { cp .env.example .env; echo "  .env aus .env.example angelegt — bitte ALLOWED_ORIGINS pruefen"; }
chown -R "$SERVICE_USER:$SERVICE_USER" /opt/e-rechnung-check
sudo -u "$SERVICE_USER" env HOME="$APP_DIR" npm install --omit=dev --no-audit --no-fund

echo "== KoSIT-Validator laden =="
sudo -u "$SERVICE_USER" env HOME="$APP_DIR" npm run setup:kosit

chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "== systemd =="
cp "$APP_DIR/deploy/e-rechnung-check.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now e-rechnung-check
sleep 1
systemctl --no-pager --lines=10 status e-rechnung-check || true
curl -fsS http://127.0.0.1:8787/healthz && echo

echo "== nginx =="
cp "$APP_DIR/deploy/nginx-e-rechnung-api.conf" /etc/nginx/sites-available/e-rechnung-api
ln -sf /etc/nginx/sites-available/e-rechnung-api /etc/nginx/sites-enabled/e-rechnung-api
nginx -t && systemctl reload nginx

cat <<'EOF'

Fertig. Naechste Schritte:
  1. DNS: A-Record  e-rechnung-api.deltaplus.de  ->  diese Server-IP
  2. TLS:  apt-get install -y certbot python3-certbot-nginx
           certbot --nginx -d e-rechnung-api.deltaplus.de
  3. Test: curl https://e-rechnung-api.deltaplus.de/healthz
  4. In public/app.js die Konstante API_BASE auf die Domain setzen und
     public/ auf den Webspace hochladen.
EOF
