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
export const FORMAT = ["hook","format","danse","musique","trend","photographie","video","humour","storytelling","monetisation","interaction","beaute","communaute","educatif","lifestyle"];
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
  persistChars(); return true;
}
