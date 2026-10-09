const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let webpush = null;
try { webpush = require("web-push"); } catch (e) { console.warn("web-push nicht installiert – keine Push-Benachrichtigungen."); }

const app = express();
app.use(express.json({ limit: "12mb" })); // Fotos kommen als Base64

const MAX_ADMINS = 5;
const TZ = "Europe/Vienna";
// Standorte (Zeiterfassung, Schichten, Aufgaben) und Bereiche (Checklisten) –
// Startwerte, danach vom Admin in der App unter Auswertung → Einstellungen änderbar
const DEFAULT_LOCATIONS = ["Haupt", "Grünwaldkopf"];
const DEFAULT_AREAS = ["Skiverleih", "Alpine Mini Market", "Allgemein"];
// Automatische Mittagspause: wird pro Tag abgezogen, sobald mehr als minHours gearbeitet wurde.
// Selbst gestempelte Pausen werden darauf angerechnet.
const DEFAULT_LUNCH = { enabled: true, minutes: 60, minHours: 6 };
const LOCS = () => data.settings.locations;
const AREAS = () => data.settings.areas;

// ---------------------------------------------------------------------------
// Speicherung
//  - DATABASE_URL gesetzt  -> Postgres (z. B. Neon, Supabase, Render Postgres)
//  - sonst                 -> JSON-Datei in DATA_DIR (Standard: Projektordner)
//  ACHTUNG Render: Ohne Datenbank oder "Persistent Disk" geht data.json bei
//  jedem Deploy/Neustart verloren!
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
let pgPool = null;

function emptyData() {
  return {
    admins: [], employees: [], timeEntries: [], todos: [], tasks: [],
    shifts: [], checklistTemplates: [], checklistRuns: [], sessions: [], messages: [], pushSubs: [],
    settings: { locations: DEFAULT_LOCATIONS.slice(), areas: DEFAULT_AREAS.slice(), lunch: { ...DEFAULT_LUNCH } },
  };
}

// Alte Datensätze auf das neue Format bringen
function normalize(d) {
  const base = emptyData();
  for (const k of Object.keys(base)) if (!Array.isArray(d[k])) d[k] = base[k];
  d.employees.forEach((e) => {
    if (e.active === undefined) e.active = true;
    if (e.weeklyHours === undefined) e.weeklyHours = null;
  });
  d.timeEntries.forEach((e) => {
    if (!Array.isArray(e.breaks)) e.breaks = [];
    if (e.location === undefined) e.location = null;
    if (e.note === undefined) e.note = "";
    if (e.manualBreakMin === undefined) e.manualBreakMin = null;
  });
  if (!d.settings || typeof d.settings !== "object") d.settings = {};
  if (!Array.isArray(d.settings.locations) || !d.settings.locations.length) d.settings.locations = DEFAULT_LOCATIONS.slice();
  if (!Array.isArray(d.settings.areas) || !d.settings.areas.length) d.settings.areas = DEFAULT_AREAS.slice();
  if (!d.settings.lunch) d.settings.lunch = { ...DEFAULT_LUNCH };
  // Einmalig: alte Sommer-Beispiellisten (E-Bike, Funpark, Footgolf) entfernen
  if (!d.settings.winter2026) {
    const old = ["E-Bike Verleih öffnen", "E-Bike Verleih schließen", "Funpark Kontrolle", "Footgolf Platzrunde"];
    const drop = new Set(d.checklistTemplates.filter((t) => old.includes(t.name)).map((t) => t.id));
    d.checklistTemplates = d.checklistTemplates.filter((t) => !drop.has(t.id));
    d.checklistRuns = d.checklistRuns.filter((r) => !drop.has(r.templateId));
    d.settings.winter2026 = true;
  }
  d.checklistTemplates.forEach((t) => {
    if (!t.area) t.area = t.location || "Allgemein";
    if (["E-Bike Verleih", "Trial / Funpark", "Footgolf"].includes(t.area)) t.area = "Allgemein";
  });
  d.tasks.forEach((t) => {
    if (t.description === undefined) t.description = "";
    if (t.location === undefined) t.location = null;
    if (t.due === undefined) t.due = null;
    if (t.priority === undefined) t.priority = "normal";
    if (t.createdAt === undefined) t.createdAt = Date.now();
  });
  return d;
}

async function loadData() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
    });
    await pgPool.query("CREATE TABLE IF NOT EXISTS app_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())");
    await pgPool.query("CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, created TIMESTAMPTZ DEFAULT now())");
    const r = await pgPool.query("SELECT data FROM app_state WHERE id = 1");
    if (r.rows.length) return normalize(r.rows[0].data);
    // Erste Verbindung: vorhandene data.json übernehmen, falls da
    let initial = emptyData();
    if (fs.existsSync(DATA_FILE)) {
      try { initial = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
    }
    initial = normalize(initial);
    await pgPool.query("INSERT INTO app_state (id, data) VALUES (1, $1)", [initial]);
    console.log("Postgres: Tabelle angelegt.");
    return initial;
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const initial = emptyData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return normalize(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch (e) {
    console.error("data.json konnte nicht gelesen werden:", e.message);
    return emptyData();
  }
}

let data = emptyData();
let saveTimer = null;
let saving = Promise.resolve();

async function writeNow() {
  const snapshot = JSON.stringify(data);
  if (pgPool) {
    await pgPool.query("UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1", [snapshot]);
  } else {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, snapshot);
    fs.renameSync(tmp, DATA_FILE);
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(writeNow).catch((e) => console.error("Speichern fehlgeschlagen:", e.message));
  }, 300);
}

async function flush() {
  clearTimeout(saveTimer);
  await saving;
  await writeNow();
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
function uid() {
  return crypto.randomBytes(6).toString("hex");
}
// PINs werden zusätzlich verschlüsselt gespeichert, damit Admins sie bei
// Bedarf einsehen können. Schlüssel: Umgebungsvariable PIN_KEY oder automatisch erzeugt.
function pinKey() {
  if (process.env.PIN_KEY) return crypto.createHash("sha256").update(process.env.PIN_KEY).digest();
  if (!data.secrets) data.secrets = {};
  if (!data.secrets.pinKey) { data.secrets.pinKey = crypto.randomBytes(32).toString("hex"); persist(); }
  return Buffer.from(data.secrets.pinKey, "hex");
}
function encryptPin(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", pinKey(), iv);
  const enc = Buffer.concat([c.update(pin, "utf8"), c.final()]);
  return [iv.toString("hex"), c.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}
function decryptPin(v) {
  try {
    const [iv, tag, enc] = v.split(":").map((x) => Buffer.from(x, "hex"));
    const d = crypto.createDecipheriv("aes-256-gcm", pinKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch (e) { return null; }
}
function setEmployeePin(emp, pin) {
  emp.salt = uid(); emp.pinHash = hashPin(pin, emp.salt); emp.pinEnc = encryptPin(pin); emp.pinSetAt = Date.now();
}
const PIN_RE = /^[0-9A-Za-z]{4,12}$/;

function hashPin(pin, salt) {
  return crypto.createHash("sha256").update(salt + ":" + pin).digest("hex");
}
function localDate(ts = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
const str = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);

function getToken(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}
function findAdminByToken(token) {
  if (!token) return null;
  return data.admins.find((a) => a.token === token) || null;
}
// Mitarbeiter-Sitzung (Login mit Name + PIN)
function findEmployeeByToken(token) {
  if (!token) return null;
  const s = data.sessions.find((x) => x.token === token);
  if (!s) return null;
  const emp = data.employees.find((e) => e.id === s.employeeId);
  return emp && emp.active !== false ? emp : null;
}
const isAdminEntry = (t) => typeof t.employeeId === "string" && t.employeeId.startsWith("admin:");
// Admin-Zeiten sehen alle Admins, ändern darf sie nur der jeweilige Admin selbst
function foreignAdminEntry(req, entry) {
  return isAdminEntry(entry) && entry.employeeId !== "admin:" + req.admin.id;
}
function getAuth(req) {
  const token = getToken(req);
  const admin = findAdminByToken(token);
  return { admin, employee: admin ? null : findEmployeeByToken(token) };
}
function requireUser(req, res, next) {
  const a = getAuth(req);
  if (!a.admin && !a.employee) return res.status(401).json({ error: "Bitte zuerst anmelden.", needLogin: true });
  req.auth = a;
  next();
}
// Für welche Person gilt eine Stempel-Aktion? Mitarbeiter: immer sich selbst. Admin: frei wählbar.
function targetEmployee(req, res) {
  const { admin, employee } = req.auth;
  if (employee) return employee;
  const wanted = (req.body || {}).employeeId;
  // Admin stempelt für sich selbst (versteckte Admin-Zeiterfassung)
  if (wanted === "admin:" + admin.id) return { id: wanted, name: admin.name };
  const emp = data.employees.find((e) => e.id === wanted);
  if (!emp) { res.status(404).json({ error: "Mitarbeiter nicht gefunden." }); return null; }
  return emp;
}
// Schutz gegen PIN-Raten: 5 Fehlversuche -> 5 Minuten gesperrt
const failed = new Map();
function isLocked(key) {
  const f = failed.get(key);
  return f && f.count >= 5 && Date.now() - f.last < 5 * 60000;
}
function noteFail(key) {
  const f = failed.get(key) || { count: 0, last: 0 };
  if (Date.now() - f.last > 5 * 60000) f.count = 0;
  f.count++; f.last = Date.now();
  failed.set(key, f);
}
function requireAdmin(req, res, next) {
  const admin = findAdminByToken(getToken(req));
  if (!admin) return res.status(401).json({ error: "Nicht autorisiert. Bitte als Admin anmelden." });
  req.admin = admin;
  next();
}
function publicAdmin(a) {
  return { id: a.id, name: a.name };
}
function publicEmployee(e) {
  return { id: e.id, name: e.name, active: e.active !== false, weeklyHours: e.weeklyHours, hasPin: !!e.pinHash };
}
function runningEntry(employeeId) {
  return data.timeEntries.find((e) => e.employeeId === employeeId && e.end === null);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
app.get("/api/state", (req, res) => {
  const { admin, employee } = getAuth(req);
  const base = { locations: LOCS(), areas: AREAS(), lunch: data.settings.lunch, today: localDate(), adminCount: data.admins.length };
  if (!admin && !employee) {
    // Nicht angemeldet: nur Namen für die Login-Auswahl
    return res.json({
      ...base, role: null,
      loginEmployees: data.employees.filter((e) => e.active !== false).map((e) => ({ id: e.id, name: e.name, hasPin: !!e.pinHash }))
        .sort((x, y) => x.name.localeCompare(y.name, "de")),
    });
  }
  res.json({
    ...base,
    role: admin ? "admin" : "employee",
    adminName: admin ? admin.name : null,
    me: employee ? { id: employee.id, name: employee.name } : null,
    myAuthorId: employee ? employee.id : "admin:" + admin.id,
    // Admins (für Admin-Zeiterfassung) – nur Admins bekommen diese Liste
    admins: admin ? data.admins.map((a) => ({ id: "admin:" + a.id, name: a.name })) : undefined,
    employees: data.employees.map(publicEmployee),
    // Arbeitszeiten: Admin sieht alle, Mitarbeiter nur die eigenen
    // Admin: alle Zeiten (inkl. Admin-Zeiten aller Admins). Mitarbeiter: nur die eigenen
    timeEntries: admin ? data.timeEntries : data.timeEntries.filter((t) => t.employeeId === employee.id),
    // Aufgaben/To-Dos: Mitarbeiter sehen nur ihre eigenen und die "für alle"
    todos: admin ? data.todos : data.todos.filter((t) => t.employeeId === employee.id),
    tasks: admin ? data.tasks : data.tasks.filter((t) => canSeeTask(t, employee)),
    shifts: data.shifts,
    checklistTemplates: data.checklistTemplates,
    checklistRuns: data.checklistRuns.filter((r) => r.date >= localDate(Date.now() - 14 * 864e5)),
    messages: data.messages.slice(-200),
  });
});

// ---------------------------------------------------------------------------
// Mitarbeiter-Login
// ---------------------------------------------------------------------------
app.post("/api/login", (req, res) => {
  const { employeeId, pin } = req.body || {};
  const emp = data.employees.find((e) => e.id === employeeId && e.active !== false);
  if (!emp) return res.status(401).json({ error: "Name oder PIN falsch." });
  if (!emp.pinHash) return res.status(409).json({ error: "Du hast noch keine PIN – bitte lege jetzt deine PIN fest.", needSetup: true });
  if (isLocked("emp:" + emp.id)) return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte 5 Minuten warten." });
  if (hashPin(str(pin, 20), emp.salt) !== emp.pinHash) { noteFail("emp:" + emp.id); return res.status(401).json({ error: "Name oder PIN falsch." }); }
  failed.delete("emp:" + emp.id);
  if (!emp.pinEnc) emp.pinEnc = encryptPin(str(pin, 20)); // ältere Konten: PIN nachträglich für Admin einsehbar machen
  res.json(startSession(emp));
});

function startSession(emp) {
  const token = uid() + uid() + uid();
  data.sessions.push({ token, employeeId: emp.id, created: Date.now() });
  // pro Mitarbeiter max. 5 Geräte angemeldet
  const mine = data.sessions.filter((x) => x.employeeId === emp.id);
  if (mine.length > 5) { const drop = new Set(mine.slice(0, mine.length - 5).map((x) => x.token)); data.sessions = data.sessions.filter((x) => !drop.has(x.token)); }
  persist();
  return { token, role: "employee", name: emp.name };
}

// Erste Anmeldung: Mitarbeiter ohne PIN legt seine PIN selbst fest
app.post("/api/setup-pin", (req, res) => {
  const { employeeId, pin } = req.body || {};
  const emp = data.employees.find((e) => e.id === employeeId && e.active !== false);
  if (!emp) return res.status(404).json({ error: "Mitarbeiter nicht gefunden." });
  if (emp.pinHash) return res.status(409).json({ error: "Für dich gibt es schon eine PIN. Bitte damit anmelden." });
  const p = str(pin, 20);
  if (!PIN_RE.test(p)) return res.status(400).json({ error: "PIN: 4–12 Ziffern oder Buchstaben." });
  setEmployeePin(emp, p);
  res.json(startSession(emp));
});

app.post("/api/logout", (req, res) => {
  const token = getToken(req);
  data.sessions = data.sessions.filter((x) => x.token !== token);
  persist();
  res.json({ ok: true });
});

// Mitarbeiter ändert eigene PIN
app.post("/api/me/pin", requireUser, (req, res) => {
  const emp = req.auth.employee;
  if (!emp) return res.status(400).json({ error: "Nur für Mitarbeiter." });
  const { oldPin, newPin } = req.body || {};
  if (hashPin(str(oldPin, 20), emp.salt) !== emp.pinHash) return res.status(403).json({ error: "Alte PIN falsch." });
  const np = str(newPin, 20);
  if (!PIN_RE.test(np)) return res.status(400).json({ error: "PIN: 4–12 Ziffern oder Buchstaben." });
  setEmployeePin(emp, np);
  const token = getToken(req);
  data.sessions = data.sessions.filter((x) => x.employeeId !== emp.id || x.token === token); // andere Geräte abmelden
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------
app.post("/api/admin/setup", (req, res) => {
  const { name, pin } = req.body || {};
  if (data.admins.length > 0) return res.status(400).json({ error: "Es gibt bereits Admins. Bitte einloggen." });
  if (!name || !pin || String(pin).length < 4) return res.status(400).json({ error: "Name und PIN (mind. 4 Zeichen) erforderlich." });
  const salt = uid();
  const admin = { id: uid(), name: str(name, 50), salt, pinHash: hashPin(String(pin), salt), token: uid() + uid() };
  data.admins.push(admin);
  persist();
  res.json({ token: admin.token, name: admin.name });
});

app.post("/api/admin/login", (req, res) => {
  const { name, pin } = req.body || {};
  const key = "admin:" + str(name).toLowerCase();
  if (isLocked(key)) return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte 5 Minuten warten." });
  const admin = data.admins.find((a) => a.name.toLowerCase() === str(name).toLowerCase());
  if (!admin || hashPin(String(pin || ""), admin.salt) !== admin.pinHash) { noteFail(key); return res.status(401).json({ error: "Name oder PIN falsch." }); }
  failed.delete(key);
  admin.token = uid() + uid();
  persist();
  res.json({ token: admin.token, name: admin.name });
});

app.get("/api/admin/list", requireAdmin, (req, res) => res.json({ admins: data.admins.map(publicAdmin) }));

app.post("/api/admin/add", requireAdmin, (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin || String(pin).length < 4) return res.status(400).json({ error: "Name und PIN (mind. 4 Zeichen) erforderlich." });
  if (data.admins.length >= MAX_ADMINS) return res.status(400).json({ error: `Maximal ${MAX_ADMINS} Admins möglich.` });
  if (data.admins.some((a) => a.name.toLowerCase() === str(name).toLowerCase())) return res.status(400).json({ error: "Dieser Admin-Name existiert bereits." });
  const salt = uid();
  data.admins.push({ id: uid(), name: str(name, 50), salt, pinHash: hashPin(String(pin), salt), token: uid() + uid() });
  persist();
  res.json({ admins: data.admins.map(publicAdmin) });
});

app.delete("/api/admin/:id", requireAdmin, (req, res) => {
  if (data.admins.length <= 1) return res.status(400).json({ error: "Der letzte Admin kann nicht entfernt werden." });
  data.admins = data.admins.filter((a) => a.id !== req.params.id);
  persist();
  res.json({ admins: data.admins.map(publicAdmin) });
});

// ---------------------------------------------------------------------------
// Mitarbeiter
// ---------------------------------------------------------------------------
app.post("/api/employees", (req, res) => {
  // Solange noch kein Admin existiert, darf jeder anlegen (Ersteinrichtung)
  if (data.admins.length > 0 && !findAdminByToken(getToken(req))) {
    return res.status(401).json({ error: "Nur Admins können Mitarbeiter anlegen." });
  }
  const name = str((req.body || {}).name, 50);
  const pin = str((req.body || {}).pin, 20);
  if (!name) return res.status(400).json({ error: "Name erforderlich." });
  if (pin && !PIN_RE.test(pin)) return res.status(400).json({ error: "PIN: 4–12 Ziffern oder Buchstaben (oder leer lassen – dann vergibt der Mitarbeiter sie selbst)." });
  if (data.employees.some((e) => e.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: "Diesen Namen gibt es schon." });
  const emp = { id: uid(), name, active: true, weeklyHours: null };
  if (pin) setEmployeePin(emp, pin);
  data.employees.push(emp);
  persist();
  res.json(publicEmployee(emp));
});

app.patch("/api/employees/:id", requireAdmin, (req, res) => {
  const emp = data.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: "Nicht gefunden." });
  const b = req.body || {};
  if (b.name !== undefined && str(b.name, 50)) emp.name = str(b.name, 50);
  if (b.active !== undefined) emp.active = !!b.active;
  if (b.weeklyHours !== undefined) {
    const h = b.weeklyHours === null || b.weeklyHours === "" ? null : Number(b.weeklyHours);
    emp.weeklyHours = h === null || isNaN(h) ? null : Math.max(0, Math.min(80, h));
  }
  if (b.resetPin) {
    // PIN löschen: Mitarbeiter legt beim nächsten Öffnen eine neue fest
    delete emp.pinHash; delete emp.salt; delete emp.pinEnc; delete emp.pinSetAt;
    data.sessions = data.sessions.filter((x) => x.employeeId !== emp.id);
  } else if (b.pin !== undefined && str(b.pin, 20) !== "") {
    const pin = str(b.pin, 20);
    if (!PIN_RE.test(pin)) return res.status(400).json({ error: "PIN: 4–12 Ziffern oder Buchstaben." });
    setEmployeePin(emp, pin);
    data.sessions = data.sessions.filter((x) => x.employeeId !== emp.id); // alle Geräte abmelden
  }
  if (emp.active === false) data.sessions = data.sessions.filter((x) => x.employeeId !== emp.id);
  persist();
  res.json(publicEmployee(emp));
});

// Admin: PIN eines Mitarbeiters anzeigen (falls vergessen)
app.get("/api/employees/:id/pin", requireAdmin, (req, res) => {
  const emp = data.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: "Nicht gefunden." });
  if (!emp.pinHash) return res.json({ pin: null, reason: "none" });
  const pin = emp.pinEnc ? decryptPin(emp.pinEnc) : null;
  res.json({ pin, reason: pin ? null : "unknown" });
});

app.delete("/api/employees/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  data.employees = data.employees.filter((e) => e.id !== id);
  data.timeEntries = data.timeEntries.filter((e) => e.employeeId !== id);
  data.todos = data.todos.filter((t) => t.employeeId !== id);
  data.shifts = data.shifts.filter((s) => s.employeeId !== id);
  data.sessions = data.sessions.filter((x) => x.employeeId !== id);
  data.pushSubs = data.pushSubs.filter((x) => x.ownerId !== id);
  data.tasks = data.tasks.map((t) => (t.employeeId === id ? { ...t, employeeId: null } : t));
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Zeiterfassung
// ---------------------------------------------------------------------------
app.post("/api/time/clockin", requireUser, (req, res) => {
  const { location } = req.body || {};
  const emp = targetEmployee(req, res);
  if (!emp) return;
  const employeeId = emp.id;
  if (runningEntry(employeeId)) return res.status(400).json({ error: "Bereits eingestempelt." });
  const now = Date.now();
  const entry = {
    id: uid(), employeeId, date: localDate(now), start: now, end: null, breaks: [],
    location: LOCS().includes(location) ? location : null, note: "", manualBreakMin: null,
  };
  data.timeEntries.push(entry);
  persist();
  res.json(entry);
});

app.post("/api/time/pause", requireUser, (req, res) => {
  const emp = targetEmployee(req, res);
  if (!emp) return;
  const entry = runningEntry(emp.id);
  if (!entry) return res.status(400).json({ error: "Nicht eingestempelt." });
  const open = entry.breaks.find((b) => b.end === null);
  if (open) open.end = Date.now();          // Pause beenden
  else entry.breaks.push({ start: Date.now(), end: null }); // Pause starten
  persist();
  res.json(entry);
});

app.post("/api/time/clockout", requireUser, (req, res) => {
  const emp = targetEmployee(req, res);
  if (!emp) return;
  const entry = runningEntry(emp.id);
  if (!entry) return res.status(400).json({ error: "Kein laufender Eintrag." });
  const now = Date.now();
  entry.breaks.forEach((b) => { if (b.end === null) b.end = now; });
  entry.end = now;
  persist();
  res.json(entry);
});

// Admin: Eintrag manuell anlegen (z. B. vergessen zu stempeln)
function parseEntryBody(b, existing) {
  const date = b.date !== undefined ? b.date : existing && existing.date;
  if (!isDate(date)) return { error: "Datum ungültig." };
  const toTs = (d, t) => new Date(`${d}T${t}:00`).getTime(); // Vorsicht: nur für Fallback
  // Zeiten kommen als ms-Timestamp (vom Browser berechnet) oder "HH:MM"
  let start = b.start !== undefined ? b.start : existing && existing.start;
  let end = b.end !== undefined ? b.end : existing && existing.end;
  if (isTime(start)) start = toTs(date, start);
  if (isTime(end)) end = toTs(date, end);
  start = Number(start);
  end = end === null ? null : Number(end);
  if (!start || isNaN(start)) return { error: "Startzeit ungültig." };
  if (end !== null && (isNaN(end) || end <= start)) return { error: "Ende muss nach dem Start liegen." };
  let manualBreakMin = b.breakMin !== undefined ? b.breakMin : existing ? existing.manualBreakMin : null;
  manualBreakMin = manualBreakMin === null || manualBreakMin === "" ? null : Math.max(0, Math.round(Number(manualBreakMin) || 0));
  return {
    date, start, end, manualBreakMin,
    location: b.location !== undefined ? (LOCS().includes(b.location) ? b.location : null) : existing ? existing.location : null,
    note: b.note !== undefined ? str(b.note, 300) : existing ? existing.note : "",
  };
}

app.post("/api/time", requireAdmin, (req, res) => {
  const b = req.body || {};
  const isAdminPerson = b.employeeId === "admin:" + req.admin.id;
  if (typeof b.employeeId === "string" && b.employeeId.startsWith("admin:") && !isAdminPerson) return res.status(403).json({ error: "Admin-Zeiten kann nur der jeweilige Admin selbst eintragen." });
  if (!isAdminPerson && !data.employees.some((e) => e.id === b.employeeId)) return res.status(400).json({ error: "Mitarbeiter fehlt." });
  const p = parseEntryBody(b, null);
  if (p.error) return res.status(400).json(p);
  const entry = { id: uid(), employeeId: b.employeeId, breaks: [], ...p, editedBy: req.admin.name, editedAt: Date.now() };
  data.timeEntries.push(entry);
  persist();
  res.json(entry);
});

app.patch("/api/time/:id", requireAdmin, (req, res) => {
  const entry = data.timeEntries.find((e) => e.id === req.params.id);
  if (!entry || foreignAdminEntry(req, entry)) return res.status(404).json({ error: "Nicht gefunden." });
  const p = parseEntryBody(req.body || {}, entry);
  if (p.error) return res.status(400).json(p);
  Object.assign(entry, p, { editedBy: req.admin.name, editedAt: Date.now() });
  if (entry.end !== null) entry.breaks.forEach((b) => { if (b.end === null) b.end = entry.end; });
  persist();
  res.json(entry);
});

app.delete("/api/time/:id", requireAdmin, (req, res) => {
  const entry = data.timeEntries.find((e) => e.id === req.params.id);
  if (!entry || foreignAdminEntry(req, entry)) return res.status(404).json({ error: "Nicht gefunden." });
  data.timeEntries = data.timeEntries.filter((e) => e.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// To-Dos
// ---------------------------------------------------------------------------
app.post("/api/todos", requireUser, (req, res) => {
  const { text, due } = req.body || {};
  const employeeId = req.auth.employee ? req.auth.employee.id : (req.body || {}).employeeId;
  if (!employeeId || !str(text)) return res.status(400).json({ error: "Mitarbeiter und Text erforderlich." });
  const todo = { id: uid(), employeeId, text: str(text), due: isDate(due) ? due : null, done: false };
  data.todos.push(todo);
  persist();
  res.json(todo);
});

app.patch("/api/todos/:id/toggle", requireUser, (req, res) => {
  const todo = data.todos.find((t) => t.id === req.params.id);
  if (!todo || (req.auth.employee && todo.employeeId !== req.auth.employee.id)) return res.status(404).json({ error: "Nicht gefunden." });
  todo.done = !todo.done;
  persist();
  res.json(todo);
});

app.delete("/api/todos/:id", requireAdmin, (req, res) => {
  data.todos = data.todos.filter((t) => t.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Aufgaben (Workflow-Board)
// ---------------------------------------------------------------------------
const TASK_STATUS = ["offen", "arbeit", "fertig"];
const PRIORITIES = ["niedrig", "normal", "hoch"];

function applyTaskFields(task, b) {
  if (b.title !== undefined) task.title = str(b.title, 200);
  if (b.description !== undefined) task.description = str(b.description, 2000);
  if (b.employeeId !== undefined) task.employeeId = data.employees.some((e) => e.id === b.employeeId) ? b.employeeId : null;
  if (b.location !== undefined) task.location = LOCS().includes(b.location) ? b.location : null;
  if (b.due !== undefined) task.due = isDate(b.due) ? b.due : null;
  if (b.priority !== undefined) task.priority = PRIORITIES.includes(b.priority) ? b.priority : "normal";
  if (b.status !== undefined && TASK_STATUS.includes(b.status)) {
    if (b.status === "fertig" && task.status !== "fertig") task.doneAt = Date.now();
    if (b.status !== "fertig") task.doneAt = null;
    task.status = b.status;
  }
}

function canSeeTask(t, employee) {
  return !t.employeeId || t.employeeId === employee.id;
}
// Mitarbeiter dürfen Aufgaben nur sich selbst oder "allen" zuweisen
function checkAssign(req, res) {
  const b = req.body || {};
  const emp = req.auth.employee;
  if (emp && b.employeeId !== undefined && b.employeeId && b.employeeId !== emp.id) {
    res.status(403).json({ error: "Nur Admins können Aufgaben anderen zuweisen." });
    return false;
  }
  return true;
}

function notifyTask(task, auth) {
  const author = auth.employee ? auth.employee.id : "admin:" + auth.admin.id;
  if (!task.employeeId) {
    // Aufgabe für alle: alle aktiven Mitarbeiter (außer Ersteller) benachrichtigen
    pushTo((s) => s.ownerId !== author && !s.ownerId.startsWith("admin:") && ownerActive(s.ownerId),
      { title: "📋 Neue Aufgabe für alle", body: task.title, tag: "task-" + task.id, url: "/?tab=aufgaben" }).catch(() => {});
    return;
  }
  if (auth.employee && auth.employee.id === task.employeeId) return;
  notifyEmployee(task.employeeId, { title: "📋 Neue Aufgabe für dich", body: task.title + (task.due ? " · fällig " + task.due.split("-").reverse().join(".") : ""), tag: "task-" + task.id, url: "/?tab=aufgaben" });
}

app.post("/api/tasks", requireUser, (req, res) => {
  const b = req.body || {};
  if (!str(b.title)) return res.status(400).json({ error: "Titel erforderlich." });
  if (!checkAssign(req, res)) return;
  const task = { id: uid(), title: "", description: "", employeeId: null, status: "offen", location: null, due: null, priority: "normal", createdAt: Date.now(), doneAt: null };
  applyTaskFields(task, b);
  data.tasks.push(task);
  persist();
  res.json(task);
  notifyTask(task, req.auth);
});

app.patch("/api/tasks/:id", requireUser, (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task || (req.auth.employee && !canSeeTask(task, req.auth.employee))) return res.status(404).json({ error: "Nicht gefunden." });
  if (!checkAssign(req, res)) return;
  const before = task.employeeId;
  applyTaskFields(task, req.body || {});
  if (!task.title) return res.status(400).json({ error: "Titel erforderlich." });
  persist();
  res.json(task);
  if (task.employeeId !== before) notifyTask(task, req.auth);
});

// alte Route (Kompatibilität)
app.patch("/api/tasks/:id/move", requireUser, (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task || (req.auth.employee && !canSeeTask(task, req.auth.employee))) return res.status(404).json({ error: "Nicht gefunden." });
  applyTaskFields(task, { status: (req.body || {}).status });
  persist();
  res.json(task);
});

app.delete("/api/tasks/:id", requireAdmin, (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  data.tasks = data.tasks.filter((t) => t.id !== req.params.id);
  persist();
  res.json({ ok: true });
  if (task) deletePhotos((task.photos || []).map((p) => p.id)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Checklisten (z. B. Öffnen / Schließen je Standort)
// ---------------------------------------------------------------------------
function templateFromBody(b, t) {
  const items = (Array.isArray(b.items) ? b.items : String(b.items || "").split("\n")).map((i) => str(i, 200)).filter(Boolean).slice(0, 60);
  const name = str(b.name, 100);
  if (!name) return { error: "Name erforderlich." };
  if (!items.length) return { error: "Mindestens ein Punkt erforderlich." };
  const area = str(b.area !== undefined ? b.area : b.location, 40);
  return { ...(t || { id: uid() }), name, items, area: AREAS().includes(area) ? area : "Allgemein", location: null };
}

app.post("/api/checklists/templates", requireAdmin, (req, res) => {
  const t = templateFromBody(req.body || {});
  if (t.error) return res.status(400).json(t);
  data.checklistTemplates.push(t);
  persist();
  res.json(t);
});

app.patch("/api/checklists/templates/:id", requireAdmin, (req, res) => {
  const idx = data.checklistTemplates.findIndex((t) => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Nicht gefunden." });
  const t = templateFromBody(req.body || {}, data.checklistTemplates[idx]);
  if (t.error) return res.status(400).json(t);
  data.checklistTemplates[idx] = t;
  persist();
  res.json(t);
});

app.delete("/api/checklists/templates/:id", requireAdmin, (req, res) => {
  data.checklistTemplates = data.checklistTemplates.filter((t) => t.id !== req.params.id);
  data.checklistRuns = data.checklistRuns.filter((r) => r.templateId !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Punkt abhaken / zurücksetzen. Punkte werden über ihren Text gespeichert,
// damit Änderungen an der Vorlage alte Häkchen nicht verschieben.
app.post("/api/checklists/check", requireUser, (req, res) => {
  const { templateId, item } = req.body || {};
  const date = isDate((req.body || {}).date) ? req.body.date : localDate();
  const tpl = data.checklistTemplates.find((t) => t.id === templateId);
  if (!tpl || !tpl.items.includes(item)) return res.status(400).json({ error: "Checkliste oder Punkt nicht gefunden." });
  const who = req.auth.employee ? { by: req.auth.employee.id, byName: req.auth.employee.name } : { by: null, byName: req.auth.admin.name };
  let run = data.checklistRuns.find((r) => r.templateId === templateId && r.date === date);
  if (!run) { run = { id: uid(), templateId, date, checks: {} }; data.checklistRuns.push(run); }
  if (run.checks[item]) delete run.checks[item];
  else run.checks[item] = { ...who, at: Date.now() };
  persist();
  res.json(run);
});

// ---------------------------------------------------------------------------
// Schichtplan
// ---------------------------------------------------------------------------
function shiftFromBody(b, s) {
  const out = { ...(s || { id: uid() }) };
  if (b.employeeId !== undefined) out.employeeId = b.employeeId;
  if (b.date !== undefined) out.date = b.date;
  if (b.start !== undefined) out.start = b.start;
  if (b.end !== undefined) out.end = b.end;
  if (b.location !== undefined) out.location = LOCS().includes(b.location) ? b.location : null;
  if (b.note !== undefined) out.note = str(b.note, 200);
  if (!data.employees.some((e) => e.id === out.employeeId)) return { error: "Mitarbeiter fehlt." };
  if (!isDate(out.date)) return { error: "Datum ungültig." };
  if (!isTime(out.start) || !isTime(out.end)) return { error: "Zeiten im Format HH:MM angeben." };
  if (out.end <= out.start) return { error: "Ende muss nach dem Beginn liegen." };
  if (out.note === undefined) out.note = "";
  if (out.location === undefined) out.location = null;
  return out;
}

app.post("/api/shifts", requireAdmin, (req, res) => {
  const s = shiftFromBody(req.body || {});
  if (s.error) return res.status(400).json(s);
  data.shifts.push(s);
  persist();
  res.json(s);
  if (s.date >= localDate()) {
    const d = new Date(s.date + "T12:00:00Z").toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
    notifyEmployee(s.employeeId, { title: "📅 Neue Schicht", body: `${d} ${s.start}–${s.end}${s.location ? " · " + s.location : ""}`, tag: "shift-" + s.id, url: "/?tab=schichten" });
  }
});

app.patch("/api/shifts/:id", requireAdmin, (req, res) => {
  const idx = data.shifts.findIndex((s) => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Nicht gefunden." });
  const s = shiftFromBody(req.body || {}, data.shifts[idx]);
  if (s.error) return res.status(400).json(s);
  data.shifts[idx] = s;
  persist();
  res.json(s);
});

app.delete("/api/shifts/:id", requireAdmin, (req, res) => {
  data.shifts = data.shifts.filter((s) => s.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Ganze Woche kopieren (Montag -> Montag)
app.post("/api/shifts/copy-week", requireAdmin, (req, res) => {
  const { from, to } = req.body || {};
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "Datum ungültig." });
  const addDays = (iso, n) => {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const diff = Math.round((new Date(to + "T12:00:00Z") - new Date(from + "T12:00:00Z")) / 864e5);
  const src = data.shifts.filter((s) => s.date >= from && s.date <= addDays(from, 6));
  let created = 0;
  src.forEach((s) => {
    const date = addDays(s.date, diff);
    const dup = data.shifts.some((x) => x.employeeId === s.employeeId && x.date === date && x.start === s.start && x.end === s.end);
    if (!dup) { data.shifts.push({ ...s, id: uid(), date }); created++; }
  });
  persist();
  res.json({ created });
});

// ---------------------------------------------------------------------------
// Push-Benachrichtigungen (Web Push). Schlüssel werden automatisch erzeugt
// und in der Datenbank gespeichert – keine Einrichtung nötig.
// ---------------------------------------------------------------------------
function setupPush() {
  if (!webpush) return;
  if (!data.vapid || !data.vapid.publicKey) { data.vapid = webpush.generateVAPIDKeys(); persist(); }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:team@sport-gefaell.at", data.vapid.publicKey, data.vapid.privateKey);
}
function ownerOf(auth) {
  return auth.employee ? auth.employee.id : "admin:" + auth.admin.id;
}
// Sendet an alle Abos, die filter(sub) erfüllen
async function pushTo(filter, payload) {
  if (!webpush || !data.vapid) return 0;
  const subs = data.pushSubs.filter(filter);
  const body = JSON.stringify(payload);
  let sent = 0, removed = false;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s.subscription, body, { TTL: 60 * 60 * 24 }); sent++; }
    catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { data.pushSubs = data.pushSubs.filter((x) => x !== s); removed = true; }
      else console.warn("Push fehlgeschlagen:", e && (e.statusCode || e.message));
    }
  }));
  if (removed) persist();
  return sent;
}
// Nur aktive Mitarbeiter bzw. existierende Admins benachrichtigen
function ownerActive(ownerId) {
  if (ownerId.startsWith("admin:")) return data.admins.some((a) => "admin:" + a.id === ownerId);
  const e = data.employees.find((x) => x.id === ownerId);
  return !!e && e.active !== false;
}
function notifyEmployee(employeeId, payload) {
  pushTo((s) => s.ownerId === employeeId && ownerActive(s.ownerId), payload).catch(() => {});
}

app.get("/api/push/key", (req, res) => {
  res.json({ publicKey: data.vapid && webpush ? data.vapid.publicKey : null });
});

app.post("/api/push/subscribe", requireUser, (req, res) => {
  const sub = (req.body || {}).subscription;
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ error: "Ungültiges Abo." });
  data.pushSubs = data.pushSubs.filter((x) => x.subscription.endpoint !== sub.endpoint);
  data.pushSubs.push({ ownerId: ownerOf(req.auth), subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, created: Date.now() });
  persist();
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = (req.body || {}).endpoint;
  data.pushSubs = data.pushSubs.filter((x) => x.subscription.endpoint !== endpoint);
  persist();
  res.json({ ok: true });
});

app.post("/api/push/test", requireUser, async (req, res) => {
  const me = ownerOf(req.auth);
  const sent = await pushTo((s) => s.ownerId === me, { title: "Crew Sport Gefäll", body: "Benachrichtigungen funktionieren ✓", tag: "test", url: "/" });
  res.json({ sent });
});

// ---------------------------------------------------------------------------
// Einstellungen: Standorte & Checklisten-Bereiche (nur Admin)
// ---------------------------------------------------------------------------
function cleanList(v) {
  const arr = (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => str(x, 40)).filter(Boolean);
  const seen = new Set();
  return arr.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
}
app.put("/api/settings", requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.locations !== undefined) {
    const l = cleanList(b.locations);
    if (!l.length) return res.status(400).json({ error: "Mindestens ein Standort nötig." });
    data.settings.locations = l;
  }
  if (b.areas !== undefined) {
    const a = cleanList(b.areas);
    if (!a.length) return res.status(400).json({ error: "Mindestens ein Bereich nötig." });
    data.settings.areas = a;
  }
  if (b.lunch !== undefined && b.lunch && typeof b.lunch === "object") {
    const m = Math.round(Number(b.lunch.minutes)), h = Number(b.lunch.minHours);
    data.settings.lunch = {
      enabled: !!b.lunch.enabled,
      minutes: isNaN(m) ? 60 : Math.max(0, Math.min(180, m)),
      minHours: isNaN(h) ? 6 : Math.max(0, Math.min(16, h)),
    };
  }
  persist();
  res.json(data.settings);
});

// ---------------------------------------------------------------------------
// Fotos – getrennt vom restlichen Datenbestand gespeichert (Postgres-Tabelle
// "photos" bzw. Ordner DATA_DIR/photos), damit die App schnell bleibt.
// Fotos werden im Browser vorher verkleinert (max. 1600 px, JPEG).
// ---------------------------------------------------------------------------
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const photoId = () => crypto.randomBytes(16).toString("hex");

function parseDataUrl(u) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ""));
  if (!m) return null;
  const buf = Buffer.from(m[3], "base64");
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
  return { mime: m[1], buf };
}
async function savePhoto(dataUrl) {
  const p = parseDataUrl(dataUrl);
  if (!p) throw new Error("Foto ungültig oder zu groß (max. 4 MB).");
  const id = photoId();
  if (pgPool) await pgPool.query("INSERT INTO photos (id, mime, data) VALUES ($1, $2, $3)", [id, p.mime, p.buf]);
  else { fs.mkdirSync(PHOTO_DIR, { recursive: true }); fs.writeFileSync(path.join(PHOTO_DIR, id), JSON.stringify({ mime: p.mime, data: p.buf.toString("base64") })); }
  return id;
}
async function loadPhoto(id) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  if (pgPool) { const r = await pgPool.query("SELECT mime, data FROM photos WHERE id = $1", [id]); return r.rows[0] ? { mime: r.rows[0].mime, buf: r.rows[0].data } : null; }
  const f = path.join(PHOTO_DIR, id);
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  return { mime: j.mime, buf: Buffer.from(j.data, "base64") };
}
async function deletePhotos(ids) {
  for (const id of ids || []) {
    if (!/^[0-9a-f]{32}$/.test(id)) continue;
    try {
      if (pgPool) await pgPool.query("DELETE FROM photos WHERE id = $1", [id]);
      else fs.rmSync(path.join(PHOTO_DIR, id), { force: true });
    } catch (e) { console.warn("Foto löschen fehlgeschlagen:", e.message); }
  }
}

// Foto abrufen (nur angemeldet; IDs sind zufällig und nicht erratbar)
app.get("/api/photos/:id", requireUser, async (req, res) => {
  try {
    const p = await loadPhoto(req.params.id);
    if (!p) return res.status(404).json({ error: "Foto nicht gefunden." });
    res.setHeader("Content-Type", p.mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.end(p.buf);
  } catch (e) { res.status(500).json({ error: "Foto konnte nicht geladen werden." }); }
});

// Foto zu einer Aufgabe hinzufügen / entfernen
app.post("/api/tasks/:id/photos", requireUser, async (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task || (req.auth.employee && !canSeeTask(task, req.auth.employee))) return res.status(404).json({ error: "Nicht gefunden." });
  if ((task.photos || []).length >= 20) return res.status(400).json({ error: "Maximal 20 Fotos pro Aufgabe." });
  try {
    const id = await savePhoto((req.body || {}).dataUrl);
    const { admin, employee } = req.auth;
    task.photos = task.photos || [];
    task.photos.push({ id, at: Date.now(), byName: employee ? employee.name : admin.name, by: employee ? employee.id : "admin:" + admin.id });
    persist();
    res.json(task);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/tasks/:id/photos/:pid", requireUser, async (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task || (req.auth.employee && !canSeeTask(task, req.auth.employee))) return res.status(404).json({ error: "Nicht gefunden." });
  const ph = (task.photos || []).find((p) => p.id === req.params.pid);
  if (!ph) return res.status(404).json({ error: "Foto nicht gefunden." });
  const { admin, employee } = req.auth;
  if (!admin && ph.by !== employee.id) return res.status(403).json({ error: "Nur eigene Fotos löschbar." });
  task.photos = task.photos.filter((p) => p.id !== ph.id);
  persist();
  await deletePhotos([ph.id]);
  res.json(task);
});

// ---------------------------------------------------------------------------
// Gruppenchat
// ---------------------------------------------------------------------------
const MAX_MESSAGES = 2000;

app.post("/api/chat", requireUser, async (req, res) => {
  const text = str((req.body || {}).text, 2000);
  const images = Array.isArray((req.body || {}).photos) ? req.body.photos.slice(0, 4) : [];
  if (!text && !images.length) return res.status(400).json({ error: "Nachricht ist leer." });
  let photos = [];
  try { for (const u of images) photos.push(await savePhoto(u)); }
  catch (e) { await deletePhotos(photos); return res.status(400).json({ error: e.message }); }
  const { admin, employee } = req.auth;
  const msg = {
    id: uid(), text, photos, at: Date.now(),
    authorId: employee ? employee.id : "admin:" + admin.id,
    authorName: employee ? employee.name : admin.name,
    isAdmin: !!admin,
  };
  data.messages.push(msg);
  if (data.messages.length > MAX_MESSAGES) {
    const old = data.messages.slice(0, data.messages.length - MAX_MESSAGES);
    data.messages = data.messages.slice(-MAX_MESSAGES);
    deletePhotos(old.flatMap((m) => m.photos || [])).catch(() => {});
  }
  persist();
  res.json(msg);
  pushTo((s) => s.ownerId !== msg.authorId && ownerActive(s.ownerId), {
    title: "💬 " + msg.authorName, body: (photos.length ? "📷 Foto" + (text ? " · " : "") : "") + (text.length > 140 ? text.slice(0, 137) + "…" : text), tag: "chat", url: "/?tab=chat",
  }).catch(() => {});
});

// Löschen: eigene Nachricht oder als Admin jede
app.delete("/api/chat/:id", requireUser, (req, res) => {
  const msg = data.messages.find((m) => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: "Nicht gefunden." });
  const { admin, employee } = req.auth;
  if (!admin && msg.authorId !== employee.id) return res.status(403).json({ error: "Nur eigene Nachrichten löschbar." });
  data.messages = data.messages.filter((m) => m.id !== msg.id);
  persist();
  res.json({ ok: true });
  deletePhotos(msg.photos).catch(() => {});
});

// ---------------------------------------------------------------------------
// Statisches Frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, file) => {
    // Service Worker und HTML nie lange cachen, damit Updates sofort ankommen
    if (file.endsWith("service-worker.js") || file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
loadData()
  .then((d) => {
    data = d;
    setupPush();
    app.listen(PORT, () => console.log(`Team-App läuft auf Port ${PORT} (${pgPool ? "Postgres" : "Datei: " + DATA_FILE})`));
  })
  .catch((e) => {
    console.error("Start fehlgeschlagen:", e);
    process.exit(1);
  });

// Beim Beenden (Render-Deploy) ausstehende Änderungen noch speichern
["SIGTERM", "SIGINT"].forEach((sig) =>
  process.on(sig, () => flush().catch(() => {}).finally(() => process.exit(0)))
);
