# Third-Party-Notices — E-Rechnung-Teaser + KoSIT-Prüfdienst

Diese Anwendung nutzt quelloffene Software. Delta Plus Systemhaus GmbH stellt
lediglich eine Weboberfläche bereit und ist **nicht** mit den unten genannten
Projekten oder mit der Koordinierungsstelle für IT-Standards (KoSIT) verbunden.

Die KoSIT-Artefakte (Validator-JAR, XRechnung-Konfiguration) werden **nicht**
mit diesem Repository ausgeliefert, sondern zur Einrichtungszeit von den
offiziellen Release-Seiten heruntergeladen (`service/setup-kosit.mjs`) und
unverändert als Subprozess ausgeführt.

---

## Prüf-Kern (serverseitig, zur Laufzeit heruntergeladen)

### KoSIT Validator
- Zweck: Ausführung der Schematron-/XSD-Validierung, Erzeugung des Prüfberichts
- Herausgeber: Koordinierungsstelle für IT-Standards (KoSIT)
- Lizenz: **Apache License 2.0**
- Quelle: https://github.com/itplr-kosit/validator
- Lizenztext: https://github.com/itplr-kosit/validator/blob/main/LICENSE

### validator-configuration-xrechnung
- Zweck: Prüfszenarien, Schematron-Regeln und XSD für XRechnung
- Herausgeber: Koordinierungsstelle für IT-Standards (KoSIT)
- Lizenz: **Apache License 2.0**
- Quelle: https://github.com/itplr-kosit/validator-configuration-xrechnung

### EN 16931 Schematron
- Zweck: europäische Geschäftsregeln (BR-*, BR-CO-*) für EN 16931
- Herausgeber: ConnectingEurope / CEF eInvoicing
- Lizenz: **Apache License 2.0**
- Quelle: https://github.com/ConnectingEurope/eInvoicing-EN16931

---

## Dienst (Node, `service/`)

| Paket | Lizenz | Quelle |
|---|---|---|
| pdf-lib | MIT | https://github.com/Hopding/pdf-lib |
| fast-xml-parser | MIT | https://github.com/NaturalIntelligence/fast-xml-parser |
| adm-zip | MIT | https://github.com/cthackers/adm-zip |

## Weboberfläche (`public/`)

| Bestandteil | Lizenz | Quelle |
|---|---|---|
| Inter (Schriftart, selbst gehostet, `public/fonts/inter-latin.woff2`) | SIL Open Font License 1.1 | https://github.com/rsms/inter |

Das Delta-Plus-Logo (`public/assets/deltaplus-logo.png`) ist Eigentum der
Delta Plus Systemhaus GmbH und nicht Teil der Open-Source-Bestandteile.

---

## Apache License 2.0 — Hinweis

Die o. g. Apache-2.0-Komponenten stehen unter der Apache License, Version 2.0.
Eine Kopie der Lizenz ist erhältlich unter:

    http://www.apache.org/licenses/LICENSE-2.0

Sofern nicht durch geltendes Recht vorgeschrieben oder schriftlich vereinbart,
wird die unter der Lizenz vertriebene Software „wie besehen" ohne Mängelgewähr
und ohne ausdrückliche oder stillschweigende Gewährleistung jeglicher Art
bereitgestellt.
