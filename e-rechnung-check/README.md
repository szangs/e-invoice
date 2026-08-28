# E-Rechnung-Teaser + KoSIT-Prüfdienst

Eigenständige, öffentliche Teaser-Seite für **deltaplus.de**: E-Rechnungen
(ZUGFeRD / Factur-X / XRechnung) visualisieren und gegen den offiziellen
**KoSIT-Validator** prüfen. Vorstufe zum Rechnungseingangs-Programm von
Delta Plus Systemhaus.

Unabhängig vom E-Invoice-Hauptprojekt — nichts hier braucht dessen Datenbank
oder Anmeldung.

```
e-rechnung-check/
├── public/            ← statische Teaser-Seite
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── fonts/inter-latin.woff2   ← Inter selbst gehostet (kein Google Fonts)
└── service/           ← Node-Dienst + KoSIT-Validator (Java)
    ├── src/server.mjs     HTTP-API  POST /api/analyze , GET/HEAD /healthz
    ├── src/erechnung.mjs  XML-/ZUGFeRD-Parsing + formale Kernprüfung
    ├── src/kosit.mjs      Aufruf des KoSIT-Validators + Report-Auswertung
    ├── setup-kosit.mjs    lädt Validator-JAR + XRechnung-Konfiguration
    └── deploy/
        ├── nginx-e-rechnung.conf      Bootstrap (Port 80, für den 1. certbot-Lauf)
        ├── nginx-e-rechnung-tls.conf  Endzustand nach certbot (Referenz)
        ├── e-rechnung-check.service   systemd-Unit
        └── provision.sh
```

**Datenschutz:** Die Seite lädt **keine** externen Ressourcen — Inter ist selbst
gehostet, kein Google Fonts, kein CDN. Optionaler Cloudflare-Turnstile-Bot-Schutz
ist standardmäßig aus. Hochgeladene Dateien werden nicht gespeichert. Ein
sichtbarer Haftungsausschluss steht in `index.html`; Impressum/Datenschutz
verlinken auf `www.deltaplus.de/#impressum` bzw. `#datenschutz`.

**Betriebsart: All-in-one** — statische Seite **und** Dienst laufen auf einem
vServer unter einer Domain (`e-rechnung-api.deltaplus.de`). Keine getrennte
Webspace-Ablage, kein CORS, ein Zertifikat. Auf der Hauptwebsite nur ein Link.

**Status:** live unter <https://e-rechnung-api.deltaplus.de/> (vServer
`85.215.136.179`, TLS via Let's Encrypt). Der Alias `e-rechnung.deltaplus.de`
ist in nginx vorbereitet, hat aber noch keinen DNS-Eintrag.

```
Browser ──▶ https://e-rechnung-api.deltaplus.de/         (nginx: statische Seite)
        └─▶ https://e-rechnung-api.deltaplus.de/api/...   (nginx → 127.0.0.1:8787 Node)
                                                          └─▶ java -jar validator.jar
```

Es wird **nichts gespeichert** — die Datei existiert nur als Buffer im
Arbeitsspeicher, KoSIT arbeitet in einem Temp-Verzeichnis, das sofort
gelöscht wird.

---

## Deployment (vServer, Debian/Ubuntu, Root)

### 1. Code auf den Server (aus dem Ordner `e-rechnung-check/`)

```bash
ssh root@85.215.136.179 'mkdir -p /opt/e-rechnung-check'
rsync -az --delete --exclude node_modules --exclude kosit --exclude .env \
  service/ root@85.215.136.179:/opt/e-rechnung-check/service/
rsync -az --delete public/ root@85.215.136.179:/opt/e-rechnung-check/public/
```

### 2. Einrichten (auf dem Server)

```bash
bash /opt/e-rechnung-check/service/deploy/provision.sh
```

Installiert Node 20, Java (JRE), nginx; legt 2 GB Swap an; Systembenutzer
`erechnung`; `npm install`; lädt den KoSIT-Validator; startet den systemd-Dienst
`e-rechnung-check`; richtet den nginx-vHost `e-rechnung-api.deltaplus.de` ein
(andere Domain: `E_RECHNUNG_DOMAIN=... bash .../provision.sh`).

### 3. DNS + TLS

```bash
# DNS: A-Record  e-rechnung-api.deltaplus.de  ->  85.215.136.179   (beim Provider)
ssh root@85.215.136.179 'certbot --nginx -d e-rechnung-api.deltaplus.de --redirect \
  --non-interactive --agree-tos -m stefan.zangs@deltaplus.de'
```

Test: `curl https://e-rechnung-api.deltaplus.de/healthz` →
`{"ok":true,"kosit":{"configured":true}}` · Browser: `https://e-rechnung-api.deltaplus.de/`

### 4. Auf www.deltaplus.de verlinken

Menüpunkt / Button „E-Rechnung prüfen" → `https://e-rechnung-api.deltaplus.de/`.
(Alternativ per `<iframe>` einbetten.)

---

## Updates

```bash
# aus e-rechnung-check/
rsync -az --delete --exclude node_modules --exclude kosit --exclude .env \
  service/ root@85.215.136.179:/opt/e-rechnung-check/service/
rsync -az --delete public/ root@85.215.136.179:/opt/e-rechnung-check/public/
ssh root@85.215.136.179 'chown -R erechnung:erechnung /opt/e-rechnung-check \
  && cd /opt/e-rechnung-check/service && sudo -u erechnung npm install --omit=dev \
  && systemctl restart e-rechnung-check'
```

> **nginx-Config nach certbot NICHT per `cp` überschreiben** — sonst ist der
> 443-Block weg. Bei Änderungen `deploy/nginx-e-rechnung-tls.conf` als Vorlage
> nehmen, auf dem Server in `/etc/nginx/sites-available/e-rechnung` einpflegen,
> `nginx -t && systemctl reload nginx`. Statische Dateien (`public/`) sind davon
> nicht betroffen.

KoSIT-Regeln aktualisieren (neue XRechnung-Version):

```bash
ssh root@85.215.136.179 'cd /opt/e-rechnung-check/service \
  && sudo -u erechnung npm run setup:kosit && systemctl restart e-rechnung-check'
```

---

## Konfiguration

`service/.env` (aus `.env.example`):

| Variable | Zweck | Default |
|---|---|---|
| `ALLOWED_ORIGINS` | Domains, die die API aufrufen dürfen | `e-rechnung-api.deltaplus.de`, `www.deltaplus.de`, `deltaplus.de` |
| `PORT` / `HOST` | lokale Bindung hinter nginx | `127.0.0.1:8787` |
| `KOSIT_VALIDATOR_JAR`, `KOSIT_SCENARIOS` | von `setup:kosit` gesetzt | – |
| `KOSIT_JAVA_XMX` | JVM-Heap-Limit | `512m` |
| `JAVA_BIN` | falls `java` nicht im PATH | `java` |

Nach Änderungen: `systemctl restart e-rechnung-check`

### Missbrauchsschutz

Standardmäßig aktiv:

| Schutz | Variable | Default |
|---|---|---|
| **Origin/Referer-Pflicht** — nur Aufrufe von `ALLOWED_ORIGINS` (blockt `curl` & fremde Seiten) | `REQUIRE_ORIGIN` | `true` |
| **Rate-Limit je IP** | `RATE_MAX` / `RATE_WINDOW_MS` | 15 / 10 min |
| **Parallelitätsgrenze** (KoSIT ist CPU-intensiv) | `MAX_CONCURRENT` | 3 |
| **Upload-Größe** | `MAX_BYTES` | 15 MB |

Optional zuschaltbar:

* **Cloudflare Turnstile** (echter Bot-Schutz, kostenlos): `TURNSTILE_SECRET`
  in `.env` **und** Sitekey in `public/index.html`
  (`<meta name="e-rechnung-turnstile-sitekey">`). Ohne gültigen Token → HTTP 403.
  Bei eigener CSP: `challenges.cloudflare.com` in `script-src` + `frame-src`.
* **Statisches API-Token** (schwacher Zusatzfilter): `API_TOKEN` in `.env` +
  `<meta name="e-rechnung-api-token">` → Header `X-Api-Token`.

---

## Seite woanders hosten (optional)

Wenn die Seite doch auf dem QualityHosting-Webspace liegen soll:

1. `public/index.html`: `<meta name="e-rechnung-api" content="https://e-rechnung-api.deltaplus.de" />`
2. `public/` per FTP in den Webspace (z. B. `deltaplus.de/e-rechnung/`).
3. `e-rechnung-api.deltaplus.de` bleibt der API-Endpunkt; CORS ist im Dienst
   bereits umgesetzt (`ALLOWED_ORIGINS`).

---

## Lokal testen

```bash
cd service
cp .env.example .env
#   REQUIRE_ORIGIN=false           (fürs Testen mit curl)
#   ALLOWED_ORIGINS=http://localhost:8080
npm install
npm run setup:kosit        # braucht Java 11+ und Internet
npm start                  # Dienst auf http://127.0.0.1:8787

# zweites Terminal:
cd ../public && python3 -m http.server 8080
#   in index.html: <meta name="e-rechnung-api" content="http://127.0.0.1:8787" />
```

Ohne Java läuft der Dienst trotzdem — die Seite zeigt dann Rechnungsbild +
formale Kernprüfung, der KoSIT-Block meldet „nicht eingerichtet".

---

## Formate & Prüftiefe

| Eingabe | Rechnungsbild | Formale Prüfung | KoSIT |
|---|---|---|---|
| XRechnung UBL (.xml) | ✅ | ✅ | ✅ |
| XRechnung CII (.xml) | ✅ | ✅ | ✅ |
| ZUGFeRD / Factur-X (.pdf) | ✅ (aus eingebettetem XML) | ✅ | ✅ |
| PDF ohne XML | — | — | Hinweis |

Die KoSIT-Prüfung nutzt `validator-configuration-xrechnung` (Schematron nach
EN 16931 + XRechnung-CIUS). Der Prüfbericht wird sowohl aufbereitet
(Liste mit Regel-ID, Fundstelle, Schweregrad) als auch als
**Original-KoSIT-Report** (HTML + XML zum Download) angezeigt.
Passt keine Szenario-Konfiguration (z. B. falsche `CustomizationID`), meldet
die Seite „kein passendes Prüfszenario" statt eines falschen „konform".
