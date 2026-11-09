// La Cour d'Irina — serveur : site statique + API + vignettes + bot Discord (même processus).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as store from "./lib/store.js";
import { enqueueCover } from "./lib/thumbs.js";
import { startBot } from "./bot.js";

const PORT = Number(process.env.PORT || 3000);

// Cookies Instagram fournis en base64 via les variables Railway (voir README §5)
if (process.env.YTDLP_COOKIES_B64) {
  const f = path.join(process.env.DATA_DIR || "data", "cookies.txt");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(process.env.YTDLP_COOKIES_B64, "base64"));
  process.env.YTDLP_COOKIES = f;
}
const PUBLIC_DIR = path.resolve("public");
const SECRET = process.env.SESSION_SECRET || (console.warn("⚠ SESSION_SECRET manquant : sessions perdues à chaque redémarrage"), crypto.randomBytes(32).toString("hex"));

// USERS="Esteban:1234,Irina:5678"
const USERS = Object.fromEntries((process.env.USERS || "Esteban:1234,Irina:5678").split(",").map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf(":"); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));

// --- sessions (cookie signé HMAC) -----------------------------------------
const sign = v => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
const makeToken = user => { const p = Buffer.from(JSON.stringify({ u: user, t: Date.now() })).toString("base64url"); return p + "." + sign(p); };
function readUser(req) {
  const m = /(?:^|;\s*)cour=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return null;
  const [p, s] = m[1].split("."); if (!p || !s || sign(p) !== s) return null;
  try { const { u } = JSON.parse(Buffer.from(p, "base64url").toString()); return USERS[u] !== undefined ? u : null; } catch { return null; }
}
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// --- helpers --------------------------------------------------------------
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
const err = (res, code, msg) => json(res, code, { error: msg });
function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((ok, ko) => { const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { ko(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks))); req.on("error", ko); });
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
function serveFile(res, file, cache = "no-cache") {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return err(res, 404, "not_found");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cache });
  fs.createReadStream(file).pipe(res);
}
const publicReel = r => r; // tout est visible pour les deux membres de la cour

// --- routes ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    // Site
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
    if (req.method === "GET" && p.startsWith("/assets/")) return serveFile(res, path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[\/\\])+/, "")), "public, max-age=86400");

    // Auth
    if (p === "/api/login" && req.method === "POST") {
      const { user, pin } = JSON.parse((await readBody(req, 4096)).toString() || "{}");
      if (!USERS[user] || !safeEq(String(pin || ""), USERS[user])) return err(res, 401, "bad_pin");
      return json(res, 200, { user }, { "Set-Cookie": `cour=${makeToken(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}` });
    }
    if (p === "/api/logout" && req.method === "POST") return json(res, 200, { ok: true }, { "Set-Cookie": "cour=; Path=/; Max-Age=0" });
    if (p === "/api/users" && req.method === "GET") return json(res, 200, { users: Object.keys(USERS) });

    // Tout le reste est privé
    const user = readUser(req);
    if (!user) return err(res, 401, "auth");
    if (p === "/api/me") return json(res, 200, { user, users: Object.keys(USERS) });

    if (p.startsWith("/covers/") && req.method === "GET") return serveFile(res, path.join(store.COVERS_DIR, path.basename(p)), "public, max-age=31536000, immutable");

    if (p === "/api/reels" && req.method === "GET") return json(res, 200, { reels: store.list().map(publicReel) });
    if (p === "/api/reels" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}");
      if (!/^https?:\/\//i.test(String(body.url || ""))) return err(res, 400, "bad_url");
      const r = store.create({ ...body, addedBy: user });
      enqueueCover(r.id); // en arrière-plan
      return json(res, 201, { reel: r });
    }
    const m = /^\/api\/reels\/([a-z0-9]+)(?:\/(cover|refetch))?$/.exec(p);
    if (m) {
      const [, id, sub] = m;
      if (!store.get(id)) return err(res, 404, "not_found");
      if (!sub && req.method === "PATCH") { const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}"); return json(res, 200, { reel: store.update(id, body, user) }); }
      if (!sub && req.method === "DELETE") { store.remove(id); return json(res, 200, { ok: true }); }
      if (sub === "cover" && req.method === "POST") {           // capture envoyée à la main (body = image brute)
        const ct = (req.headers["content-type"] || "").split(";")[0];
        const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[ct]; if (!ext) return err(res, 415, "unsupported_type");
        let buf; try { buf = await readBody(req, 12 * 1024 * 1024); } catch { return err(res, 413, "too_large"); }
        const file = `${id}-${Date.now().toString(36)}.${ext}`; fs.writeFileSync(path.join(store.COVERS_DIR, file), buf);
        return json(res, 200, { reel: store.setCover(id, file, "manual") });
      }
      if (sub === "cover" && req.method === "DELETE") return json(res, 200, { reel: store.setCover(id, null, "failed") });
      if (sub === "refetch" && req.method === "POST") { const r = await enqueueCover(id, { force: true }); return json(res, 200, { reel: r }); }
    }
    return err(res, 404, "not_found");
  } catch (e) {
    console.error(e); return err(res, e.message === "too_large" ? 413 : 500, e.message === "too_large" ? "too_large" : "server_error");
  }
});

server.listen(PORT, () => console.log(`✦ La Cour d'Irina écoute sur le port ${PORT}`));
startBot().catch(e => console.error("[discord] bot non démarré :", e.message));
