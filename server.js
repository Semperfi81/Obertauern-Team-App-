const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const DATA_FILE = path.join(__dirname, "data.json");
const MAX_ADMINS = 5;

function uid() {
  return crypto.randomBytes(6).toString("hex");
}

function hashPin(pin, salt) {
  return crypto.createHash("sha256").update(salt + ":" + pin).digest("hex");
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { admins: [], employees: [], timeEntries: [], todos: [], tasks: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return { admins: [], employees: [], timeEntries: [], todos: [], tasks: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

function persist() {
  saveData(data);
}

function getToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

function findAdminByToken(token) {
  if (!token) return null;
  return data.admins.find((a) => a.token === token) || null;
}

function requireAdmin(req, res, next) {
  const token = getToken(req);
  const admin = findAdminByToken(token);
  if (!admin) {
    return res.status(401).json({ error: "Nicht autorisiert. Bitte als Admin anmelden." });
  }
  req.admin = admin;
  next();
}

function publicAdmin(a) {
  return { id: a.id, name: a.name };
}

app.get("/api/state", (req, res) => {
  const token = getToken(req);
  const admin = findAdminByToken(token);
  res.json({
    employees: data.employees,
    timeEntries: data.timeEntries,
    todos: data.todos,
    tasks: data.tasks,
    adminCount: data.admins.length,
    isAdmin: !!admin,
    adminName: admin ? admin.name : null,
  });
});

app.post("/api/admin/setup", (req, res) => {
  const { name, pin } = req.body || {};
  if (data.admins.length > 0) {
    return res.status(400).json({ error: "Es gibt bereits Admins." });
  }
  if (!name || !pin || pin.length < 4) {
    return res.status(400).json({ error: "Name und PIN (mind. 4 Zeichen) erforderlich." });
  }
  const salt = uid();
  const admin = { id: uid(), name: name.trim(), salt, pinHash: hashPin(pin, salt), token: uid() };
  data.admins.push(admin);
  persist();
  res.json({ token: admin.token, name: admin.name });
});

app.post("/api/admin/login", (req, res) => {
  const { name, pin } = req.body || {};
  const admin = data.admins.find((a) => a.name.toLowerCase() === String(name || "").trim().toLowerCase());
  if (!admin || hashPin(pin || "", admin.salt) !== admin.pinHash) {
    return res.status(401).json({ error: "Name oder PIN falsch." });
  }
  admin.token = uid();
  persist();
  res.json({ token: admin.token, name: admin.name });
});

app.get("/api/admin/list", requireAdmin, (req, res) => {
  res.json({ admins: data.admins.map(publicAdmin) });
});

app.post("/api/admin/add", requireAdmin, (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin || pin.length < 4) {
    return res.status(400).json({ error: "Name und PIN (mind. 4 Zeichen) erforderlich." });
  }
  if (data.admins.length >= MAX_ADMINS) {
    return res.status(400).json({ error: "Maximal " + MAX_ADMINS + " Admins moeglich." });
  }
  if (data.admins.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(400).json({ error: "Dieser Admin-Name existiert bereits." });
  }
  const salt = uid();
  const admin = { id: uid(), name: name.trim(), salt, pinHash: hashPin(pin, salt), token: uid() };
  data.admins.push(admin);
  persist();
  res.json({ admins: data.admins.map(publicAdmin) });
});

app.delete("/api/admin/:id", requireAdmin, (req, res) => {
  if (data.admins.length <= 1) {
    return res.status(400).json({ error: "Der letzte Admin kann nicht entfernt werden." });
  }
  data.admins = data.admins.filter((a) => a.id !== req.params.id);
  persist();
  res.json({ admins: data.admins.map(publicAdmin) });
});

app.post("/api/employees", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name erforderlich." });
  const emp = { id: uid(), name: name.trim() };
  data.employees.push(emp);
  persist();
  res.json(emp);
});

app.delete("/api/employees/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  data.employees = data.employees.filter((e) => e.id !== id);
  data.timeEntries = data.timeEntries.filter((e) => e.employeeId !== id);
  data.todos = data.todos.filter((t) => t.employeeId !== id);
  data.tasks = data.tasks.map((t) => (t.employeeId === id ? { ...t, employeeId: null } : t));
  persist();
  res.json({ ok: true });
});

app.post("/api/time/clockin", (req, res) => {
  const { employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: "employeeId erforderlich." });
  const already = data.timeEntries.find((e) => e.employeeId === employeeId && e.end === null);
  if (already) return res.status(400).json({ error: "Bereits eingestempelt." });
  const entry = { id: uid(), employeeId, date: new Date().toISOString().slice(0, 10), start: Date.now(), end: null };
  data.timeEntries.push(entry);
  persist();
  res.json(entry);
});

app.post("/api/time/clockout", (req, res) => {
  const { employeeId } = req.body || {};
  const entry = data.timeEntries.find((e) => e.employeeId === employeeId && e.end === null);
  if (!entry) return res.status(400).json({ error: "Kein laufender Eintrag." });
  entry.end = Date.now();
  persist();
  res.json(entry);
});

app.delete("/api/time/:id", requireAdmin, (req, res) => {
  data.timeEntries = data.timeEntries.filter((e) => e.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.post("/api/todos", (req, res) => {
  const { employeeId, text, due } = req.body || {};
  if (!employeeId || !text || !text.trim()) return res.status(400).json({ error: "employeeId und text erforderlich." });
  const todo = { id: uid(), employeeId, text: text.trim(), due: due || null, done: false };
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

app.post("/api/tasks", (req, res) => {
  const { title, employeeId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "title erforderlich." });
  const task = { id: uid(), title: title.trim(), employeeId: employeeId || null, status: "offen" };
  data.tasks.push(task);
  persist();
  res.json(task);
});

app.patch("/api/tasks/:id/move", (req, res) => {
  const { status } = req.body || {};
  const task = data.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Nicht gefunden." });
  task.status = status;
  persist();
  res.json(task);
});

app.delete("/api/tasks/:id", requireAdmin, (req, res) => {
  data.tasks = data.tasks.filter((t) => t.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Team-App laeuft auf Port " + PORT));
