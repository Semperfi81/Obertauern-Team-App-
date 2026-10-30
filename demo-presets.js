// ---------------------------------------------------------------------------
// Demo-Inhalte für Vorführversionen der Team App.
// Aktiv nur, wenn die Umgebungsvariable DEMO_PRESET gesetzt ist (z. B. "ski" oder "hotel").
// Alle Namen und Daten sind frei erfunden.
// ---------------------------------------------------------------------------

const PRESETS = {
  // ------------------------------------------------------------ Skiverleih & Sportgeschäft
  ski: {
    label: "Skiverleih & Sportgeschäft",
    admin: { name: "Chef", pin: "1234" },
    employeePin: "1111",
    locations: ["Skiverleih", "Sportgeschäft"],
    areas: ["Skiverleih", "Sportgeschäft", "Werkstatt", "Allgemein"],
    dienst: { start: "08:30", end: "18:00" },
    employees: [
      { name: "Anna Berger", home: "Skiverleih", weeklyHours: 40, start: "08:00", end: "17:30" },
      { name: "Lukas Hofer", home: "Skiverleih", weeklyHours: 40, start: "08:30", end: "18:00" },
      { name: "Sophie Wallner", home: "Sportgeschäft", weeklyHours: 30, start: "09:00", end: "15:30" },
      { name: "Jonas Gruber", home: "Skiverleih", weeklyHours: 40, start: "08:00", end: "17:30" },
      { name: "Lena Steiner", home: "Sportgeschäft", weeklyHours: 40, start: "09:00", end: "18:30" },
      { name: "Tobias Brandner", home: "Skiverleih", weeklyHours: 20, start: "13:00", end: "18:00" },
      { name: "Mia Pichler", home: "Sportgeschäft", weeklyHours: 25, start: "09:00", end: "14:00" },
    ],
    checklists: [
      { name: "Skiverleih öffnen", area: "Skiverleih", items: ["Licht & Heizung an", "Kasse / Kartenterminal einschalten", "Ski & Snowboards aus dem Depot bereitstellen", "Helme & Skischuhe sortiert", "Reservierungen für heute prüfen", "Schuhtrockner einschalten"] },
      { name: "Skiverleih schließen", area: "Skiverleih", items: ["Alle Leihgeräte zurück & gezählt", "Schäden notiert / zum Service", "Skischuhe in Trockner", "Kassenabschluss", "Depot & Türen abgeschlossen"] },
      { name: "Sportgeschäft öffnen", area: "Sportgeschäft", items: ["Alarmanlage aus, Licht an", "Kasse hochfahren & Wechselgeld zählen", "Schaufenster-Beleuchtung an", "Ware vom Vortag nachfüllen", "Umkleiden kontrolliert"] },
      { name: "Sportgeschäft schließen", area: "Sportgeschäft", items: ["Umkleiden leer & aufgeräumt", "Ware zusammenlegen / Ständer sortiert", "Kassenabschluss & Tresor", "Licht aus, Alarmanlage scharf"] },
      { name: "Ski-Service", area: "Werkstatt", items: ["Servicezettel abgearbeitet", "Kanten & Belag geprüft", "Wachs aufgefüllt", "Bindungen eingestellt & dokumentiert"] },
      { name: "Inventur Leihmaterial (Saisonstart)", area: "Allgemein", mode: "once", items: ["Ski Erwachsene gezählt", "Ski Kinder gezählt", "Snowboards gezählt", "Skischuhe nach Größen gezählt", "Helme gezählt & geprüft", "Fehlmengen an Chef gemeldet"] },
    ],
    tasks: [
      { title: "Leihski für Gruppe Müller (12 Pers.) herrichten", description: "Anreise Samstag, Größen & Gewichte liegen bei der Kassa.", status: "arbeit", priority: "hoch", location: "Skiverleih", due: 1, who: "Lukas Hofer" },
      { title: "Schaufenster auf Weihnachten umdekorieren", status: "offen", priority: "normal", location: "Sportgeschäft", due: 4, who: "Lena Steiner" },
      { title: "Helme desinfizieren & Polster tauschen", status: "offen", priority: "normal", location: "Skiverleih", due: 2, who: null },
      { title: "Neue Skischuhe (Lieferung Atomic) einbuchen", status: "offen", priority: "hoch", location: "Sportgeschäft", due: 0, who: "Sophie Wallner" },
      { title: "Preisschilder Vorjahresmodelle -30 %", status: "arbeit", priority: "niedrig", location: "Sportgeschäft", due: 3, who: "Mia Pichler" },
      { title: "Bindungen Kinderski prüfen", status: "fertig", priority: "normal", location: "Skiverleih", due: -1, who: "Jonas Gruber" },
      { title: "Wachsmaschine reinigen", status: "fertig", priority: "niedrig", location: "Skiverleih", due: -2, who: "Tobias Brandner" },
    ],
    todos: [
      { who: "Anna Berger", text: "Reservierungsliste fürs Wochenende ausdrucken", due: 1 },
      { who: "Lena Steiner", text: "Bestellung Handschuhe Gr. S nachfassen", due: 2 },
    ],
    messages: [
      { who: "Chef", text: "Guten Morgen Team! Heute kommt die Lieferung von Atomic – bitte Platz im Lager machen. 💪", ago: 180 },
      { who: "Lukas Hofer", text: "Gruppe Müller hat angerufen, sie kommen schon um 8:00. Ich bin früher da.", ago: 120 },
      { who: "Sophie Wallner", text: "Lager ist frei 👍", ago: 95 },
      { who: "Chef", text: "Danke euch! Kaffee steht im Aufenthaltsraum ☕", ago: 40 },
    ],
    ideas: [
      { who: "Jonas Gruber", text: "Könnten wir die Skischuhe nach Größen farbig markieren? Spart beim Ausgeben viel Zeit.", status: "geplant", reply: "Gute Idee – Aufkleber sind bestellt." },
      { who: "Mia Pichler", text: "Kleiner Monitor an der Kassa mit den Reservierungen von heute wäre super.", status: "neu", reply: "" },
    ],
    reminders: [
      { text: "Skischuhtrockner kontrollieren", time: "17:45", repeat: "daily", target: "all" },
    ],
  },

  // ------------------------------------------------------------ Hotellerie
  hotel: {
    label: "Hotellerie",
    admin: { name: "Direktion", pin: "1234" },
    employeePin: "1111",
    locations: ["Rezeption", "Restaurant & Bar", "Housekeeping", "Küche"],
    areas: ["Rezeption", "Restaurant & Bar", "Housekeeping", "Küche", "Wellness", "Allgemein"],
    dienst: { start: "07:00", end: "15:00" },
    employees: [
      { name: "Julia Moser", home: "Rezeption", weeklyHours: 40, start: "07:00", end: "15:00" },
      { name: "Daniel Huber", home: "Rezeption", weeklyHours: 40, start: "15:00", end: "23:00" },
      { name: "Katarina Novak", home: "Housekeeping", weeklyHours: 40, start: "08:00", end: "16:30" },
      { name: "Elif Yilmaz", home: "Housekeeping", weeklyHours: 30, start: "08:00", end: "14:00" },
      { name: "Stefan Leitner", home: "Küche", weeklyHours: 45, start: "06:30", end: "15:00" },
      { name: "Martin Egger", home: "Küche", weeklyHours: 40, start: "14:00", end: "22:30" },
      { name: "Nina Rainer", home: "Restaurant & Bar", weeklyHours: 40, start: "11:00", end: "19:30" },
      { name: "Florian Schmid", home: "Restaurant & Bar", weeklyHours: 30, start: "17:00", end: "23:30" },
    ],
    checklists: [
      { name: "Frühdienst Rezeption", area: "Rezeption", items: ["Übergabebuch Nachtdienst gelesen", "Anreisen & Abreisen für heute geprüft", "Kassa gezählt", "Frühstückszahlen an Küche gemeldet", "Wetter & Tagesprogramm an Infotafel"] },
      { name: "Übergabe Spätdienst", area: "Rezeption", items: ["Offene Zahlungen notiert", "Späte Anreisen vorbereitet (Schlüssel/Karten)", "Weckrufe eingetragen", "Übergabebuch geschrieben"] },
      { name: "Zimmer-Check nach Abreise", area: "Housekeeping", items: ["Betten frisch bezogen", "Bad gereinigt & Handtücher getauscht", "Minibar kontrolliert & nachgefüllt", "Fernbedienung & Licht getestet", "Fundsachen an Rezeption"] },
      { name: "Frühstück vorbereiten", area: "Restaurant & Bar", items: ["Kaffeemaschinen hochgefahren", "Buffet eingedeckt", "Säfte & Milch gekühlt aufgestellt", "Tische laut Belegung gedeckt"] },
      { name: "Küche schließen (HACCP)", area: "Küche", items: ["Kühlhaus-Temperatur notiert", "Lebensmittel beschriftet & abgedeckt", "Arbeitsflächen desinfiziert", "Geräte aus, Gas zu", "Müll & Altöl entsorgt"] },
      { name: "Wellness öffnen", area: "Wellness", items: ["Saunen eingeschaltet", "Wassertemperatur & Chlorwert Pool notiert", "Handtücher & Bademäntel aufgefüllt", "Ruheraum gelüftet"] },
      { name: "Brandschutz-Rundgang (monatlich)", area: "Allgemein", mode: "once", items: ["Fluchtwege frei", "Feuerlöscher Prüfplakette ok", "Notbeleuchtung getestet", "Brandschutztüren schließen selbstständig"] },
    ],
    tasks: [
      { title: "VIP-Anreise Fam. Schneider – Obstkorb & Sekt auf Zimmer 305", status: "offen", priority: "hoch", location: "Housekeeping", due: 0, who: "Katarina Novak" },
      { title: "Zimmer 214: Duschkopf tauschen", description: "Gast hat gemeldet, dass er tropft. Ersatzteil liegt im Haustechnik-Lager.", status: "arbeit", priority: "hoch", location: "Housekeeping", due: 0, who: null },
      { title: "Weinkarte Winter drucken lassen", status: "offen", priority: "normal", location: "Restaurant & Bar", due: 3, who: "Nina Rainer" },
      { title: "Allergenliste Abendkarte aktualisieren", status: "arbeit", priority: "hoch", location: "Küche", due: 1, who: "Stefan Leitner" },
      { title: "Hochzeit Samstag: Tischplan an Service geben", status: "offen", priority: "normal", location: "Rezeption", due: 2, who: "Julia Moser" },
      { title: "Bewertungen der Woche beantworten", status: "offen", priority: "niedrig", location: "Rezeption", due: 4, who: "Daniel Huber" },
      { title: "Inventur Minibar-Ware", status: "fertig", priority: "normal", location: "Housekeeping", due: -1, who: "Elif Yilmaz" },
      { title: "Kühlhaus-Dichtung prüfen lassen", status: "fertig", priority: "hoch", location: "Küche", due: -2, who: "Martin Egger" },
    ],
    todos: [
      { who: "Julia Moser", text: "Rückruf Reisebüro wegen Gruppenanfrage März", due: 0 },
      { who: "Florian Schmid", text: "Cocktailkarte: neue Wintercocktails fotografieren", due: 3 },
    ],
    messages: [
      { who: "Direktion", text: "Guten Morgen! Heute 42 Anreisen, davon eine VIP-Familie auf 305. Danke für euren Einsatz! 🙏", ago: 200 },
      { who: "Katarina Novak", text: "305 ist fertig, Obstkorb kommt um 14 Uhr aufs Zimmer.", ago: 110 },
      { who: "Stefan Leitner", text: "Achtung: heute Abend 3 Gäste mit Glutenunverträglichkeit, steht auf der Liste.", ago: 75 },
      { who: "Nina Rainer", text: "Alles klar, gebe ich an den Service weiter 👍", ago: 60 },
    ],
    ideas: [
      { who: "Julia Moser", text: "Ein QR-Code im Zimmer für Housekeeping-Wünsche (Handtücher, Kissen) würde uns viele Anrufe sparen.", status: "geplant", reply: "Super Idee, nehmen wir für die nächste Saison mit." },
      { who: "Martin Egger", text: "Digitale Temperaturliste fürs Kühlhaus statt Zettel?", status: "neu", reply: "" },
    ],
    reminders: [
      { text: "Pool-Chlorwert messen & eintragen", time: "10:00", repeat: "daily", target: "all" },
    ],
  },
};

module.exports = { PRESETS };
