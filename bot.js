// Bot Discord : envoie un lien TikTok / Instagram / X / YouTube dans le salon (ou en DM),
// il crée la fiche, récupère la vignette et répond avec un aperçu. Les #hashtags deviennent des tags.
//   ex : https://www.tiktok.com/@x/video/123  #perruque #inspi
import path from "node:path";
import * as store from "./lib/store.js";
import { enqueueCover, coverFromImageUrl } from "./lib/thumbs.js";

const URL_RE = /https?:\/\/(?:www\.|vm\.|vt\.|m\.|mobile\.)?(?:tiktok\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be)\/\S+/gi;
const strip = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ALIASES = { tutorial: "tuto", tutoriel: "tuto", inspiration: "inspi", lentille: "lentilles", accessoire: "accessoires", arme: "armes", chaussure: "chaussures", collant: "collants", maquillage: "makeup", wig: "perruque", photo: "photographie", monetisation: "monetisation", beaute: "beaute", communaute: "communaute", educatif: "educatif", fanacc: "fanacc", fanedit: "fanacc", fanaccount: "fanacc", fan: "fanacc", edit: "fanacc" };

function tagsFrom(text) {
  const out = { kind: [], cosplay: [], format: [] };
  for (const m of text.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    let t = strip(m[1]); t = ALIASES[t] || t;
    if (store.KINDS.includes(t)) out.kind.push(t);
    else if (store.COSPLAY.includes(t)) out.cosplay.push(t);
    else if (store.FORMAT.includes(t)) out.format.push(t);
  }
  return out;
}

const pathOf = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\.|^m\./, "") + x.pathname).replace(/\/$/, ""); } catch { return u; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Discord ajoute l'aperçu (embed) du lien une à quelques secondes après l'envoi du message.
async function embedsOf(msg) {
  for (let i = 0; i < 5; i++) {
    if (msg.embeds?.length) return msg.embeds;
    await sleep(1500);
    try { msg = await msg.fetch(true); } catch { break; }
  }
  return msg.embeds || [];
}
function imageFromEmbeds(embeds, url, single) {
  const e = embeds.find(e => e.url && pathOf(e.url) === pathOf(url)) || (single ? embeds[0] : null);
  if (!e) return null;
  const img = e.image?.proxyURL || e.image?.url || e.thumbnail?.proxyURL || e.thumbnail?.url || e.video?.proxyURL && null;
  return img ? { img, title: e.title } : null;
}

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) { console.warn("[discord] DISCORD_TOKEN absent : le bot est désactivé, le site fonctionne quand même."); return; }
  const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = await import("discord.js");

  // DISCORD_USERS="123456789012345678:Esteban,987654321098765432:Irina" → qui a ajouté le reel sur le site
  const USER_MAP = Object.fromEntries((process.env.DISCORD_USERS || "").split(",").map(s => s.trim()).filter(Boolean).map(s => s.split(":").map(x => x.trim())));
  const CHANNEL = process.env.DISCORD_CHANNEL_ID || ""; // vide = tous les salons où le bot est présent
  const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("clientReady", () => console.log(`[discord] connecté : ${client.user.tag}`));

  client.on("messageCreate", async msg => {
    try {
      if (msg.author.bot) return;
      if (CHANNEL && msg.guildId && msg.channelId !== CHANNEL) return;
      const urls = [...new Set((msg.content.match(URL_RE) || []).map(u => u.replace(/[)\]>.,]+$/, "")))];
      if (!urls.length) return;

      const addedBy = USER_MAP[msg.author.id] || msg.member?.displayName || msg.author.displayName || msg.author.username;
      const tags = tagsFrom(msg.content);
      const title = msg.content.replace(URL_RE, "").replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim().slice(0, 120);
      await msg.react("⏳").catch(() => {});

      for (const url of urls) {
        const created = store.create({ url, title, ...tags, addedBy });
        let r = (await enqueueCover(created.id)) || created;
        if (r.coverStatus !== "ok") {                      // plan B : l'aperçu que Discord a généré
          const found = imageFromEmbeds(await embedsOf(msg), url, urls.length === 1);
          if (found) r = (await coverFromImageUrl(r.id, found.img, found.title)) || r;
        }
        const where = r.status === "classe"
          ? [...r.kind, ...r.cosplay, ...r.format].map(t => "`" + t + "`").join(" ")
          : "**Offrandes** (à classer)";
        const embed = new EmbedBuilder()
          .setColor(0xe2b45a)
          .setTitle(r.title || r.handle || { tiktok: "TikTok", instagram: "Instagram", x: "X", youtube: "YouTube" }[r.platform] || "Reel")
          .setURL(r.url)
          .setDescription(`Déposé par **${addedBy}** → ${where}`)
          .setFooter({ text: r.coverStatus === "ok" ? "Vignette récupérée ✦" : "Vignette introuvable — ajoute une capture depuis le site" });
        const files = [];
        if (r.cover) { files.push(new AttachmentBuilder(path.join(store.COVERS_DIR, r.cover), { name: "cover" + path.extname(r.cover) })); embed.setImage("attachment://cover" + path.extname(r.cover)); }
        if (SITE) embed.addFields({ name: "Archives", value: SITE });
        const greeting = /^irina$/i.test(addedBy)
          ? "👑 **GLOIRE À LA REINE SUPRÊME IRINA**, C'EST UN PRIVILÈGE DE VOUS RENDRE SERVICE 👑"
          : /^esteban$/i.test(addedBy)
            ? "Tu me déranges bouffon, mais j'le fais quand même."
            : "C'est rangé.";
        await msg.reply({ content: greeting, embeds: [embed], files, allowedMentions: { repliedUser: false } });
      }
      await msg.reactions.cache.get("⏳")?.users.remove(client.user.id).catch(() => {});
      await msg.react("👑").catch(() => {});
    } catch (e) {
      console.error("[discord]", e);
      msg.react("❌").catch(() => {});
    }
  });

  await client.login(token);
}
