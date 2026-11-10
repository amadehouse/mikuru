// Stockage : un fichier JSON sur le disque (volume persistant sur Railway).
// Largement suffisant pour deux personnes et quelques milliers de reels.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Sur Railway, on écrit toujours dans le volume monté, quel que soit son chemin.
export const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.resolve("data");
export const COVERS_DIR = path.join(DATA_DIR, "covers");
const FILE = path.join(DATA_DIR, "reels.json");

fs.mkdirSync(COVERS_DIR, { recursive: true });

let reels = [];
try { reels = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { reels = []; }
// Migration : l'ancienne note globale est recopiée dans chaque catégorie du reel.
for (const r of reels) {
  if (r.catRatings) continue;
  r.catRatings = {};
  for (const cat of [...(r.cosplay || []), ...(r.format || [])])
    if (Object.keys(r.ratings || {}).length) r.catRatings[cat] = { ...r.ratings };
}
console.log(`[store] données dans ${DATA_DIR} — ${reels.length} reel(s) chargé(s)` + (process.env.RAILWAY_VOLUME_MOUNT_PATH ? " (volume Railway ✓)" : " ⚠ aucun volume Railway détecté : les données seront perdues au prochain déploiement"));

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(reels, null, 1));
    fs.renameSync(tmp, FILE);
  }, 150);
}

export const COSPLAY = ["perruque","lentilles","makeup","costume","chaussures","collants","accessoires","armes"];
export const FORMAT = ["hook","format","danse","musique","trend","photographie","video","humour","storytelling","monetisation","interaction","beaute","communaute","educatif","lifestyle","fanacc"];
export const KINDS = ["inspi","tuto"];

const pick = (arr, allowed) => Array.isArray(arr) ? [...new Set(arr.filter(x => allowed.includes(x)))] : [];

export function parseUrl(u) {
  let platform = "autre", handle = "", id = "";
  try {
    const url = new URL(String(u).trim());
    const h = url.hostname.replace(/^www\.|^vm\.|^vt\.|^m\.|^mobile\./, "");
    const p = url.pathname.split("/").filter(Boolean);
    if (/tiktok\.com$/.test(h)) { platform = "tiktok"; handle = p.find(x => x.startsWith("@")) || ""; id = p[p.indexOf("video") + 1] || ""; }
    else if (/instagram\.com$/.test(h)) { platform = "instagram"; const i = p.findIndex(x => ["reel","reels","p","tv"].includes(x)); id = i >= 0 ? p[i + 1] || "" : ""; if (i > 0) handle = "@" + p[0]; }
    else if (/(twitter|x)\.com$/.test(h)) { platform = "x"; if (p[0]) handle = "@" + p[0]; id = p[p.indexOf("status") + 1] || ""; }
    else if (/(youtube\.com|youtu\.be)$/.test(h)) { platform = "youtube"; handle = p.find(x => x.startsWith("@")) || ""; id = url.searchParams.get("v") || p[p.length - 1] || ""; }
    else handle = h;
  } catch { /* lien invalide : platform "autre" */ }
  return { platform, handle, id };
}

export function list() { return reels; }
export function get(id) { return reels.find(r => r.id === id) || null; }

export function create({ url, title = "", kind = [], cosplay = [], format = [], addedBy = "" }) {
  const meta = parseUrl(url);
  const r = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    url: String(url).trim(), title: String(title || "").trim().slice(0, 200),
    platform: meta.platform, handle: meta.handle, id_ext: meta.id,
    kind: pick(kind, KINDS), cosplay: pick(cosplay, COSPLAY), format: pick(format, FORMAT),
    cover: null, coverStatus: "pending",       // pending | ok | failed | manual
    notes: {}, ratings: {}, catRatings: {}, chars: [],
    addedBy, createdAt: Date.now(),
  };
  r.status = (r.cosplay.length + r.format.length) ? "classe" : "a_classer";
  reels.unshift(r); persist();
  return r;
}

export function update(id, patch, user) {
  const r = get(id); if (!r) return null;
  if (patch.url !== undefined) { r.url = String(patch.url).trim(); Object.assign(r, (({ platform, handle, id }) => ({ platform, handle, id_ext: id }))(parseUrl(r.url))); }
  if (patch.title !== undefined) r.title = String(patch.title || "").trim().slice(0, 200);
  if (patch.kind !== undefined) r.kind = pick(patch.kind, KINDS);
  if (patch.chars !== undefined) r.chars = Array.isArray(patch.chars) ? [...new Set(patch.chars.filter(id => chars.some(c => c.id === id)))] : [];
  if (patch.cosplay !== undefined) r.cosplay = pick(patch.cosplay, COSPLAY);
  if (patch.format !== undefined) r.format = pick(patch.format, FORMAT);
  if (patch.rating !== undefined && user) {
    const n = Number(patch.rating);
    const cat = String(patch.cat || "");
    if (COSPLAY.includes(cat) || FORMAT.includes(cat)) {            // note propre à une catégorie
      r.catRatings ??= {}; const bucket = (r.catRatings[cat] ??= {});
      if (patch.rating === null || !Number.isFinite(n)) delete bucket[user]; else bucket[user] = Math.max(1, Math.min(10, Math.round(n)));
      if (!Object.keys(bucket).length) delete r.catRatings[cat];
    }
  }
  if (patch.notes !== undefined && user) r.notes[user] = String(patch.notes || "").slice(0, 5000);
  r.status = (r.cosplay.length + r.format.length) ? "classe" : "a_classer";
  persist(); return r;
}

export function setCover(id, file, status) {
  const r = get(id); if (!r) return null;
  if (r.cover && r.cover !== file) { try { fs.unlinkSync(path.join(COVERS_DIR, r.cover)); } catch {} }
  r.cover = file; r.coverStatus = status; persist(); return r;
}

export function remove(id) {
  const i = reels.findIndex(r => r.id === id); if (i < 0) return false;
  const [r] = reels.splice(i, 1);
  for (const t of contents.items) {
    for (const k of ["musicReel", "danceReel", "formatReel"]) if (t[k] === id) t[k] = null;
    for (const x of t.extras || []) if (x.reel === id) x.reel = null;
  }
  contents.save();
  if (r.cover) { try { fs.unlinkSync(path.join(COVERS_DIR, r.cover)); } catch {} }
  persist(); return true;
}


// =====================================================================
// Cosplan : personnages prévus
// =====================================================================
const CHARS_FILE = path.join(DATA_DIR, "chars.json");
export const CHAR_STATUS = ["idee", "prep", "pret", "porte"];
export const PART_STATES = ["a_faire", "a_acheter", "en_cours", "fait", "na"];

let chars = [];
try { chars = JSON.parse(fs.readFileSync(CHARS_FILE, "utf8")); } catch { chars = []; }
let charTimer = null;
function persistChars() {
  clearTimeout(charTimer);
  charTimer = setTimeout(() => { const tmp = CHARS_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(chars, null, 1)); fs.renameSync(tmp, CHARS_FILE); }, 150);
}
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const cleanDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
function cleanPart(p = {}, prev = {}) {
  const out = { ...prev };
  if (p.state !== undefined && PART_STATES.includes(p.state)) out.state = p.state;
  if (p.cost !== undefined) { const n = Number(String(p.cost).replace(",", ".")); out.cost = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
  if (p.note !== undefined) out.note = str(p.note, 300);
  return out;
}

export function listChars() { return chars; }
export function getChar(id) { return chars.find(c => c.id === id) || null; }
export function createChar(body, user) {
  const c = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    name: str(body.name, 120) || "Sans nom", series: str(body.series, 120),
    status: CHAR_STATUS.includes(body.status) ? body.status : "idee",
    event: str(body.event, 120), date: cleanDate(body.date),
    ref: null,
    parts: Object.fromEntries(COSPLAY.map(k => [k, { state: "a_faire", cost: 0, note: "" }])),
    notes: {}, addedBy: user || "", createdAt: Date.now(),
  };
  chars.unshift(c); persistChars(); return c;
}
export function updateChar(id, patch, user) {
  const c = getChar(id); if (!c) return null;
  if (patch.name !== undefined) c.name = str(patch.name, 120) || c.name;
  if (patch.series !== undefined) c.series = str(patch.series, 120);
  if (patch.status !== undefined && CHAR_STATUS.includes(patch.status)) c.status = patch.status;
  if (patch.event !== undefined) c.event = str(patch.event, 120);
  if (patch.date !== undefined) c.date = cleanDate(patch.date);
  if (patch.parts && typeof patch.parts === "object")
    for (const [k, v] of Object.entries(patch.parts)) if (COSPLAY.includes(k)) c.parts[k] = cleanPart(v, c.parts[k]);
  if (patch.notes !== undefined && user) c.notes[user] = str(patch.notes, 5000);
  persistChars(); return c;
}
export function setCharRef(id, file) {
  const c = getChar(id); if (!c) return null;
  if (c.ref && c.ref !== file) { try { fs.unlinkSync(path.join(COVERS_DIR, c.ref)); } catch {} }
  c.ref = file; persistChars(); return c;
}
export function removeChar(id) {
  const i = chars.findIndex(c => c.id === id); if (i < 0) return false;
  const [c] = chars.splice(i, 1);
  if (c.ref) { try { fs.unlinkSync(path.join(COVERS_DIR, c.ref)); } catch {} }
  let touched = false;
  for (const r of reels) if (r.chars?.includes(id)) { r.chars = r.chars.filter(x => x !== id); touched = true; }
  if (touched) persist();
  for (const c of convs.items) for (const d of Object.keys(c.days || {})) if (c.days[d] === id) c.days[d] = null;
  convs.save();
  for (const t of contents.items) if (t.char === id) t.char = null;
  contents.save();
  persistChars(); return true;
}


// =====================================================================
// Collections simples : conventions et planning de contenu
// =====================================================================
function collection(name) {
  const file = path.join(DATA_DIR, name + ".json");
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, "utf8")); } catch { items = []; }
  let t = null;
  const col = {
    get items() { return items; },
    save() { clearTimeout(t); t = setTimeout(() => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(items, null, 1)); fs.renameSync(tmp, file); }, 150); },
    get(id) { return items.find(x => x.id === id) || null; },
    add(x) { items.unshift(x); col.save(); return x; },
    remove(id) { const i = items.findIndex(x => x.id === id); if (i < 0) return false; items.splice(i, 1); col.save(); return true; },
  };
  return col;
}
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const charOrNull = v => (v && chars.some(c => c.id === v)) ? v : null;
const reelOrNull = v => (v && reels.some(r => r.id === v)) ? v : null;
function datesBetween(a, b) {
  const out = []; if (!a) return out;
  const d = new Date(a + "T12:00:00Z"), end = new Date((b || a) + "T12:00:00Z");
  while (d <= end && out.length < 14) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// ---- Conventions ----
export const convs = collection("conventions");
function applyConv(c, b, user) {
  if (b.name !== undefined) c.name = str(b.name, 120) || c.name || "Convention";
  if (b.city !== undefined) c.city = str(b.city, 80);
  if (b.start !== undefined) c.start = cleanDate(b.start);
  if (b.end !== undefined) c.end = cleanDate(b.end);
  if (!c.end || (c.start && c.end < c.start)) c.end = c.start;
  const range = datesBetween(c.start, c.end);
  if (range.length) c.end = range[range.length - 1];
  const days = {};
  for (const d of range) days[d] = c.days?.[d] ?? null;          // garde les choix déjà faits
  if (b.days && typeof b.days === "object") for (const [d, v] of Object.entries(b.days)) if (d in days) days[d] = charOrNull(v);
  c.days = days;
  if (b.notes !== undefined && user) { c.notes ??= {}; c.notes[user] = str(b.notes, 5000); }
  return c;
}
export function createConv(b, user) { return convs.add(applyConv({ id: newId(), name: "", city: "", start: "", end: "", days: {}, notes: {}, addedBy: user || "", createdAt: Date.now() }, b, user)); }
export function updateConv(id, b, user) { const c = convs.get(id); if (!c) return null; applyConv(c, b, user); convs.save(); return c; }

// ---- Planning de contenu ----
export const contents = collection("contents");
export const CONTENT_STATUS = ["idee", "a_tourner", "tourne", "poste"];
export const PLATFORMS = ["tiktok", "instagram", "x", "youtube", "autre"];
function applyContent(t, b) {
  if (b.title !== undefined) t.title = str(b.title, 160) || t.title || "Sans titre";
  if (b.date !== undefined) t.date = cleanDate(b.date);
  if (b.status !== undefined && CONTENT_STATUS.includes(b.status)) t.status = b.status;
  if (b.char !== undefined) t.char = charOrNull(b.char);
  if (b.musicReel !== undefined) t.musicReel = reelOrNull(b.musicReel);
  if (b.musicText !== undefined) t.musicText = str(b.musicText, 120);
  if (b.danceReel !== undefined) t.danceReel = reelOrNull(b.danceReel);
  if (b.danceText !== undefined) t.danceText = str(b.danceText, 120);
  if (b.formatReel !== undefined) t.formatReel = reelOrNull(b.formatReel);
  if (b.formatText !== undefined) t.formatText = str(b.formatText, 120);
  if (b.extras !== undefined) t.extras = (Array.isArray(b.extras) ? b.extras : []).slice(0, 12).map(x => ({
    cat: FORMAT.includes(x?.cat) ? x.cat : "", label: str(x?.label, 40), reel: reelOrNull(x?.reel), text: str(x?.text, 120),
  })).filter(x => x.cat || x.label || x.reel || x.text);
  if (b.platforms !== undefined) t.platforms = Array.isArray(b.platforms) ? [...new Set(b.platforms.filter(p => PLATFORMS.includes(p)))] : [];
  if (b.notes !== undefined) t.notes = str(b.notes, 5000);
  return t;
}
export function createContent(b, user) { return contents.add(applyContent({ id: newId(), title: "", date: "", status: "idee", char: null, musicReel: null, musicText: "", danceReel: null, danceText: "", formatReel: null, formatText: "", extras: [], platforms: [], notes: "", addedBy: user || "", createdAt: Date.now() }, b)); }
export function updateContent(id, b) { const t = contents.get(id); if (!t) return null; applyContent(t, b); contents.save(); return t; }
