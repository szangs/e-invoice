# E-Rechnung-Teaser + KoSIT-Prüfdienst

Eigenständige, öffentliche Teaser-Seite für **deltaplus.de**: E-Rechnungen
(ZUGFeRD / Factur-X / XRechnung) visualisieren und gegen den offiziellen
**KoSIT-Validator** prüfen. Vorstufe zum Rechnungseingangs-Programm von
Delta Plus Systemhaus.

Unabhängig vom E-Invoice-Hauptprojekt — nichts hier braucht dessen Datenbank
oder Anmeldung.

```
e-rechnung-check/
├── public/            ← STATISCH: auf den QualityHosting-Webspace hochladen
│   ├── index.html         (deltaplus.de/e-rechnung/)
│   ├── style.css
│   └── app.js             ← Konstante API-Basis via <meta name="e-rechnung-api">
└── service/           ← Node-Dienst für den 1&1 vServer (85.215.136.179)
    ├── src/server.mjs     HTTP-API  POST /api/analyze , GET /healthz
    ├── src/erechnung.mjs  XML-/ZUGFeRD-Parsing + formale Kernprüfung
    ├── src/kosit.mjs      Aufruf des KoSIT-Validators (Java) + Report-Auswertung
    ├── setup-kosit.mjs    lädt Validator-JAR + XRechnung-Konfiguration
    └── deploy/            systemd-Unit, nginx-Config, provision.sh
```

Datenfluss:

```
Browser  ──(Datei als Rohbytes, POST)──▶  https://e-rechnung-api.deltaplus.de
   ▲                                              │
   │        JSON: Rechnungsdaten + Prüfbericht     ▼
   └──────────────────────────────────  Node-Dienst ──▶ java -jar validator.jar
```

Es wird **nichts gespeichert** — die Datei existiert nur als Buffer im
Arbeitsspeicher, KoSIT arbeitet in einem Temp-Verzeichnis, das sofort
gelöscht wird.

---

## Teil A — Prüfdienst auf dem vServer

Voraussetzung: Debian/Ubuntu, Root-Zugang (`root@85.215.136.179`).

### 1. Code auf den Server bringen

Vom Arbeitsplatz aus (aus dem Ordner `e-rechnung-check/`):

```bash
rsync -av --exclude node_modules --exclude kosit --exclude .env \
  service/ root@85.215.136.179:/opt/e-rechnung-check/service/
```

### 2. Einrichten (auf dem Server, als root)

```bash
bash /opt/e-rechnung-check/service/deploy/provision.sh
```

Das Skript installiert Node 20, Java (JRE), nginx; legt den Systembenutzer
`erechnung` an; `npm install`; lädt den KoSIT-Validator (`npm run setup:kosit`);
startet den systemd-Dienst `e-rechnung-check` und richtet den nginx-vHost ein.

### 3. DNS + TLS

* DNS: A-Record `e-rechnung-api.deltaplus.de` → `85.215.136.179`
* TLS:
  ```bash
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d e-rechnung-api.deltaplus.de
  ```
* Test: `curl https://e-rechnung-api.deltaplus.de/healthz`
  → `{"ok":true,"kosit":{"configured":true}}`

### Konfiguration

`service/.env` (aus `.env.example`). Wichtig:

| Variable | Zweck |
|---|---|
| `ALLOWED_ORIGINS` | Domains, die die API im Browser aufrufen dürfen (CORS). Default: `https://www.deltaplus.de,https://deltaplus.de` |
| `PORT` / `HOST` | lokale Bindung hinter nginx (Default `127.0.0.1:8787`) |
| `KOSIT_VALIDATOR_JAR`, `KOSIT_SCENARIOS` | von `setup:kosit` gesetzt |
| `JAVA_BIN` | falls `java` nicht im PATH |

Nach Änderungen: `systemctl restart e-rechnung-check`

### Updates

```bash
rsync -av --exclude node_modules --exclude kosit --exclude .env \
  service/ root@85.215.136.179:/opt/e-rechnung-check/service/
ssh root@85.215.136.179 'cd /opt/e-rechnung-check/service && sudo -u erechnung npm install --omit=dev && systemctl restart e-rechnung-check'
```

KoSIT-Regeln aktualisieren (neue XRechnung-Version):
```bash
ssh root@85.215.136.179 'cd /opt/e-rechnung-check/service && sudo -u erechnung npm run setup:kosit && systemctl restart e-rechnung-check'
```

---

## Teil B — Teaser-Seite auf den Webspace

1. In `public/index.html` die Zeile prüfen/anpassen:
   ```html
   <meta name="e-rechnung-api" content="https://e-rechnung-api.deltaplus.de" />
   ```
2. Inhalt von `public/` per FTP/SFTP in einen Ordner `e-rechnung/` im
   Webspace legen → erreichbar unter `https://www.deltaplus.de/e-rechnung/`.
3. Fertig. Die Seite ist statisch, kein PHP/Node auf dem Webspace nötig.

Einbindung in die bestehende Website: entweder als eigener Menüpunkt
(Link auf `/e-rechnung/`) oder den Inhalt von `index.html` in eine
CMS-Seite übernehmen (dann `style.css` + `app.js` mitliefern und die
`<meta>`-Zeile im `<head>` ergänzen).

---

## Lokal testen

```bash
cd service
cp .env.example .env
# ALLOWED_ORIGINS=http://localhost:8080  (fürs lokale Frontend)
npm install
npm run setup:kosit        # braucht Java 11+ und Internet
npm start                  # Dienst auf http://127.0.0.1:8787

# zweites Terminal: statische Seite servieren
cd ../public && python3 -m http.server 8080
# Browser: http://localhost:8080  (vorher <meta> auf http://127.0.0.1:8787 setzen)
```

Ohne Java läuft der Dienst trotzdem — dann zeigt die Seite Rechnungsbild +
formale Kernprüfung, und beim KoSIT-Block steht der Hinweis, dass der
Validator nicht eingerichtet ist.

---

## Formate & Prüftiefe

| Eingabe | Rechnungsbild | Formale Prüfung | KoSIT |
|---|---|---|---|
| XRechnung UBL (.xml) | ✅ | ✅ | ✅ |
| XRechnung CII (.xml) | ✅ | ✅ | ✅ |
| ZUGFeRD / Factur-X (.pdf) | ✅ (aus eingebettetem XML) | ✅ | ✅ |
| PDF ohne XML | — | — | — (Hinweis) |

Die KoSIT-Prüfung nutzt `validator-configuration-xrechnung` (Schematron nach
EN 16931 + XRechnung-CIUS). Der Prüfbericht wird sowohl aufbereitet
(Liste mit Regel-ID, Fundstelle, Schweregrad) als auch als
**Original-KoSIT-Report** (HTML + XML zum Download) angezeigt.
