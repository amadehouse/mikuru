// Vignettes automatiques : récupère la cover officielle du reel.
// Ordre : API légère par plateforme → yt-dlp (fallback universel, Instagram) → sinon "failed".
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COVERS_DIR, parseUrl, setCover, get } from "./store.js";

const run = promisify(execFile);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function fetchJson(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function download(imgUrl, id) {
  const res = await fetch(imgUrl, { headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const ct = (res.headers.get("content-type") || "").split(";")[0];
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("image vide");
  const file = `${id}-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(COVERS_DIR, file), buf);
  return file;
}

// --- sources par plateforme ---------------------------------------------
async function tiktok(url) {
  const j = await fetchJson("https://www.tiktok.com/oembed?url=" + encodeURIComponent(url));
  return { img: j.thumbnail_url, title: j.title };
}
async function twitter(meta) {
  if (!meta.id) throw new Error("id tweet manquant");
  const j = await fetchJson("https://api.fxtwitter.com/status/" + meta.id);
  const t = j.tweet || {};
  const v = t.media?.videos?.[0]?.thumbnail_url, p = t.media?.photos?.[0]?.url;
  return { img: v || p, title: t.text?.slice(0, 120) };
}
async function youtube(meta) {
  if (!meta.id) throw new Error("id vidéo manquant");
  return { img: `https://i.ytimg.com/vi/${meta.id}/hqdefault.jpg` };
}
async function ytdlp(url) {
  const args = ["-j", "--no-warnings", "--no-playlist", "--skip-download"];
  if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) args.push("--cookies", process.env.YTDLP_COOKIES);
  args.push(url);
  const { stdout } = await run("yt-dlp", args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(stdout.split("\n").find(Boolean));
  const best = (j.thumbnails || []).filter(t => t.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return { img: best?.url || j.thumbnail, title: j.title };
}

// --- point d'entrée -------------------------------------------------------
export async function fetchCover(reelId, { force = false } = {}) {
  const r = get(reelId); if (!r) return null;
  if (r.coverStatus === "manual" && !force) return r; // capture mise à la main : on ne l'écrase pas
  const meta = parseUrl(r.url);
  const attempts = [];
  if (meta.platform === "tiktok") attempts.push(() => tiktok(r.url));
  if (meta.platform === "x") attempts.push(() => twitter(meta));
  if (meta.platform === "youtube") attempts.push(() => youtube(meta));
  attempts.push(() => ytdlp(r.url)); // fallback universel + Instagram

  for (const attempt of attempts) {
    try {
      const { img, title } = await attempt();
      if (!img) continue;
      const file = await download(img, r.id);
      if (!r.title && title) r.title = String(title).replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
      return setCover(r.id, file, "ok");
    } catch (e) {
      console.warn(`[thumbs] ${r.platform} ${r.id}: ${e.message?.split("\n")[0]}`);
    }
  }
  r.coverStatus = "failed";
  setCover(r.id, r.cover, "failed");
  return r;
}

// File d'attente simple : une récupération à la fois (évite de se faire bloquer).
const queue = [];
let busy = false;
export function enqueueCover(reelId, opts) {
  return new Promise(resolve => {
    queue.push({ reelId, opts, resolve });
    pump();
  });
}
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const { reelId, opts, resolve } = queue.shift();
    try { resolve(await fetchCover(reelId, opts)); } catch (e) { console.error("[thumbs]", e); resolve(null); }
  }
  busy = false;
}
