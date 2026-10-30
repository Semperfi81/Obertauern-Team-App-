# Team App – Demoversionen & weitere Betriebe

Derselbe Code läuft für Sport Gefäll, die Demos und später für Kunden.
Was eine Installation ist, entscheiden nur **Umgebungsvariablen** bei Render.
Ohne diese Variablen läuft alles genau wie bisher (Crew Sport Gefäll).

## Demo anlegen (pro Demo ein eigener Render-Dienst)

1. Render → **New → Web Service** → dieses Repo wählen, Branch `demo` (später `main`).
2. Build Command: `npm install` · Start Command: `npm start`
3. Unter **Environment** eintragen:

| Variable | Skiverleih & Sport | Hotellerie |
|---|---|---|
| `DEMO_PRESET` | `ski` | `hotel` |

**Keine** `DATABASE_URL` eintragen! Die Demo braucht keine Datenbank und darf
auf keinen Fall die Datenbank von Sport Gefäll verwenden.

Die Demo legt beim Start erfundene Mitarbeiter, Schichten, Zeiten, Aufgaben,
Checklisten und Chat-Nachrichten an und setzt sich jede Nacht um 03:00 zurück.

**Zugänge (stehen auch auf dem Login-Bildschirm):**
- Mitarbeiter: Namen wählen, PIN `1111`
- Admin: Skiverleih `Chef` / Hotel `Direktion`, PIN `1234`

## Aus einer Demo eine Vollversion für einen Kunden machen

Neuen Render-Dienst anlegen (Demo bleibt für den nächsten Interessenten):

| Variable | Beispiel |
|---|---|
| `APP_NAME` | `Hotel Alpenblick` |
| `APP_ICON` | `teamapp` (oder eigener Ordner unter `public/brands/`) |
| `LOCATIONS` | `Rezeption,Restaurant,Housekeeping,Küche` |
| `AREAS` | `Rezeption,Restaurant,Housekeeping,Küche,Allgemein` |
| `DATABASE_URL` | **eigene** Datenbank des Kunden (z. B. neues Neon-Projekt) |

`DEMO_PRESET` weglassen. Der Kunde richtet beim ersten Öffnen seinen Admin ein.

## Eigenes Logo für einen Kunden
Ordner `public/brands/<name>/` mit `icon-192.png` und `icon-512.png` anlegen
und `APP_ICON=<name>` setzen.
