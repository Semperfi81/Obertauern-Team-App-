const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

const MAX_ADMINS = 5;
const TZ = "Europe/Vienna";
const LOCATIONS = ["E-Bike Verleih", "Trial / Funpark", "Footgolf", "Alpine Mini Market", "Allgemein"];

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
    shifts: [], checklistTemplates: [], checklistRuns: [],
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
function requireAdmin(req, res, next) {
  const admin = findAdminByToken(getToken(req));
  if (!admin) return res.status(401).json({ error: "Nicht autorisiert. Bitte als Admin anmelden." });
  req.admin = admin;
  next();
}
// Mitarbeiter-Aktionen: Admin darf immer, sonst PIN prüfen (falls gesetzt)
function checkEmployee(req, res, employeeId) {
  const emp = data.employees.find((e) => e.id === employeeId);
  if (!emp) { res.status(404).json({ error: "Mitarbeiter nicht gefunden." }); return null; }
  if (findAdminByToken(getToken(req))) return emp;
  if (emp.pinHash) {
    const pin = str((req.body || {}).pin, 20);
    if (!pin || hashPin(pin, emp.salt) !== emp.pinHash) {
      res.status(403).json({ error: "PIN falsch.", needPin: true });
      return null;
    }
  }
  return emp;
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
  const admin = findAdminByToken(getToken(req));
  res.json({
    employees: data.employees.map(publicEmployee),
    timeEntries: data.timeEntries,
    todos: data.todos,
    tasks: data.tasks,
    shifts: data.shifts,
    checklistTemplates: data.checklistTemplates,
    checklistRuns: data.checklistRuns.filter((r) => r.date >= localDate(Date.now() - 14 * 864e5)),
    locations: LOCATIONS,
    today: localDate(),
    adminCount: data.admins.length,
    isAdmin: !!admin,
    adminName: admin ? admin.name : null,
  });
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
  const admin = data.admins.find((a) => a.name.toLowerCase() === str(name).toLowerCase());
  if (!admin || hashPin(String(pin || ""), admin.salt) !== admin.pinHash) return res.status(401).json({ error: "Name oder PIN falsch." });
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
  if (!name) return res.status(400).json({ error: "Name erforderlich." });
  const emp = { id: uid(), name, active: true, weeklyHours: null };
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
  if (b.pin !== undefined) {
    const pin = str(b.pin, 20);
    if (pin === "") { delete emp.pinHash; delete emp.salt; }
    else if (pin.length < 4) return res.status(400).json({ error: "PIN muss mind. 4 Zeichen haben." });
    else { emp.salt = uid(); emp.pinHash = hashPin(pin, emp.salt); }
  }
  persist();
  res.json(publicEmployee(emp));
});

app.delete("/api/employees/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  data.employees = data.employees.filter((e) => e.id !== id);
  data.timeEntries = data.timeEntries.filter((e) => e.employeeId !== id);
  data.todos = data.todos.filter((t) => t.employeeId !== id);
  data.shifts = data.shifts.filter((s) => s.employeeId !== id);
  data.tasks = data.tasks.map((t) => (t.employeeId === id ? { ...t, employeeId: null } : t));
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Zeiterfassung
// ---------------------------------------------------------------------------
app.post("/api/time/clockin", (req, res) => {
  const { employeeId, location } = req.body || {};
  const emp = checkEmployee(req, res, employeeId);
  if (!emp) return;
  if (runningEntry(employeeId)) return res.status(400).json({ error: "Bereits eingestempelt." });
  const now = Date.now();
  const entry = {
    id: uid(), employeeId, date: localDate(now), start: now, end: null, breaks: [],
    location: LOCATIONS.includes(location) ? location : null, note: "", manualBreakMin: null,
  };
  data.timeEntries.push(entry);
  persist();
  res.json(entry);
});

app.post("/api/time/pause", (req, res) => {
  const { employeeId } = req.body || {};
  if (!checkEmployee(req, res, employeeId)) return;
  const entry = runningEntry(employeeId);
  if (!entry) return res.status(400).json({ error: "Nicht eingestempelt." });
  const open = entry.breaks.find((b) => b.end === null);
  if (open) open.end = Date.now();          // Pause beenden
  else entry.breaks.push({ start: Date.now(), end: null }); // Pause starten
  persist();
  res.json(entry);
});

app.post("/api/time/clockout", (req, res) => {
  const { employeeId } = req.body || {};
  if (!checkEmployee(req, res, employeeId)) return;
  const entry = runningEntry(employeeId);
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
    location: b.location !== undefined ? (LOCATIONS.includes(b.location) ? b.location : null) : existing ? existing.location : null,
    note: b.note !== undefined ? str(b.note, 300) : existing ? existing.note : "",
  };
}

app.post("/api/time", requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!data.employees.some((e) => e.id === b.employeeId)) return res.status(400).json({ error: "Mitarbeiter fehlt." });
  const p = parseEntryBody(b, null);
  if (p.error) return res.status(400).json(p);
  const entry = { id: uid(), employeeId: b.employeeId, breaks: [], ...p, editedBy: req.admin.name, editedAt: Date.now() };
  data.timeEntries.push(entry);
  persist();
  res.json(entry);
});

app.patch("/api/time/:id", requireAdmin, (req, res) => {
  const entry = data.timeEntries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Nicht gefunden." });
  const p = parseEntryBody(req.body || {}, entry);
  if (p.error) return res.status(400).json(p);
  Object.assign(entry, p, { editedBy: req.admin.name, editedAt: Date.now() });
  if (entry.end !== null) entry.breaks.forEach((b) => { if (b.end === null) b.end = entry.end; });
  persist();
  res.json(entry);
});

app.delete("/api/time/:id", requireAdmin, (req, res) => {
  data.timeEntries = data.timeEntries.filter((e) => e.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// To-Dos
// ---------------------------------------------------------------------------
app.post("/api/todos", (req, res) => {
  const { employeeId, text, due } = req.body || {};
  if (!employeeId || !str(text)) return res.status(400).json({ error: "Mitarbeiter und Text erforderlich." });
  const todo = { id: uid(), employeeId, text: str(text), due: isDate(due) ? due : null, done: false };
  data.todos.push(todo);
  persist();
  res.json(todo);
});

app.patch("/api/todos/:id/toggle", (req, res) => {
  const todo = data.todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Nicht gefunden." });
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
  if (b.location !== undefined) task.location = LOCATIONS.includes(b.location) ? b.location : null;
  if (b.due !== undefined) task.due = isDate(b.due) ? b.due : null;
  if (b.priority !== undefined) task.priority = PRIORITIES.includes(b.priority) ? b.priority : "normal";
  if (b.status !== undefined && TASK_STATUS.includes(b.status)) {
    if (b.status === "fertig" && task.status !== "fertig") task.doneAt = Date.now();
    if (b.status !== "fertig") task.doneAt = null;
    task.status = b.status;
  }
}

app.post("/api/tasks", (req, res) => {
  const b = req.body || {};
  if (!str(b.title)) return res.status(400).json({ error: "Titel erforderlich." });
  const task = { id: uid(), title: "", description: "", employeeId: null, status: "offen", location: null, due: null, priority: "normal", createdAt: Date.now(), doneAt: null };
  applyTaskFields(task, b);
  data.tasks.push(task);
  persist();
  res.json(task);
});

app.patch("/api/tasks/:id", (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Nicht gefunden." });
  applyTaskFields(task, req.body || {});
  if (!task.title) return res.status(400).json({ error: "Titel erforderlich." });
  persist();
  res.json(task);
});

// alte Route (Kompatibilität)
app.patch("/api/tasks/:id/move", (req, res) => {
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Nicht gefunden." });
  applyTaskFields(task, { status: (req.body || {}).status });
  persist();
  res.json(task);
});

app.delete("/api/tasks/:id", requireAdmin, (req, res) => {
  data.tasks = data.tasks.filter((t) => t.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Checklisten (z. B. Öffnen / Schließen je Standort)
// ---------------------------------------------------------------------------
function templateFromBody(b, t) {
  const items = (Array.isArray(b.items) ? b.items : String(b.items || "").split("\n")).map((i) => str(i, 200)).filter(Boolean).slice(0, 60);
  const name = str(b.name, 100);
  if (!name) return { error: "Name erforderlich." };
  if (!items.length) return { error: "Mindestens ein Punkt erforderlich." };
  return { ...(t || { id: uid() }), name, items, location: LOCATIONS.includes(b.location) ? b.location : null };
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
app.post("/api/checklists/check", (req, res) => {
  const { templateId, item, employeeId } = req.body || {};
  const date = isDate((req.body || {}).date) ? req.body.date : localDate();
  const tpl = data.checklistTemplates.find((t) => t.id === templateId);
  if (!tpl || !tpl.items.includes(item)) return res.status(400).json({ error: "Checkliste oder Punkt nicht gefunden." });
  const emp = data.employees.find((e) => e.id === employeeId);
  if (!emp) return res.status(400).json({ error: "Bitte oben einen Mitarbeiter auswählen." });
  let run = data.checklistRuns.find((r) => r.templateId === templateId && r.date === date);
  if (!run) { run = { id: uid(), templateId, date, checks: {} }; data.checklistRuns.push(run); }
  if (run.checks[item]) delete run.checks[item];
  else run.checks[item] = { by: emp.id, byName: emp.name, at: Date.now() };
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
  if (b.location !== undefined) out.location = LOCATIONS.includes(b.location) ? b.location : null;
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
