# Barber King — Site vitrine (Delémont)

Maquette d'un site premium, une page, mobile-first, pour le salon **Barber King**
à Delémont. Site 100% statique (HTML/CSS/JS, sans framework ni étape de build) —
prêt à déployer sur **Cloudflare Pages** et facile à faire évoluer avec **Claude Code**.

## Structure du projet

```
barberking-site/
├── index.html        # toute la page
├── css/style.css      # styles (design system + responsive)
├── js/app.js          # menu mobile, statut ouvert/fermé en direct, réservation WhatsApp
├── assets/            # logos + photos (redimensionnées et compressées)
├── robots.txt
├── sitemap.xml
└── _headers           # règles de cache Cloudflare Pages
```

## ⚠️ À vérifier avant mise en ligne

1. **Nom de domaine réel.** Remplacez `https://barberking-delemont.pages.dev/`
   (canonical, Open Graph, sitemap, robots.txt) par votre domaine définitif une
   fois choisi.
2. **Photo d'Hassan.** La section "Le barbier" utilise une photo libre de droits
   en illustration (pas une vraie photo d'Hassan). Remplacez
   `assets/model-portrait.jpg` par une vraie photo du salon ou d'Hassan dès que possible.
3. **Numéro WhatsApp.** Le numéro du salon (078 352 83 59) est utilisé à la fois
   comme numéro d'accueil et comme numéro WhatsApp d'Hassan
   (`js/app.js`, tableau `BARBERS`, format international `41783528359`).

## Ajouter un deuxième barbier

Le module de réservation est prévu pour ça. Dans `js/app.js` :

```js
var BARBERS = [
  { id: "hassan", name: "Hassan", whatsapp: "41783528359" },
  { id: "nouveau", name: "Prénom", whatsapp: "41xxxxxxxxx" }
];
```

Le bouton "Envoyer la demande sur WhatsApp" enverra alors le message directement
au numéro du barbier choisi par le client.

## Déployer sur Cloudflare Pages

**Option A — sans ligne de commande (dashboard Cloudflare) :**
1. Créez un dépôt Git (GitHub/GitLab) et poussez-y le contenu de ce dossier.
2. Sur [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
   → **Create** → **Pages** → **Connect to Git**.
3. Sélectionnez le dépôt. Laissez *Build command* vide et
   *Build output directory* sur `/` (site statique, aucun build nécessaire).
4. Déployez. Cloudflare vous donne une URL `*.pages.dev` ; vous pourrez ensuite
   brancher votre propre nom de domaine dans **Custom domains**.

**Option B — avec Claude Code / Wrangler CLI :**
```bash
npm install -g wrangler
cd barberking-site
wrangler pages deploy . --project-name=barberking-delemont
```
Claude Code peut exécuter cette commande pour vous, éditer le contenu (textes,
tarifs, horaires) directement dans `index.html`, ou ajouter de nouvelles
sections à la demande.

## Ce qui est déjà en place

- **SEO** : balises meta (titre, description, mots-clés), Open Graph,
  `robots.txt`, `sitemap.xml`, données structurées `HairSalon` (schema.org)
  avec horaires, tarifs et coordonnées.
- **Performance** : images compressées et redimensionnées, chargement différé
  (`loading="lazy"`) hors du premier écran, polices en `preconnect`.
- **Accessibilité** : contrastes vérifiés, focus visibles au clavier,
  `aria-label`/`aria-pressed` sur les composants interactifs, respect de
  `prefers-reduced-motion`.
- **Mobile** : menu hamburger, bouton flottant "Réserver" sur mobile, mise en
  page qui repasse en une colonne sous 980px / 560px.
- **Statut horaires en direct** : le bandeau du haut et le tableau des
  horaires calculent "ouvert / fermé" selon l'heure réelle en Suisse
  (fuseau Europe/Zurich), sans dépendre du fuseau du visiteur.
