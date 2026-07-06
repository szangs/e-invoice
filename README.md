# E-Invoice — MVP

Mandantenfähige Rechnungsautomatisierung · Delta Plus Systemhaus GmbH
Phase 4 (MVP) · Stack: Next.js 14 (App Router) · TypeScript strict · Tailwind 3 · PostgreSQL 15+ · Prisma 5 · next-auth 4 · zod · date-fns

Mandantenmodul umgesetzt nach `modul_Mandantenfaehig.md` (Kernumfang):
zweistufiger Login mit Mandanten-Auflösung (§5), Betreiber-Cockpit (§6), Mandanten-
und Benutzerverwaltung (§7/§8), Betriebssteuerung (§9), Zwangsabmeldung (§10),
Killswitch (§11), Identitätsübernahme (§12), Audit-Hashkette (§18), KI-Schalter je
Mandant (§19), Systemeinstellungen (§24), Befehlspalette + Schnellcodes (§21/11.2).

Rechnungsmodul (E-Invoice Minimalfunktionen): Upload (PDF/Bild) · manuelle
Felderfassung · Liste mit Suche/Filter · Status-Workflow · CSV-Export (Excel-tauglich).

**Beleg-Verschlüsselung (Zero-Knowledge):** Der Mandant kann unter
Mandanten-Einstellungen (MA01) eine Ende-zu-Ende-Verschlüsselung aktivieren.
Belege werden dann **im Browser** mit AES-256-GCM verschlüsselt; der Server
speichert nur Chiffrat plus den mit der Kunden-Passphrase verpackten
Datenschlüssel (PBKDF2-SHA256, 310.000 Iterationen). Weder Betreiber noch
Server können die Belege lesen — auch nicht bei Identitätsübernahme.
Passphrase-Wechsel erfolgt ohne Umschlüsselung der Dateien.
Workflow-Daten (Lieferant, Beträge, Status, Tags) bleiben bewusst unverschlüsselt
(Suche, Filter, CSV-Export).
**Achtung: Passphrase verloren = Belege unwiederbringlich verloren.**

**In Runde 2 (bewusst noch nicht enthalten):** KI-Extraktion, Fernwartung (§14),
Serviceaufträge (§15), Abrechnungsübersicht (§16), Backup-Versand (§17),
Live-Monitoring-Feed (§13), Laufzeit-Übersetzungen (§25), Feedback (§26),
Fehlerberichte (§27), Sicherheitsupdates-Seite (§28), 2FA, Mehrsprachigkeit.

---

## Erststart (Windows, PowerShell)

Voraussetzungen: Node.js 18+, PostgreSQL 15+ läuft lokal.

```powershell
# 1. In den Projektordner wechseln
cd "C:\coworkprojekts\E-Invoice (1)\einvoice"

# 2. Abhängigkeiten installieren
npm install

# 3. Konfiguration anlegen
Copy-Item .env.local.example .env.local
# → .env.local öffnen und ausfüllen: DATABASE_URL, NEXTAUTH_SECRET, SEED_OPERATOR_PASSWORD

# 4. Datenbank anlegen (einmalig, Passwort = Postgres-Passwort)
# In psql:  CREATE DATABASE einvoice;

# 5. Schema migrieren (liest .env.local über dotenv der Prisma-CLI NICHT automatisch —
#    daher DATABASE_URL kurz in die Sitzung übernehmen):
$env:DATABASE_URL = (Get-Content .env.local | Select-String '^DATABASE_URL=').ToString().Split('=',2)[1]
npx prisma migrate dev --name init

# 6. Seed (Betreiber-Admin + Demo-Mandant)
$env:SEED_OPERATOR_EMAIL = "stefan.zangs@deltaplus.de"
$env:SEED_OPERATOR_PASSWORD = "DEIN-STARTPASSWORT"
npx prisma db seed

# 7. Entwicklungsserver starten
npm run dev
# Browser: http://localhost:3000
```

**Logins nach dem Seed:**

| Ebene | E-Mail | Passwort |
|-------|--------|----------|
| Betreiber | stefan.zangs@deltaplus.de | Wert aus SEED_OPERATOR_PASSWORD |
| Demo-Mandant (Admin) | admin@demo.example.org | demo1234! |

---

## Was zu testen ist

```
✓ Login Betreiber → landet im Betreiber-Cockpit (PL01)
✓ Mandant anlegen (PL02) → Zugangsdaten werden angezeigt
✓ Login als Mandanten-Admin → Dashboard (DB01), Rechnung erfassen (RE02)
✓ Rechnungsliste (RE01): Suche, Statusfilter, CSV-Export
✓ Benutzer anlegen (BN01) → Obergrenze wird erzwungen
✓ Cockpit: Sperren → Mandant kann sich nicht mehr anmelden (klare Meldung)
✓ Killswitch → angemeldeter Mandanten-Nutzer wird binnen ~20 s zwangsabgemeldet
✓ Übernehmen → Mandantensicht mit gelbem Banner, "Übernahme beenden" führt zurück
✓ Systemeinstellungen (SP01): Speichern, KI-Verbindungstest
✓ Audit (AU01): alle Aktionen mit Hash-Kette protokolliert
✓ Mandanten-Einstellungen (MA01): Verschlüsselung aktivieren (Passphrase 2×)
✓ Rechnung mit Beleg hochladen → Liste zeigt 🔒, Öffnen fragt Passphrase ab
✓ Falsche Passphrase → klare Fehlermeldung, Beleg bleibt zu
✓ Als Betreiber "Übernehmen": Beleg lässt sich OHNE Passphrase nicht öffnen (gewollt)
✓ Strg+K: Befehlspalette, Code RE01 + Enter navigiert
✓ Browser-Konsole: keine roten Fehler (F12 → Console)
```

---

## GitHub

```powershell
cd "C:\coworkprojekts\E-Invoice (1)\einvoice"
# Repo auf github.com anlegen: e-invoice (privat), dann:
git remote add origin https://github.com/DEIN-USERNAME/e-invoice.git
git push -u origin main
```

---

© 2026/2026 Delta Plus Systemhaus GmbH – EDV Lösungen · Dorfstrasse 64 · 41372 Niederkrüchten
02163/888 45 70 · www.deltaplus.de · stefan.zangs@deltaplus.de
Nutzungsbedingungen: in der Anwendung unter Hilfe (HE01).
