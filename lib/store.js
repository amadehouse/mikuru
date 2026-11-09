// Stockage : un fichier JSON sur le disque (volume persistant sur Railway).
// Largement suffisant pour deux personnes et quelques milliers de reels.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
export const COVERS_DIR = path.join(DATA_DIR, "covers");
const FILE = path.join(DATA_DIR, "reels.json");

fs.mkdirSync(COVERS_DIR, { recursive: true });

let reels = [];
try { reels = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { reels = []; }

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
    notes: {}, ratings: {},
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
  if (patch.cosplay !== undefined) r.cosplay = pick(patch.cosplay, COSPLAY);
  if (patch.format !== undefined) r.format = pick(patch.format, FORMAT);
  if (patch.rating !== undefined && user) {
    const n = Number(patch.rating);
    if (patch.rating === null || !Number.isFinite(n)) delete r.ratings[user]; else r.ratings[user] = Math.max(1, Math.min(10, Math.round(n)));
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
