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
// Lien TikTok propre, sans ?q=…&t=… (les paramètres de partage font parfois échouer les API)
const tiktokCanonical = (url, meta) => meta.handle && meta.id ? `https://www.tiktok.com/${meta.handle}/video/${meta.id}` : url;
async function tiktok(url, meta) {
  const j = await fetchJson("https://www.tiktok.com/oembed?url=" + encodeURIComponent(tiktokCanonical(url, meta)));
  if (!j.thumbnail_url) throw new Error("oembed sans vignette : " + JSON.stringify(j).slice(0, 160));
  return { img: j.thumbnail_url, title: j.title };
}
// Secours : tikwm.com, service tiers gratuit (peut disparaître ou limiter un jour)
async function tikwm(url, meta) {
  const j = await fetchJson("https://www.tikwm.com/api/?url=" + encodeURIComponent(tiktokCanonical(url, meta)));
  const img = j.data?.origin_cover || j.data?.cover;
  if (!img) throw new Error("tikwm sans vignette : " + JSON.stringify(j).slice(0, 160));
  return { img, title: j.data?.title };
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
  let stdout;
  try { ({ stdout } = await run("yt-dlp", args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 })); }
  catch (e) { throw new Error("yt-dlp : " + String(e.stderr || e.message).trim().split("\n").slice(-2).join(" | ").slice(0, 300)); }
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
  if (meta.platform === "tiktok") attempts.push(["oembed", () => tiktok(r.url, meta)], ["tikwm", () => tikwm(r.url, meta)]);
  if (meta.platform === "x") attempts.push(["fxtwitter", () => twitter(meta)]);
  if (meta.platform === "youtube") attempts.push(["youtube", () => youtube(meta)]);
  attempts.push(["yt-dlp", () => ytdlp(meta.platform === "tiktok" ? tiktokCanonical(r.url, meta) : r.url)]); // fallback universel + Instagram

  for (const [name, attempt] of attempts) {
    try {
      const { img, title } = await attempt();
      if (!img) { console.warn(`[thumbs] ${r.platform} ${r.id} (${name}): pas d'image`); continue; }
      const file = await download(img, r.id);
      console.log(`[thumbs] ${r.platform} ${r.id}: vignette OK via ${name}`);
      if (!r.title && title) r.title = String(title).replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
      return setCover(r.id, file, "ok");
    } catch (e) {
      console.warn(`[thumbs] ${r.platform} ${r.id} (${name}): ${e.message}`);
    }
  }
  r.coverStatus = "failed";
  setCover(r.id, r.cover, "failed");
  return r;
}

// Vignette fournie de l'extérieur (ex : aperçu généré par Discord sous le message).
export async function coverFromImageUrl(reelId, imgUrl, title) {
  const r = get(reelId); if (!r || !imgUrl) return r;
  try {
    const file = await download(imgUrl, r.id);
    if (!r.title && title) r.title = String(title).replace(/^TikTok\s*·\s*/i, "").replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    return setCover(r.id, file, "ok");
  } catch (e) {
    console.warn(`[thumbs] aperçu externe ${r.id}: ${e.message}`);
    return r;
  }
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
