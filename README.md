# La Cour d'Irina — installation

Un seul service fait tout : le site (archives de reels), l'API, la récupération automatique des vignettes et le bot Discord.
Compter **30 à 45 minutes** la première fois. Aucune ligne de code à écrire.

Coût : **Railway, plan Hobby, 5 $/mois** (inclut 5 $ d'usage ; ce projet en consomme ~1 à 3 $). Carte bancaire demandée.
Alternative gratuite : un Raspberry Pi ou un vieux PC chez toi (voir tout en bas).

---

## 1. Créer le bot Discord (10 min)

1. Va sur <https://discord.com/developers/applications> → **New Application** → nom « La Cour d'Irina » → Create.
2. Menu **Bot** :
   - **Reset Token** → copie le token quelque part (tu ne le reverras plus). C'est `DISCORD_TOKEN`.
   - Plus bas, dans *Privileged Gateway Intents*, active **MESSAGE CONTENT INTENT** → Save. (Sans ça, le bot ne lit pas les liens.)
3. Menu **OAuth2** → *OAuth2 URL Generator* :
   - Scopes : coche `bot`.
   - Bot Permissions : coche `View Channels`, `Send Messages`, `Read Message History`, `Attach Files`, `Embed Links`, `Add Reactions`.
   - Copie l'URL générée en bas, ouvre-la, choisis votre serveur Discord (crée-en un à deux si besoin) → Autoriser.
4. Dans Discord, **Paramètres utilisateur → Avancés → Mode développeur** (activé). Puis clic droit sur le salon où vous posterez les liens → **Copier l'identifiant du salon** : c'est `DISCORD_CHANNEL_ID`. Clic droit sur ton profil et celui d'Irina → **Copier l'identifiant de l'utilisateur** : pour `DISCORD_USERS`.

## 2. Mettre le code sur GitHub (5 min)

1. Crée un compte sur <https://github.com> si besoin → **New repository** → nom `cour-irina`, **Private** → Create.
2. Sur la page du dépôt vide, clique **uploading an existing file**, glisse **tout le contenu** de ce dossier (fichiers et sous-dossiers `lib/`, `public/`), puis **Commit changes**.

## 3. Déployer sur Railway (10 min) — c'est ici qu'on paie

1. <https://railway.com> → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → choisis `cour-irina`. Railway détecte le `Dockerfile` et construit (2-4 min la première fois).
3. Onglet **Variables** du service → **Raw Editor**, colle et adapte :

   ```
   USERS=Esteban:1234,Irina:5678
   SESSION_SECRET=une-tres-longue-chaine-aleatoire-que-tu-inventes
   DISCORD_TOKEN=le-token-de-l-etape-1
   DISCORD_CHANNEL_ID=123456789012345678
   DISCORD_USERS=111111111111111111:Esteban,222222222222222222:Irina
   SITE_URL=https://a-remplir-apres-l-etape-5
   ```
   Change les codes `1234` / `5678` : ce sont vos codes d'entrée sur le site.
4. Onglet **Settings → Volumes → Add Volume**, *Mount path* : `/data`. **Indispensable** : sans volume, les reels et vignettes disparaissent à chaque redéploiement.
5. **Settings → Networking → Generate Domain** → tu obtiens une adresse du type `cour-irina-production.up.railway.app`. Remets-la dans la variable `SITE_URL`.
6. **Settings → Plan / Billing** : passe en **Hobby (5 $/mois)**. L'essai gratuit permet de tester quelques jours, mais le bot s'arrêtera quand le crédit d'essai sera épuisé.

Ouvre l'adresse sur ton téléphone → choisis ton prénom → code → tu es dans la Cour. Ajoute-la à l'écran d'accueil (Partager → *Sur l'écran d'accueil*) pour l'avoir comme une app.

## 4. Utiliser le bot

Dans le salon choisi (ou en message privé au bot), envoie un lien, avec des hashtags si tu veux le classer directement :

```
https://www.tiktok.com/@xxx/video/123   #costume #accessoires #inspi
```

- Sans hashtag → le reel attend dans **Offrandes**.
- Hashtags reconnus : `#inspi` `#tuto` · `#perruque` `#lentilles` `#makeup` `#costume` `#chaussures` `#collants` `#accessoires` `#armes` · `#hook` `#format` `#danse` `#musique` `#trend` `#photographie` `#video` `#humour` `#storytelling` `#monetisation` `#interaction` `#beaute` `#communaute` `#educatif` `#lifestyle` (accents et pluriels tolérés).
- Le texte restant devient le titre. Le bot répond avec la vignette et met 👑 quand c'est rangé.

Sur le téléphone : TikTok → Partager → **Discord** → votre salon. Deux taps, et c'est dans les archives avec l'image.

## 5. Vignettes : ce qui marche

| Plateforme | Vignette auto | Remarque |
|---|---|---|
| TikTok | ✅ | via l'API publique TikTok |
| X / Twitter | ✅ | via fxtwitter |
| YouTube / Shorts | ✅ | image officielle |
| Instagram | ⚠️ | demande des cookies (ci-dessous) ; sinon capture à la main |

Quand la vignette échoue, la fiche l'indique avec un bouton **Réessayer**, et on peut toujours mettre une capture d'écran via **Modifier**.

### Instagram (optionnel)
1. Installe l'extension de navigateur **« Get cookies.txt LOCALLY »** (Chrome/Firefox), connecte-toi sur instagram.com avec un compte **secondaire** (jamais le compte principal d'Irina : Instagram peut le bloquer temporairement), exporte `cookies.txt`.
2. Dans Railway → Variables, ajoute `YTDLP_COOKIES_B64` = le contenu du fichier encodé en base64 (`base64 -w0 cookies.txt` sur Mac/Linux, ou un convertisseur « file to base64 » en ligne). Le serveur l'installe tout seul au démarrage. Les cookies expirent au bout de quelques semaines : à refaire quand Instagram ne marche plus.

## 6. Entretien

- Si les vignettes TikTok/Insta cessent de fonctionner : Railway → **Deployments → Redeploy** (reconstruit l'image avec la dernière version de yt-dlp). Ça règle 90 % des cas.
- Sauvegarde : tout est dans le volume `/data` (`reels.json` + dossier `covers/`).
- Changer un code d'accès : modifie `USERS` dans les Variables, Railway redémarre tout seul.

## Alternative gratuite : chez toi (Raspberry Pi / vieux PC)

```bash
sudo apt install -y nodejs npm python3 ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
cd cour-irina && npm install && cp .env.example .env   # édite .env
export $(grep -v '^#' .env | xargs) && node server.js
```
Pour y accéder depuis vos téléphones hors de la maison, le plus simple est **Tailscale** (gratuit) ou un tunnel **Cloudflare Tunnel** (gratuit, donne une vraie adresse https). Et `pm2` pour que ça redémarre tout seul : `npm i -g pm2 && pm2 start server.js --name cour && pm2 save && pm2 startup`.
