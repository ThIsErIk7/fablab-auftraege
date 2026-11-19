# FabLab Kiel – Auftragsverwaltung

Web-Anwendung für Fertigungsaufträge im FabLab Kiel (opencampus.sh, Fraunhoferstr. 2–4, Kiel):
Aufträge und Teile erfassen, Fortschritt verfolgen, abhaken, Import/Export und Rechnungen mit PDF.

## Schnellstart

Voraussetzung: **Node.js ≥ 22.13** (getestet mit Node 26). SQLite ist in Node eingebaut (`node:sqlite`),
es muss nichts nativ kompiliert werden.

```bash
npm install
npm run dev
```

- Oberfläche: <http://localhost:5173> (im Lab-Netz auch vom Tablet über die angezeigte „Network“-Adresse)
- API: <http://127.0.0.1:3001/api>

Beim ersten Start wird `data/fablab.db` angelegt und mit Stammdaten, Beispielpreisen,
4 Beispielaufträgen und einer gestellten Beispielrechnung befüllt.

| Befehl | Zweck |
|---|---|
| `npm run dev` | Server + Oberfläche mit Hot-Reload |
| `npm test` | Tests (Import-Parsing, Statuslogik, Preisberechnung, Rechnungsnummern, Storno) |
| `npm run typecheck` | TypeScript-Prüfung aller Pakete |
| `npm run reset-db` | Datenbank löschen und mit Beispieldaten neu anlegen |
| `npm run build && npm start` | Produktivbetrieb: Server liefert die gebaute Oberfläche auf Port 3001 aus |

Umgebungsvariablen: `PORT` (3001), `HOST` (127.0.0.1 – für Zugriff im Netz z. B. `0.0.0.0`), `DB_PATH`.

## ⚠️ Vor dem echten Einsatz

Unter **Einstellungen → Rechnungseinstellungen** die Beispielwerte ersetzen: Steuernummer/USt-IdNr.,
Bankverbindung, E-Mail, ggf. Logo. Unter **Preise & Rabatte** die echte Preisliste eintragen –
alle Seed-Preise sind Platzhalter. Prüft außerdem mit eurer Buchhaltung den Steuersatz
(19 % oder 0 % mit Hinweistext, z. B. § 19 UStG). Die App ersetzt keine steuerliche Beratung.

Datensicherung: Die komplette Datenbank ist die Datei `data/fablab.db` (bei laufendem Server zusätzlich `-wal`).
Regelmäßig sichern!

## Design

Angelehnt an [fablab.sh](https://fablab.sh): Schrift Titillium Web (lokal eingebunden, funktioniert offline),
Akzent Cyan `#0cb4ce`, Anthrazit `#141618`, Flächen `#f7f7f7`, Linien `#eaeaea`; flach und kantig,
Versal-Überschriften, Pill-Buttons, Logo des FabLab Kiel (`client/public/fablab-logo-*.png`).
Farben und Radien stehen zentral in `client/src/index.css` (`@theme`).

## Aufbau

```
shared/   Typen, Statuslogik, Preisberechnung, Geld-Helfer, Import-Parsing, zod-Schemas (Browser + Server)
server/   Fastify-API, SQLite-Migrationen, Seed, Rechnungs-Service, PDF (pdfmake), Export
client/   React + Vite + Tailwind, TanStack Query, dnd-kit (Kanban)
data/     SQLite-Datenbank (nicht im Git)
```

### Wichtige Designentscheidungen

- **Geld als Ganzzahl:** Beträge (Positionssummen, Netto, Steuer, Brutto, Stundensätze) in **Cent**;
  Einzelpreise (Material €/g bzw. €/ml, Rechnungspositionen) in **Zehntelcent** (1/1000 €), damit z. B. 0,035 €/g exakt
  gespeichert wird. Prozentsätze in Basispunkten (1900 = 19 %). Gerundet wird nur einmal pro Position (kaufmännisch)
  und für die Steuer auf die Netto-Summe.
- **Preisformel pro Teil:** Maschinenzeit (tatsächlich, sonst geschätzt – mit Hinweis) × Stundensatz
  + Pauschale pro Job (einmal je Teil-Zeile) + Materialverbrauch × Materialpreis pro Einheit
  (FDM/SLS: **€/g**, SLA-Harz: **€/ml**, Laser/Fräse: €/m² oder €/Platte, sonst €/Stück; g/ml auf 0,1 genau). Der Kundentyp-Rabatt wird als Positionsrabatt eingetragen.
  Maschinenzeit und Materialverbrauch gelten für die ganze Teil-Zeile (alle Stück zusammen).
- **Lückenlose Rechnungsnummern:** Entwürfe haben keine Nummer. Die Nummer wird erst beim „Stellen“ in derselben
  Transaktion vergeben; schlägt das Stellen fehl, wird alles zurückgerollt. Verworfene Entwürfe verbrauchen keine
  Nummer. Mit `{YYYY}` im Format beginnt der Zähler jedes Jahr neu.
- **Gestellte Rechnungen sind unveränderlich** – im Service und zusätzlich per SQLite-Trigger.
  Absender- und Empfängerdaten werden beim Stellen eingefroren. Korrektur nur per Stornorechnung
  (eigene Nummer, negative Beträge, Verweis auf das Original).
- **„Überfällig“** wird nicht gespeichert, sondern aus Status + Fälligkeit abgeleitet.
- **Import** wird komplett im Browser gelesen und geprüft (Vorschau, Zuordnung, Validierung).
  Gespeichert wird erst nach Bestätigung in **einer** Transaktion – bei Fehlern wird nichts übernommen.
- **Verlauf:** Statusänderungen von Aufträgen, Teilen und Rechnungen werden mit Zeitstempel protokolliert.

## Funktionen

- **Übersicht:** Kennzahlen, aktive Aufträge mit Fortschritt, Deadlines, Teile pro Maschine, offene/überfällige
  Rechnungen, noch nicht abgerechnete Aufträge
- **Aufträge:** Suche, Filter (Status, Priorität, Verfahren, Maschine, Deadline, überfällig), Sortierung,
  Kanban mit Drag & Drop (nur erlaubte Statuswechsel)
- **Auftragsdetail:** große Checkboxen zum Abhaken; erster Fortschritt setzt „In Bearbeitung“;
  sind alle Teile erledigt, schlägt die App „Fertig“ vor. Teile bearbeiten, duplizieren, löschen.
- **Teil-Formular:** Maschinen-Auswahl gefiltert nach Verfahren, Material-Vorschläge mit Freitext,
  Warnung bei Überschreitung des größten Bauraums (850 × 405 × 395 mm, Drehung berücksichtigt)
- **Maschinen:** Warteschlange je Maschine mit Start/Erledigt/Fehlgeschlagen
- **Import:** `.xlsx`, `.xls`, `.csv` (Komma/Semikolon/Tab, UTF-8 mit/ohne BOM, Fallback Windows-1252),
  automatische Spaltenzuordnung, unbekannte Verfahren/Maschinen zuordnen, neu anlegen oder überspringen;
  Vorlage als CSV und XLSX
- **Export:** Aufträge, Teile, Rechnungen (+ Positionen) als CSV (Semikolon, deutsches Zahlenformat) und XLSX
- **Rechnungen:** Entwurf aus Auftrag, Positionen anpassen, freie Positionen (Betreuung, Design, Versand, Rabatt),
  optional Auto-Entwurf bei „Fertig“, PDF mit Pflichtangaben nach § 14 UStG, bezahlt markieren, Storno
- **Einstellungen:** Verfahren, Maschinen (inkl. Deaktivieren/Wartungshinweis), Materialien, Preise, Rabatte,
  Absender, Logo, Bank, Steuernummer, Zahlungsziel, Nummernformat, MwSt.-Satz/Hinweistext
- Hell-/Dunkelmodus (oder System), responsiv mit unterer Navigation auf Tablets

## Nächste Ausbaustufe: E-Rechnung

`server/src/einvoice/index.ts` überführt gestellte Rechnungen bereits in ein Modell nach EN 16931.
Offen sind die XML-Erzeugung (XRechnung CII/UBL), das Einbetten in PDF/A-3 (ZUGFeRD) sowie ein Feld für die
Leitweg-ID öffentlicher Auftraggeber.

## API (Auszug)

```
GET    /api/orders?q&status&priority&processId&machineId&dueTo&overdue&sort&dir
POST   /api/orders                     { order, parts[] }
GET    /api/orders/:id | PATCH | DELETE
POST   /api/orders/:id/status          { status }  → { order, draftInvoiceId }
POST   /api/orders/:id/parts           Teil oder Array von Teilen
PATCH  /api/parts/:id                  → { part, orderStatus, suggestFinish }
POST   /api/parts/:id/duplicate        DELETE /api/parts/:id
GET    /api/machines/queue             GET /api/dashboard   GET /api/history
GET    /api/masterdata                 POST/PATCH /api/processes|machines|materials   PUT /api/discounts
GET|PUT /api/settings/invoice
POST   /api/orders/:id/invoice-draft   GET /api/invoices?status&from&to&q
GET    /api/invoices/:id | PATCH (nur Entwurf) | DELETE (nur Entwurf)
POST   /api/invoices/:id/items|regenerate|issue|pay|unpay|cancel
PATCH|DELETE /api/invoice-items/:id
GET    /api/invoices/:id/pdf
POST   /api/import/commit              GET /api/import/template.(csv|xlsx)
GET    /api/export/(auftraege|teile|rechnungen).(csv|xlsx)
```
