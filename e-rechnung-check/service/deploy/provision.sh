#!/usr/bin/env bash
# Richtet die E-Rechnung-Teaser-Seite + KoSIT-Prüfdienst auf einem frischen
# Debian/Ubuntu-vServer ein (All-in-one: statische Seite UND Dienst auf einer
# Domain). Auf dem SERVER als root ausfuehren, nachdem service/ nach
# /opt/e-rechnung-check/service und public/ nach /opt/e-rechnung-check/public
# kopiert wurden (siehe README).
#
#   bash /opt/e-rechnung-check/service/deploy/provision.sh
set -euo pipefail

APP_DIR=/opt/e-rechnung-check/service
PUBLIC_DIR=/opt/e-rechnung-check/public
SERVICE_USER=erechnung
DOMAIN="${E_RECHNUNG_DOMAIN:-e-rechnung.deltaplus.de}"

echo "== Swap (kleiner vServer) =="
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  2G Swap angelegt"
else
  echo "  Swap vorhanden — übersprungen"
fi

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

echo "== statische Seite =="
if [ -d "$PUBLIC_DIR" ]; then
  chown -R "$SERVICE_USER:$SERVICE_USER" "$PUBLIC_DIR"
  echo "  $PUBLIC_DIR ($(ls "$PUBLIC_DIR" | tr '\n' ' '))"
else
  echo "  WARNUNG: $PUBLIC_DIR fehlt — public/ noch hochladen (rsync, siehe README)."
fi

echo "== nginx =="
sed "s/e-rechnung\.deltaplus\.de/$DOMAIN/g" "$APP_DIR/deploy/nginx-e-rechnung.conf" \
  > /etc/nginx/sites-available/e-rechnung
ln -sf /etc/nginx/sites-available/e-rechnung /etc/nginx/sites-enabled/e-rechnung
rm -f /etc/nginx/sites-enabled/e-rechnung-api
nginx -t && systemctl reload nginx

cat <<EOF

Fertig. Naechste Schritte:
  1. DNS: A-Record  $DOMAIN  ->  diese Server-IP
  2. TLS:  certbot --nginx -d $DOMAIN --redirect \\
             --non-interactive --agree-tos -m stefan.zangs@deltaplus.de
  3. Test: curl https://$DOMAIN/healthz
           Browser: https://$DOMAIN/
  4. Auf www.deltaplus.de einen Menuepunkt/Link auf https://$DOMAIN/ setzen.
EOF
