# ERA Intelligence

Cockpit de décision pour revendeurs Vinted. **Redrip exécute, ERA décide.**
Extension Chrome MV3 · WXT · React · TypeScript strict · Dexie (IndexedDB) · local-first, aucune télémétrie.

## Installer (Chrome) — sans rien compiler

1. Télécharger le dépôt (ZIP) et le décompresser.
2. Ouvrir `chrome://extensions` → activer **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisir le dossier **`extension/`** (celui qui contient `manifest.json`),
   pas la racine du dépôt.

## Mettre à jour sans retélécharger

Installer **une seule fois** avec git, dans un dossier fixe :

```bash
git clone -b claude/adoring-keller-jahd0y https://github.com/s22pp/Vinted-claude-extension-.git ~/ERA
```
puis charger `~/ERA/extension` dans `chrome://extensions`.

Ensuite, à chaque nouvelle version :

```bash
~/ERA/scripts/update.sh      # = git pull
```
puis **Réglages → Recharger ERA** (ou ↻ dans `chrome://extensions`). L'identifiant de l'extension est fixé
(clé publique dans le manifest) : vos données locales sont conservées d'une version à l'autre.

Pour développer : `npm install && npm run build` (sortie `.output/chrome-mv3`) ; `npm run release` régénère `extension/` et le ZIP.

Premier lancement : onboarding. Importer depuis Vinted (onglet vinted.fr connecté, lecture seule, ≤ 5 requêtes), CSV, saisie, ou démo clairement étiquetée.

## Développer / tester

```bash
npm run dev            # WXT + rechargement à chaud
npm test               # Vitest — moteurs (argent, comparables, pricing, stagnation, capital, deal score, offres, apprentissage)
npm run e2e            # build + Playwright sur l'extension chargée (3 navigateurs en parallèle ; PW_WORKERS=1 pour déboguer)
npm run compile        # tsc strict (variables et paramètres inutilisés refusés)
npm run lint           # ESLint : règles des hooks React et erreurs courantes
npm run qa:screens     # build + captures pleine page des écrans clés (démo) → .output/screens
npm run icons          # régénère les PNG depuis assets/era-mark.svg
npm run perf           # temps de calcul des moteurs sur un gros compte synthétique (700 articles, 26 500 observations)
npm run analyze        # build avec source maps : octets par module dans chaque fichier livré
```

Le calcul du tableau de bord est découpé en trois couches pures (`src/app/era-data.ts`), recalculées chacune seulement quand ses données changent : enregistrer une fiche d'atelier ou écarter un conseil ne refait que la dernière (≈ 1 ms sur un gros compte, contre 134 ms en v0.24).

## Architecture

```
src/domain         entités (types TypeScript + validation à l'écriture), argent en centimes (UNKNOWN ≠ 0), provenance
src/data           Dexie, repository, adapters (démo / Vinted lecture seule + budget d'appels), import CSV/Vinted
src/intelligence   moteurs purs : comparables, pricing, stagnation, capital, seller model, buy/deal score,
                   offres, annonce + bouclier, apprentissage, décision
src/app/screens    un fichier par écran, chargé à la demande (Today, Stock, Atelier, Capital, Item, Market, Buy,
                   Sales, Colis, Comptabilité, Insights, Outils, Réglages)
src/app/components les morceaux partagés ou volumineux (fiche d'atelier, tableau du stock, analyse de prix,
                   cartes des réglages, onglets de section…)
src/ui             design system : tokens, composants, graphiques SVG, illustrations, logo
```

Un écran n'importe jamais un autre écran : ce qu'ils partagent vit dans `src/app/components`, pour qu'ouvrir un écran ne charge que son code.

## Quand un écran plante

Chaque écran est isolé : une erreur d'affichage montre ce qui s'est passé avec « Réessayer », « Aller à Aujourd'hui » et « Recharger », le menu et les autres écrans restent utilisables, et vos données ne sont pas touchées. L'erreur est gardée dans ce navigateur (les 20 dernières), jamais envoyée : Réglages → Diagnostic → « Copier le rapport » l'inclut, pour me la transmettre.

## Garde-fous Vinted

- Lecture : endpoints vérifiés, `GET`, via la session de l'onglet ouvert. Écriture : seulement les automatisations activées (ci-dessous).
- Budget : 60 appels / session · 12 / min · 1,2 s d'espacement · 2 pages max. **403/429 = arrêt total 6 h.**
- ERA ne publie jamais une annonce, ne suit personne et ne change jamais un prix automatiquement. Il ne supprime qu'une **ancienne annonce republiée**, sans favoris, une fois la copie en ligne, après votre confirmation.
- Modifier le prix d'une annonce depuis la fiche article : **EXPERIMENTAL**, un article à la fois, après confirmation explicite.
- **Automatisations (EXPERIMENTAL, désactivées par défaut)** — Outils → Automatisations :
  - *Favoris → message et offre* : à un nouveau favori, un message et (si le coût d'achat est connu) une offre, jamais sous coût + marge. **Messages au choix** : une dizaine de messages naturels (tutoiement ou vouvoiement) qui parlent de « la veste Ralph Lauren » plutôt que du titre complet (taille, référence ERA) ; aperçu sur une de vos annonces ; vos propres messages en plus. Plusieurs cochés = chaque membre en reçoit un (toujours le même pour un favori donné) ;
  - *Offre groupée* : un membre met **plusieurs** de vos articles en favori → **un seul** message pour le lot (« la veste Ralph Lauren et le pull Lacoste »), avec un prix de lot (remise réglable, 15 % par défaut) jamais sous la somme de vos planchers ; un coût inconnu → aucun prix promis ;
  - *Offres reçues* : acceptée au-dessus d'un seuil, une contre-offre entre deux, refusée en dessous — jamais sous le plancher.
  - Écritures limitées à une **liste blanche** de routes (conversation, message, offre, réponse à une offre ; plus, sur votre clic seulement : brouillon, bordereau, masquer, suppression d'une ancienne annonce republiée, envoi d'une photo pour une copie) ; 12 s minimum entre deux envois, 40 par jour, 5 par passage ; tout reste dans le budget de lecture ; 403/429, déconnexion ou budget épuisé = arrêt immédiat.
  - « Simuler » ne fait que lire ; chaque action (ou simulation) est écrite dans un **journal**. La planification ne tourne qu'avec un onglet vinted.fr déjà ouvert.
  - Routes et champs relevés dans des extensions du marché (faits d'interopérabilité, aucun code repris) : **NON VÉRIFIÉS** sur votre compte tant que le journal ne les montre pas fonctionner.
- **Brouillon Vinted pré-rempli (EXPERIMENTAL)** — Atelier → « Créer le brouillon sur Vinted » : titre, description, prix, état, et les identifiants que Vinted lui-même propose (catégorie suggérée pour le titre, marque au nom exact, taille exacte de la catégorie, format de colis). Ce qui ne correspond pas reste vide. **Jamais publié** : vous ajoutez les photos et publiez sur Vinted. Relu sur Vinted avant d'être annoncé.

## Code tiers

Des extensions commerciales ont été examinées uniquement pour relever des **faits d'interopérabilité** (noms de routes et de champs de l'API Vinted). **Aucune ligne de leur code n'est reprise** : leur code est protégé par le droit d'auteur. Les fonctionnalités d'ERA sont écrites de zéro.

## Ce qui est vérifié — et ce qui ne l'est pas

Les tests automatiques utilisent des données fictives : **ils prouvent la logique d'ERA, pas le fonctionnement réel de Vinted.**
Réglages → *Intégrations Vinted* affiche, pour cet appareil, ce qui a réellement été observé (import du stock, ventes, statut réservé, recherche de comparables, achats) et marque le reste **NON VÉRIFIÉ**.

| Intégration | Statut |
| --- | --- |
| Import garde-robe, ventes | utilisé en réel, champs non garantis |
| Statut « réservé » (`is_reserved`) | NON VÉRIFIÉ |
| Recherche de comparables (`catalog/items`, en-têtes CSRF/anon_id de la page ; replis : forme sans tri, puis apprentissage) | NON VÉRIFIÉ |
| Achats (`my_orders?type=purchased`, repli : apprentissage depuis la page Mes commandes) | NON VÉRIFIÉ |
| Commandes « à traiter » (`transaction_user_status: needs_action` dans `my_orders`) | NON VÉRIFIÉ |
| Modification de prix | EXPERIMENTAL |
| Automatisations : notifications de favoris, conversations, messages, offres (`/web/api/notifications/notifications`, `/api/v2/conversations`, `/api/v2/transactions/{id}/offers`, `offer_requests/{id}/accept\|reject`, `/api/v2/inbox`) | EXPERIMENTAL · NON VÉRIFIÉ |
| Brouillon pré-rempli (`item_upload/suggestions/categories`, `item_upload/brands`, `item_upload/size_groups`, `catalogs/{id}/package_sizes`, `item_upload/drafts`) | EXPERIMENTAL · NON VÉRIFIÉ |
| Bordereau (`conversations/{id}`, `shipments/{id}/label_url`, `transactions/{id}/shipment/order`), masquer (`items/{id}/is_hidden`) | EXPERIMENTAL · NON VÉRIFIÉ |
| Republication sans perte (`item_upload/items/{id}`, `POST /api/v2/photos`, `item_upload/drafts`, `POST items/{id}/delete`) | EXPERIMENTAL · NON VÉRIFIÉ |
| Repères sur les pages vinted.fr, bouton « Réponses ERA » dans la messagerie (lecture de la page, aucun appel) | EXPERIMENTAL · NON VÉRIFIÉ |
| Colis : lieux et code de suivi lus dans la conversation de la commande (`conversations/{id}`, champs à coordonnées) | EXPERIMENTAL · NON VÉRIFIÉ |

Réglages → *Intégrations Vinted* compte aussi, pour chaque écriture, les envois que Vinted a **acceptés sur cet appareil** (d'après le journal) : c'est la seule preuve qu'une route fonctionne sur votre compte.

## Republications : un article, une mémoire

Republier (supprimer puis remettre en ligne, à la main ou avec n'importe quel outil) donne à l'annonce un nouvel identifiant Vinted, 0 vue et 0 favori. ERA ne crée pas pour autant un nouvel article :

- **Rapprochement à l'import** : une annonce qui disparaît de la garde-robe (lue en entier) et une nouvelle annonce avec la **référence ERA** dans le titre (certain) ou le **même titre, même marque, même taille** (déduit) sont le même article. Coût, date d'achat, historique des prix et prédictions sont conservés. Fenêtre : 30 jours après la disparition.
- **Âges** : la 1re mise en ligne compte pour le capital immobilisé, la stagnation et vos délais de vente ; vues et favoris viennent de l'annonce actuelle.
- **Historique** : « Annonce retirée » puis « Republié », avec les vues et favoris que Vinted a remis à zéro. Rapprochement faux (deux exemplaires, un titre) ? « Séparer » dans l'historique de l'article.
- **Décisions** : aucune autre action proposée pendant 7 jours après une republication (son effet sur les vues est mesuré) ; une republication sans effet n'est pas reproposée.
- **Disparition sans republication** : l'annonce passe « retirée » et l'article sort du stock (déduit) ; si une commande la nomme, c'est une vente.
- Garde-robe de plus de 192 annonces (2 pages lues) : ERA ne conclut rien d'une absence.

## Republier sans rien perdre (EXPERIMENTAL)

Fiche article → **« Republier sans rien perdre »** (annonce en ligne, ni réservée ni masquée) :

1. ERA lit l'annonce sur Vinted et **refuse s'il y a un seul favori** (une republication les ferait perdre ; favoris non confirmés = refus aussi).
2. Il la copie dans un **brouillon** : mêmes titre, description, prix, catégorie, marque, taille, état, couleurs, format de colis, et **les mêmes photos**, téléchargées depuis les serveurs d'images de Vinted puis renvoyées (tout ou rien : si une photo échoue, aucun brouillon ; le budget d'appels doit couvrir la copie entière avant de commencer). Le brouillon est relu, puis ouvert sur Vinted. **Rien n'est publié, rien n'est supprimé.**
3. Vous vérifiez la copie et la publiez vous-même. À l'import suivant, la copie rejoint **le même article** (jamais un doublon) : coût, date d'achat, 1re mise en ligne et historique restent.
4. « Supprimer l'ancienne annonce » : ERA revérifie sur Vinted que la copie est publiée et que l'ancienne n'a toujours aucun favori, demande confirmation, supprime, puis relit. Non confirmé par la relecture → rien ne bouge dans ERA, le prochain import tranche.

Nouvelle autorisation : `https://*.vinted.net/*` (serveurs d'images de Vinted), lue seulement pour copier les photos de **vos** annonces.

## À envoyer, bordereaux, masquer

- **Ventes → À envoyer** : chaque commande que Vinted dit en attente du vendeur, avec un **contrôle avant envoi** (conformité, photo avant emballage, format du colis, ancien code-barre masqué) complété par ce qui aurait évité vos remboursements passés (défauts en photo, mesures, étiquettes, emballage protégé).
- **Obtenir le bordereau (EXPERIMENTAL)** : comme le bouton de Vinted — un bordereau déjà prêt est récupéré ; sinon il est commandé en imprimable avec le dépôt proposé par Vinted et votre adresse par défaut, puis attendu ~25 s. Ouvert pour impression **et enregistré en PDF** dans `Téléchargements/ERA-bordereaux/` (date de vente + article, ex. `2026-09-20_sweat-nike-vintage-l.pdf`) ; journalisé avec l'hôte qui sert le PDF.
- **Tous les bordereaux** (dès 2 commandes à envoyer) : après confirmation, une commande après l'autre, chaque PDF enregistré ; au premier blocage (403/429, déconnexion, budget), ERA s'arrête et dit combien restent. Un PDF que le navigateur n'a pas pu enregistrer est signalé « non enregistré », jamais comme enregistré.
- ERA **ne fabrique jamais** de bordereau : seul celui émis par Vinted porte un numéro de suivi et un envoi payé valables.
- **Masquer / réafficher (EXPERIMENTAL)** depuis la fiche article, relu sur Vinted : le statut dans ERA suit ce que Vinted confirme.

## Remettre en vente un similaire

Fiche article → **« Remettre en vente un similaire »** : vous avez racheté le même genre d'article ? Indiquez combien, la taille, l'état et le coût : ERA crée les fiches dans l'Atelier, prêtes à compléter.

- **Repris** : marque, modèle, catégorie, format du colis ; le **prix réellement encaissé** sur l'article modèle sert de référence de prix ; sur Vinted, le brouillon réutilise les **identifiants de l'ancienne annonce** (catégorie, marque, et la taille si c'est la même) au lieu de les redemander.
- **Jamais repris** : mesures, défauts, couleurs, composition, photos, référence produit — c'est un autre article, ils se lisent sur lui.

## Ajouter un lot

Stock (ou Atelier) → **« Ajouter un lot »** : une ligne par article, comme vous le diriez (« Chemise Pierre Cardin L très bon état »). ERA lit la marque, le type d'article, la taille et l'état dans la ligne (ce qui n'y est pas reste à compléter, une marque non lue reste « Inconnue ») et crée une fiche par ligne dans l'Atelier. Le prix payé est réparti **au centime près** : selon ce que ce genre d'article vous rapporte (vos ventes), ou à parts égales. Chaque part est marquée « déduite ».

## Coûts manquants en un clic

Aujourd'hui → **« coûts d'achat manquent »** ouvre la saisie rapide : les articles vendus d'abord (leur bénéfice est inconnu), puis les plus chers. Si un **achat Vinted** correspond à l'article, il est proposé (prix + protection acheteur, port à ajouter) : **« Utiliser »**. Sinon, tapez le montant, Entrée : le suivant est prêt. Un coût inconnu n'est jamais compté comme zéro.

## Dossier d'envoi (litige)

Ventes → À envoyer (ou la fiche d'un article vendu) → **« Dossier d'envoi »** : une page imprimable (PDF) avec l'article tel que décrit (état, défauts, mesures), l'annonce, la vente, la conversation Vinted, le **contrôle avant envoi avec l'heure de chaque coche** (« non coché » sinon) et l'historique de l'annonce. Seulement ce qu'ERA a enregistré ; les photos restent sur Vinted et votre téléphone.

## Repères ERA sur les pages Vinted (EXPERIMENTAL)

Sur une recherche, un profil ou une annonce vinted.fr, chaque article d'une de **vos niches** (liste de courses : 3 ventes et plus d'une même marque et d'un même type) porte un repère : **« ERA ✓ marge ~X € »** sous votre prix max, **« votre max X € »** au-dessus, **« ⚠ niche à éviter »** si elle se vend mal chez vous. ERA lit seulement ce que la page affiche (titre et prix du lien, données produit de l'annonce) : **aucune requête**, rien de cliqué ni de modifié sur Vinted. Vos propres annonces n'ont pas de repère. Réglages → désactivable. Dépend de la construction des pages Vinted : peut cesser de fonctionner si Vinted la change.

## Alertes d'achat

Buy → Scanner → **Alertes d'achat** : après chaque actualisation automatique, vos 3 meilleures niches sont cherchées une fois chacune sur Vinted (lecture seule, dans le budget). Une annonce **sous votre prix max** qu'ERA ne vous a pas encore montrée est gardée et annoncée par une notification (si activée) ; jamais vos propres annonces, chaque annonce une seule fois. « Vérifier maintenant » lance la même recherche à la main.

## Pilotage : l'activité mois par mois, et l'objectif traduit en achats

Insights s'ouvre sur **Pilotage** :

- **30 derniers jours contre les 30 d'avant** : chiffre d'affaires, bénéfice connu, ventes, mises en ligne, remboursements (et leur taux), délai de vente médian — chaque écart avec une flèche et un mot, jamais la couleur seule. Moins de 5 commandes sur chaque période : ERA le dit, l'écart tient surtout du hasard.
- **Mois par mois** (jusqu'à 12 mois) : ventes, chiffre d'affaires, bénéfice connu, panier médian, remboursements, mises en ligne, achats et dépenses, délai de vente — graphique du chiffre d'affaires et tableau, **exportable en CSV** pour un tableur.
- **Seules les vraies dates comptent** : une vente sans date donnée par Vinted est mise à part (jamais comptée dans le mois de l'import), une annonce sans vraie date de publication n'est pas une « mise en ligne », un bénéfice avec des coûts d'achat inconnus est marqué ◐ comme un minimum.
- **Plan d'achat** : l'objectif mensuel devient ce qu'il demande à l'achat — articles à acheter par semaine, budget d'achat par semaine et capital en stock nécessaire, au coût médian de vos articles vendus (180 derniers jours, au moins 3 coûts connus), et les niches à acheter en priorité avec le prix maximum à payer sur Vinted. Il suppose que votre rythme de vente et vos coûts restent les mêmes avec plus de stock : une direction, pas une promesse.

## Colis : carte autour de chez vous (Roanne)

Ventes → **Colis** : les colis qui **arrivent chez vous** (vos achats Vinted) et ceux **partis de chez vous** (vos ventes), chacun avec son étape lue dans le statut Vinted (à envoyer, envoyé, en route, au point relais, livré), le nombre de jours à cette étape et une alerte quand ça traîne — un colis qui attend au point relais repart au bout de quelques jours : il apparaît aussi dans la Tournée du jour et, avec l'actualisation automatique et ses notifications activées, une **notification « Colis à retirer »** le signale dès qu'un achat déjà suivi passe au point relais (jamais pour un achat vu pour la première fois). La carte est centrée sur Roanne (« Déplacer chez moi » pour la placer ailleurs d'un clic). **« Localiser »** (EXPERIMENTAL, une lecture budgétée de la commande) place le point relais ou la destination **seulement si Vinted les donne**, avec la distance depuis chez vous et le code de suivi s'il existe. Vinted ne donne pas la position d'un colis en route : ERA ne l'invente pas — le suivi du transporteur reste dans la conversation Vinted (bouton « Suivi dans Vinted »). Fond de carte © OpenStreetMap (bibliothèque Leaflet), chargé depuis internet pour la seule zone affichée.

## Sauvegarde automatique, ventes et articles en CSV

Réglages → Sauvegarde → **« Sauvegarde automatique »** (désactivée tant que vous ne l'activez pas) : chaque jour ou chaque semaine, une copie complète — articles, ventes, coûts, historique, réglages — datée dans `Téléchargements/ERA-sauvegardes/era-sauvegarde-AAAA-MM-JJ.json`, restaurable par « Restaurer… ». Vraies données seulement (jamais la démo), rien ne quitte l'ordinateur ; une deuxième copie le même jour remplace la première. Même carte : **« Mes ventes (CSV) »** (toutes les ventes, remboursements et motifs compris) et **« Mes articles (CSV) »** (chaque article : coût, statut, date d'achat, lien Vinted), pour Excel ou Google Sheets.

## Contrôle des photos de mes annonces

Stock → Qualité des annonces → **« Contrôle des photos »** : chaque photo de vos annonces en ligne est lue depuis les serveurs d'images de Vinted (aucun appel à l'API, une fois par photo) et mesurée dans votre navigateur — netteté, lumière, contraste, fond, résolution. ERA liste les photos **à refaire** et pourquoi. Il ne modifie, ne génère et n'envoie aucune image : Vinted exige des photos réelles, sans retouche, et l'écart entre la photo et l'article est la première cause de remboursement. Pas d'amélioration de photo par IA (ChatGPT ou autre) : c'est un choix délibéré.

## Télécharger toutes mes photos

Réglages → Sauvegarde → **Photos de mes annonces** : toutes les photos de vos annonces (en ligne, ou toutes, vendues comprises), un dossier par annonce dans `Téléchargements/ERA-photos/<article>_<id>/01.jpg`, dans l'ordre de l'annonce, à la plus grande taille que Vinted fournit. Les adresses viennent du dernier import ; une annonce dont la garde-robe ne les donne pas est lue une fois (budget d'appels, arrêt propre s'il s'épuise). Une annonce supprimée n'a plus de photos chez Vinted. Exporter à nouveau **remplace** les fichiers du même article (mêmes noms) au lieu de créer des doublons.

## Plan de baisse

Chaque annonce en ligne suit un calendrier de prix que vous réglez une fois (par défaut **−5 % après 14 jours en ligne, −10 % après 30**, jusqu'à 4 étapes), compté depuis son **prix de départ** (le premier prix vu par ERA ; pas de baisses en cascade) et **jamais sous le plancher** (coût d'achat + marge minimale réglée dans Automatisations). La fiche de l'article montre les étapes et leur date ; une étape due apparaît dans la Tournée du jour et dans Stock → « Baisse à faire ». ERA ne baisse rien seul : « Passer à 42 € sur Vinted » ouvre la confirmation habituelle (une annonce, un clic, relue ensuite). Coût inconnu = plancher inconnu : l'étape est montrée, jamais proposée à appliquer.

## Réponses ERA dans la messagerie Vinted (EXPERIMENTAL)

Sur une conversation vinted.fr (`/inbox/…`), un petit bouton **« Réponses ERA »** flotte au-dessus de la zone de message : vos réponses types (mesures, disponibilité, état, délai, lot, contre-offre, offre trop basse, remerciement), remplies avec ce qu'ERA sait de l'annonce liée par la conversation (fiche de l'atelier, prix, contre-offre de l'échelle d'offres). Un clic **écrit** le texte dans la zone ; ce qu'ERA ne sait pas reste « [à compléter] » (sélectionné, pour le taper). **ERA n'envoie jamais** : aucun appel, aucun clic sur « Envoyer ». Données réelles seulement (jamais la démo). Désactivable dans Réglages. Dépend de la façon dont Vinted construit sa page : non vérifié sur un vrai compte.

## Mes modèles de description

Atelier → étape Description → **« Créer mon modèle de description »** : votre texte, écrit une fois, pour une catégorie et/ou une marque, avec des mots entre accolades (`{marque}`, `{taille}`, `{état}`, `{défauts}`, `{matière}`, `{mesures}`, `{ref}`…). Le modèle le plus précis s'applique tout seul (catégorie + marque, puis catégorie, puis marque, puis « tout ») ; un autre ou la description ERA standard se choisissent par fiche. Ce qui n'est pas encore lu ou mesuré reste « __ ». La référence ERA est ajoutée si le modèle l'oublie (c'est elle qui relie l'annonce à l'article).

## Mots du titre

Atelier (étape Titre) et fiche d'un article en ligne : les mots que les annonces **comparables retenues** par la dernière analyse de marché mettent dans leur titre (au moins 3 annonces et 20 %), absents du vôtre — sans marques, tailles, remplissage ni vos propres mots. Couleurs et mentions (« vintage », « rare »…) sont signalées « seulement si c'est vrai ». C'est ce qu'écrit la concurrence, pas une preuve de vente. Dans l'atelier, un clic ajoute le mot avant la référence ERA ; ERA ne modifie jamais un titre sur Vinted.

## Dépenses et bénéfice net

Ventes → Comptabilité → **Dépenses** : emballages, envois, boosts, trajets, abonnements… saisis à la main, par date et catégorie, retirés de la marge de l'année pour un **bénéfice net** (partiel si des coûts d'achat manquent, inconnu s'ils le sont tous). Export CSV ; inclus dans la sauvegarde.

## Vérification complète du compte

Réglages → Diagnostic → **« Vérification complète (8 lectures) »** : chaque lecture dont ERA dépend est essayée une fois, en lecture seule (session, garde-robe, recherche, ventes, achats, notifications, messagerie, une annonce en entier) ; une erreur n'arrête pas les suivantes, sauf un blocage. Le résultat s'affiche à côté de chaque intégration (« Vérifié le … : lu sur votre compte » ou « échec »).

## Objectif : le plan mensuel

Avec un objectif, Aujourd'hui affiche ce qu'il faut **chaque mois** — ventes, annonces en ligne, mises en ligne par semaine — face à ce que vous faites aujourd'hui, calculé sur votre vente médiane et votre ratio annonces / ventes (en supposant qu'ils restent les mêmes avec plus de stock : une direction, pas une promesse).

## Bénéfice par heure

Insights → Vous : le bénéfice d'une heure de travail, au total et par niche — temps de fiche **mesuré** dans l'Atelier (votre médiane sinon), plus vos estimations d'envoi et de sourcing (modifiables). Seules les ventes au bénéfice connu comptent.

## Sauvegarde, actualisation, notifications, recherche

- **Sauvegarde** (Réglages) : un fichier JSON avec **toutes** vos données (articles, ventes, coûts, historique, fiches, réglages, journal). Restaurer **remplace** les données actuelles, après confirmation, tout ou rien. Vos données ne vivent que dans ce navigateur : un rappel apparaît dans la tournée si vous n'avez pas sauvegardé depuis 14 jours.
- **Actualisation automatique** (Réglages, désactivée par défaut) : un import en lecture seule toutes les 3, 6, 12 ou 24 h, **seulement si un onglet vinted.fr est déjà ouvert** et jamais pendant un blocage. L'**icône d'ERA** affiche le nombre de colis à envoyer ; une **notification Chrome** (au choix) annonce une nouvelle commande à envoyer ou une vente trouvée par une actualisation automatique. Nouvelle autorisation : notifications.
- **Recherche Ctrl+K / ⌘K** : un article (titre, marque, référence ERA), un écran ou une action (ajouter un lot, coûts manquants…), au clavier.

## Tournée du jour

Aujourd'hui → **Tournée du jour** : tout ce qui vous attend, dans une seule file, **une tâche à la fois avec son bouton sur place** — colis à envoyer (bordereau, contrôle, dossier), colis à surveiller, ventes réservées à enregistrer, coûts inconnus (achat Vinted en un clic), conseils d'ERA (prix à appliquer sur Vinted, republication sans perte), fiches à mettre en ligne. « Passer » met une tâche de côté pour la session ; une tâche faite sort de la file toute seule.

## Qualité des annonces

Stock → **Qualité des annonces** : chaque annonce en ligne, classée par ce qui la freine × l'argent qui attend dessus — moins de 5 photos, étiquettes absentes, titre bloquant, description trop courte, aucune mesure pour un vêtement, prix au-dessus de la médiane, peu de vues, favoris sans vente. Le nombre de photos vient de la garde-robe (aucun appel en plus) ; les descriptions que la garde-robe ne renvoie pas se lisent à la demande (10 annonces au plus, dans le budget). Ce qui n'a pas été lu est signalé « non lu », jamais compté comme vide. Les seuils sont les règles de travail d'ERA, pas celles de Vinted.

## Colis à surveiller

Ventes → **Colis à surveiller** : un colis envoyé ou en route depuis 7 jours et plus, en attente au point relais sans que l'acheteur l'ait retiré depuis 5 jours, ou livré depuis 3 jours et pas finalisé, d'après le statut texte de vos commandes Vinted (formulation **NON VÉRIFIÉE**) — la même lecture et les mêmes délais que l'écran Colis (« En cours de livraison » est un colis en route, pas livré). La durée compte depuis le changement de statut vu par ERA, sinon depuis la vente (« au moins »). Lien vers la conversation, le dossier d'envoi et tous les colis.

## Analyse de prix : quand la recherche ne trouve rien

- Une réponse de Vinted **sans liste d'annonces** n'est plus lue comme « 0 annonce » : une adresse de recherche apprise qui se révèle fausse est oubliée et la forme normale est réessayée ; sinon, une erreur claire.
- Moins de 8 annonces trouvées : la recherche est **élargie**, deux fois au plus (une requête chacune, dans le budget) — chaque côté d'une collaboration (« Uniqlo x KAWS » → « KAWS t-shirt », « UNIQLO KAWS »), les mots principaux du titre, la marque seule.
- « Aucun comparable fiable » affiche désormais **les recherches faites et ce que chacune a renvoyé**.

## Liste de courses

Buy → **Liste de courses** : à partir de **vos** ventes (jamais du marché seul), chaque niche vendue au moins 3 fois avec son prix encaissé médian, son délai, son profit par jour (si les coûts sont connus), le stock déjà détenu et le **prix maximal à payer** : prix encaissé médian − max(8 €, 40 %), traduit en prix affiché sur Vinted (protection acheteur 0,70 € + 5 % incluse, port en plus). « À éviter » : profit par vente trop faible, profit par jour très inférieur à l'habitude, ou lenteur quand le profit est inconnu. Une marque inconnue n'est jamais une niche.

## Scanner d'affaires

Buy → **Scanner d'affaires** : en un clic, les 5 meilleures niches de la liste de courses sont cherchées sur Vinted (lecture seule, une recherche chacune, annonces récentes d'abord, dans le budget d'appels). Restent seulement les annonces de la même marque et du même type d'article, hors lots / enfant / copies / vos propres annonces, dont le coût tout compris (prix + 0,70 € + 5 %) est sous votre maximum ; classées par marge attendue (port non compris).

## Approvisionnement hors Vinted

Sur la page produit d'une autre boutique, le popup ERA propose **« Lire ce produit »** : un script ponctuel, lancé par votre clic (`activeTab` + `scripting`), copie la fiche produit que la page publie déjà (JSON-LD schema.org, sinon balises OpenGraph `product:*`) puis ouvre l'analyse d'achat préremplie. Aucune requête réseau, aucune lecture en arrière-plan ; un prix dans une autre devise reste inconnu (jamais converti).
