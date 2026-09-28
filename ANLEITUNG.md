# Team-App 2.0 – Update einspielen

## 1. Dateien ins GitHub-Repo
Alle Dateien aus dem ZIP ins Repo `obertauern-team-app` kopieren (bestehende überschreiben):

    server.js
    package.json
    .gitignore
    public/index.html
    public/manifest.json
    public/service-worker.js
    public/icon-192.png   (neues Crew-Logo)
    public/icon-512.png   (neues Crew-Logo)

Commit + Push -> Render deployt automatisch.

## 2. WICHTIG: Daten dauerhaft speichern
Render (Free) löscht `data.json` bei jedem Deploy/Neustart. Deshalb eine der beiden Varianten:

**A) Kostenlose Postgres-Datenbank (empfohlen)**
1. Auf https://neon.tech kostenlos registrieren, Projekt anlegen.
2. Die "Connection string" kopieren (beginnt mit `postgresql://...`).
3. Render -> dein Service -> Environment -> neue Variable:
   `DATABASE_URL` = der kopierte String -> Save.
Die Tabelle wird beim Start automatisch angelegt.

**B) Render Persistent Disk (kostenpflichtig)**
Disk mit Mount-Pfad `/var/data` anlegen, Variable `DATA_DIR=/var/data` setzen.

## 3. Erste Schritte in der App
1. 🔒 Admin -> einloggen (bzw. ersten Admin einrichten).
2. 📊 Auswertung -> Team: Mitarbeiter anlegen, optional Stempel-PIN & Soll-Stunden.
3. ☑️ Checklisten -> "Beispiel-Checklisten anlegen" und anpassen.
4. 📅 Schichtplan -> mit "+" Schichten eintragen, "Woche kopieren" für die Folgewoche.
5. Am Handy: Seite öffnen -> "Zum Startbildschirm hinzufügen".
