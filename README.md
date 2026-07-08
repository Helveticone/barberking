# Barber King — Site + moteur de réservation (Delémont)

Site premium mobile-first pour le salon **Barber King** à Delémont, avec un
**système de réservation maison** (calendrier de disponibilités réelles,
espace admin pour Hassan, confirmations et rappels automatiques sur
WhatsApp). Tourne entièrement sur **Cloudflare Workers** + **Cloudflare D1**
(base de données SQL gratuite chez Cloudflare) — aucun service tiers payant
n'est requis pour le cœur du système.

## Structure du projet

```
barberking-site/
├── index.html          # page vitrine (avec le calendrier de réservation)
├── admin.html           # espace pro de Hassan (planning, blocages)
├── gerer.html            # page client : voir/annuler son rendez-vous
├── css/style.css         # styles (design system + responsive)
├── js/app.js              # menu mobile, statut ouvert/fermé, encart horaires
├── js/booking.js           # calendrier de réservation (appelle l'API)
├── assets/                  # logos + photos
├── src/index.js               # Worker : API de réservation + admin + rappels
├── schema.sql                   # schéma de la base de données D1
├── wrangler.toml                  # config Cloudflare (Worker + D1 + cron)
├── .assetsignore                    # exclut src/, schema.sql... des fichiers publics
├── robots.txt / sitemap.xml
└── _headers                            # règles de cache
```

## ⚠️ À vérifier avant mise en ligne

1. **Nom de domaine réel.** Remplacez `https://barberking-delemont.pages.dev/`
   (canonical, Open Graph, sitemap, robots.txt) par votre domaine définitif.
2. **Photo d'Hassan.** La section "Le barbier" utilise une photo libre de
   droits en illustration. Remplacez `assets/model-portrait.jpg` par une
   vraie photo dès que possible.
3. **Numéro WhatsApp d'Hassan.** Actuellement `41783528359` dans
   `schema.sql` (table `barbers`). Pour le changer après coup, voir la
   section "Mettre à jour une donnée" plus bas.

---

## 1. Mettre en place la base de données (Cloudflare D1)

**Depuis le dashboard Cloudflare (le plus simple, sans rien installer) :**
1. **Workers & Pages** → onglet **D1** (menu de gauche, sous *Compute* ou
   *Storage*, selon la mise en page) → **Create Database**.
2. Nom : `barberking`. Créez.
3. Ouvrez la base créée → onglet **Console** → collez tout le contenu de
   `schema.sql` → **Execute**. Ça crée les tables et insère Hassan, les 3
   prestations et les horaires déjà utilisés sur le site.
4. Copiez le **Database ID** affiché → collez-le dans `wrangler.toml`,
   à la place de `REMPLACER_PAR_L_ID_REEL`.
5. Retournez dans votre Worker `barberking` → onglet **Settings** →
   **Bindings** → vérifiez que la base `barberking` apparaît (sinon,
   ajoutez-la manuellement : **Add binding** → **D1 Database** →
   variable `DB` → sélectionnez `barberking`).
6. Commit/push `wrangler.toml`, puis redéployez.

**Avec Wrangler CLI (si vous utilisez Claude Code / un terminal) :**
```bash
wrangler d1 create barberking
# copiez le database_id affiché dans wrangler.toml
wrangler d1 execute barberking --remote --file=schema.sql
```

## 2. Configurer les secrets

Ces valeurs ne doivent JAMAIS être écrites dans le code (elles ne sont pas
dans les fichiers du dépôt). Dans le dashboard Cloudflare : votre Worker
`barberking` → **Settings** → **Variables and Secrets** → **Add** → type
**Secret** (chiffré) pour chacune :

| Nom | Valeur |
|---|---|
| `ADMIN_PASSWORD` | Le mot de passe que Hassan utilisera sur `/admin.html` |
| `WHATSAPP_TOKEN` | Jeton d'accès permanent de l'app Meta (étape 3) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID du numéro WhatsApp Business (étape 3) |
| `WHATSAPP_TEMPLATE_CONFIRM` | Nom du modèle de message de confirmation, une fois approuvé par Meta |
| `WHATSAPP_TEMPLATE_REMINDER` | Nom du modèle de message de rappel, une fois approuvé |

Tant que les variables `WHATSAPP_*` ne sont pas configurées (ou si l'envoi
échoue), **rien n'est bloqué** : le client voit un bouton "Confirmer sur
WhatsApp" avec un message pré-rempli, exactement comme le système précédent.

## 3. Mettre en place WhatsApp Business (Meta Cloud API)

**Point important** : l'API WhatsApp Business n'autorise l'envoi de texte
libre par l'entreprise que dans les 24h suivant un message du client. Pour
une confirmation ou un rappel envoyés à l'initiative du salon, il faut des
**modèles de message ("templates") pré-approuvés par Meta** — ce n'est pas
une option, c'est une règle de la plateforme.

**Étapes (chez Meta, en dehors de ce projet) :**
1. Créez un compte sur [business.facebook.com](https://business.facebook.com)
   si vous n'en avez pas.
2. Dans **Meta for Developers** ([developers.facebook.com](https://developers.facebook.com)),
   créez une app → type **Business** → ajoutez le produit **WhatsApp**.
3. Meta fournit un **numéro de test gratuit** pour commencer (utile pour
   valider tout le système avant d'engager un vrai numéro).
4. **Recommandation : utilisez un numéro dédié**, différent du
   078 352 83 59 personnel de Hassan. Enregistrer un numéro sur l'API Cloud
   le retire en général de l'app WhatsApp classique (sauf fonctionnalité
   récente de "coexistence", encore limitée). Garder deux numéros séparés
   évite tout risque de perdre l'accès WhatsApp habituel de Hassan.
5. Dans **Business Settings → WhatsApp Manager → Modèles de message**,
   créez ces deux modèles (catégorie **Utilité**) et soumettez-les à
   validation (généralement approuvés en quelques heures à 1-2 jours) :

   - **`confirmation_rdv`** :
     > Bonjour {{1}}, votre rendez-vous chez Barber King est confirmé : {{2}} le {{3}} à {{4}}. Pour annuler : {{5}}

   - **`rappel_rdv`** :
     > Bonjour {{1}}, rappel de votre rendez-vous demain à {{2}} chez Barber King ({{3}}). À bientôt !

6. Une fois approuvés, récupérez dans **WhatsApp Manager → API Setup** :
   le **jeton d'accès** (générez un jeton permanent via un utilisateur
   système, pas le jeton temporaire de test qui expire en 24h) et le
   **Phone Number ID**. Renseignez-les comme secrets (section 2).
7. Renseignez aussi `WHATSAPP_TEMPLATE_CONFIRM=confirmation_rdv` et
   `WHATSAPP_TEMPLATE_REMINDER=rappel_rdv` (ou les noms exacts choisis).

Tant que cette configuration n'est pas terminée, le site fonctionne quand
même normalement grâce au repli automatique décrit en section 2.

## 4. Les rappels automatiques (cron)

`wrangler.toml` déclenche une vérification chaque heure
(`crons = ["0 * * * *"]`). Le Worker envoie un rappel WhatsApp pour tout
rendez-vous commençant entre 23h et 25h plus tard, une seule fois par
rendez-vous (`reminder_sent`). Aucune action requise pour l'activer : les
Cron Triggers sont inclus dans le plan Workers gratuit.

## 5. Utiliser l'espace admin (Hassan)

Sur `https://votre-site/admin.html` :
- **Se connecter** avec le mot de passe défini dans `ADMIN_PASSWORD`.
- **Bloquer un créneau** : pause, rendez-vous personnel, jour de vacances —
  bloque automatiquement ce créneau pour les nouvelles réservations en ligne.
- **Voir les rendez-vous des 7 prochains jours**, avec nom, téléphone,
  prestation, et un bouton pour annuler si besoin.

## 6. Mettre à jour une donnée (prix, horaires, numéro WhatsApp...)

Toutes les données métier vivent maintenant dans la base D1, pas dans le
code. Pour les modifier : dashboard Cloudflare → votre base `barberking` →
**Console**, puis une requête SQL, par exemple :

```sql
-- Changer le prix d'une prestation
UPDATE services SET price_chf = 28 WHERE name = 'Coupe homme';

-- Changer le numéro WhatsApp d'Hassan
UPDATE barbers SET whatsapp_number = '41791234567' WHERE id = 1;

-- Modifier un horaire (ex. mardi 9h-19h au lieu de 9h-18h30)
UPDATE working_hours SET end_minutes = 1140 WHERE barber_id = 1 AND weekday = 2;
```

## 7. Ajouter un deuxième barbier

1. `INSERT INTO barbers (name, whatsapp_number) VALUES ('Prénom', '41xx...')`
   puis ajoutez ses `working_hours` de la même façon que pour Hassan.
2. Dans `js/booking.js`, la variable `BARBER_ID` est actuellement fixée à
   `1` : il faudra ajouter un sélecteur de barbier sur le site (comme
   l'ancien système WhatsApp en avait un) qui met à jour cette valeur
   avant l'appel à l'API. Dites-le à Claude Code le moment venu, la base
   de données est déjà prête pour ça.

## 8. Après une mise à jour de `style.css` / `app.js` / `booking.js`

`css/` et `js/` sont mis en cache 7 jours (`_headers`). Montez le numéro de
version dans `index.html` à chaque modification :
```html
<link rel="stylesheet" href="/css/style.css?v=5">
<script src="/js/booking.js?v=2" defer></script>
<script src="/js/app.js?v=3" defer></script>
```

## 9. Déployer

Le projet est un **Worker** (pas un projet "Pages" classique) : le fichier
`wrangler.toml` contient `main = "src/index.js"` et sert à la fois le site
statique (dossier `.`) et l'API.

**Depuis GitHub (déjà en place) :** committez/poussez vos changements ; si
le déploiement automatique est configuré, Cloudflare reconstruit tout seul.
Sinon : **Workers & Pages** → `barberking` → **Deployments** →
**New deployment**.

**En ligne de commande (Claude Code / Wrangler) :**
```bash
wrangler deploy
```

## Ce qui est déjà en place

- **Calendrier de réservation réel** : le client ne voit que des créneaux
  réellement libres (aucun double rendez-vous possible), avec vérification
  serveur juste avant la confirmation.
- **Confirmation + rappel automatique** sur WhatsApp (modèles Meta), avec
  repli intelligent tant que la configuration Meta n'est pas terminée.
- **Lien d'annulation client** (`gerer.html`) envoyé dans chaque confirmation.
- **Espace admin protégé par mot de passe** pour bloquer des créneaux et
  gérer le planning.
- **SEO** : meta description, Open Graph, `robots.txt`, `sitemap.xml`,
  données structurées `HairSalon` (schema.org).
- **Performance** : images compressées, chargement différé, polices en
  `preconnect`.
- **Accessibilité** : contrastes vérifiés, focus clavier visibles,
  `prefers-reduced-motion` respecté.
- **Mobile** : menu hamburger, mise en page responsive, aucun débordement
  horizontal.
- **Statut horaires en direct** : bandeau + encart "Aujourd'hui" calculés
  sur l'heure réelle à Delémont (Europe/Zurich).
