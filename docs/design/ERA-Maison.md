# ERA Maison — la direction artistique, de A à Z

Version 0.54.0. Remplace l'habillage « Midnight » de la 0.53.0 sans renier ce qui avait été validé : la palette nuit,
le logo « l'étiquette coupée », le geste de vente toujours à portée.

## 1. Le brief, en une phrase

Le vendeur tient une maison d'archives vintage (era-archives) : ERA doit ressembler au back-office d'une maison de
mode, pas à un tableau de bord SaaS. On le montre à quelqu'un, il doit avoir envie de l'ouvrir.

## 2. Ce qui a été étudié (et ce qui ne l'a pas été)

| Source | Lue ? | Ce qu'on en retient |
| --- | --- | --- |
| Classement Adveris « sites innovants de l'année » | Non : domaine bloqué par le réseau de l'environnement ; seuls des extraits de recherche (1x.tech, glenncatteeuw.com) | Rien de précis à en tirer sans la page |
| Article NocodeFactory « Top 8 Claude skills design » | Non : domaine bloqué ; contenu connu par recherche | Les skills cités : frontend-design (Anthropic), Canvas Design, Impeccable (audit), animations d'Emil Kowalski, Web Design Guidelines (Vercel) |
| Skill **frontend-design** d'Anthropic (dépôt anthropics/skills) | Oui, en entier | La méthode ci-dessous (§ 4) |
| Awwwards, catégorie luxe 2026 (Delvaux, Cartier, Bulgari, Brunello Cucinelli) | Liste seulement | Photo d'abord, typographie éditoriale, mouvement lent et rare |
| Extensions Vinted concurrentes (Fripio, Clemz, VintedCRM, Vintex, Peak2List, Dotb, VintEdge) | Fiches et comparatifs publics | § 8 |

**Aucun code tiers n'est copié.** Le code d'un site de marque appartient à la marque (droit d'auteur) et la règle du
projet l'interdit. On reprend des principes — composition, échelle typographique, rythme, mouvement — et on les écrit
nous-mêmes. Les polices sont sous licence libre (SIL OFL) et embarquées dans l'extension.

## 3. La liste complète de ce qu'on reprend

### Couleur
- Palette de base inchangée, nommée : Nuit `#101923`, Ardoise `#17232F`, Papier `#F4F2EC`, Bleu poudre `#B8D8F2`
  (l'action), Coquelicot `#FF9A89` (ce qui se perd).
- Une seule couleur d'action par écran. Les tons (ambre, vert, corail) ne servent qu'à dire un état.
- Aucun dégradé, aucun halo, aucune ombre décorative. L'ombre est réservée à ce qui flotte (fenêtres, menus).
- Contraste WCAG AA vérifié automatiquement sur tous les écrans, en nuit et en Papier.

### Typographie
- **Bodoni Moda** (didone, axe de taille optique) pour la voix de la maison : titres de page, la phrase « Pour vous »,
  les grands chiffres. C'est le vocabulaire des magazines et des maisons de mode.
- **Geist** pour tout ce qu'on lit et manipule : textes, boutons, tableaux.
- Échelle : 64 / 40 / 26 / 15 / 13 / 11. Lignes de moins de 80 caractères.
- Pas de mot isolé en italique ou en couleur dans un titre. Les petites capitales espacées sont réservées aux
  étiquettes (état d'un article, en-têtes de colonnes), comme une étiquette tissée — jamais au-dessus de chaque titre.

### Agencement
- Une colonne éditoriale large, des marges généreuses, une grille à 12 colonnes.
- Le titre de page est un événement : grand, seul, avec une phrase dessous. Les actions sont à droite, discrètes.
- Moins de boîtes : rayon de 4 px (coupe tailleur), filets fins, pas de cartes identiques à ombre grise.
- La photo du vêtement est l'élément roi : la **Vitrine** montre le stock comme une page de collection.

### Animation
- **Un seul moment orchestré** : l'entrée dans la boutique 3D, et le titre de la page qui se dévoile avec elle.
- Le mouvement répond aux gestes (ouvrir, confirmer, republier : les étapes avancent) ; plus de fondus sur chaque carte.
- Courbe lente et douce `cubic-bezier(0.22, 1, 0.36, 1)` ; « mouvements réduits » respecté partout.

### Code
- Un seul calque de style (`maison.css`) posé après les styles de base : les composants restent les mêmes, leur
  habillage change. Jetons CSS (couleur, type, espace, rayon, mouvement), aucune valeur codée en dur dans les écrans.
- Polices locales (woff2, sous-ensembles latin et latin étendu) : rien n'est chargé depuis Internet (CSP de Chrome).
- React + TypeScript strict, composants accessibles (clavier, `aria`), tests de bout en bout et d'accessibilité.

### Composants
- Barre latérale : le logo, le nom de la maison en capitales espacées, une liste de pages en texte, la page courante
  marquée d'un filet.
- Boutons : rectangulaires, 4 px, texte en casse normale ; l'action principale en Bleu poudre.
- Étiquettes d'état : petites capitales, bordure fine, comme une étiquette cousue.
- Tableaux : en-têtes en petites capitales, lignes aérées, filets fins.
- Onglets : soulignés, pas de pastilles.
- Fenêtres : fond Ardoise, filet, une seule ombre longue.

### Écrans
- Aujourd'hui : « Aujourd'hui » en grand, « Pour vous » comme une phrase de couverture, puis le rail des tournées.
- Stock : Vitrine (photos), Liste (tableau), Boutique 3D.
- Pilote, Marché, Achats, Ventes, Analyses, Outils, Réglages : même tête de page, mêmes cartes, mêmes tableaux.
- Popup : la même voix (titre en Bodoni, une action).

## 4. La méthode suivie (skill frontend-design, adaptée)

1. Partir du sujet : un vendeur de vêtements vintage, son vocabulaire (étiquettes, portants, archives, collection).
2. Dépenser l'audace à un seul endroit : ici la Vitrine et la typographie des titres ; tout le reste reste calme.
3. Éviter les réflexes « générés par IA » : cartes identiques arrondies à ombre grise, dégradés décoratifs, mot accentué
   dans un titre, fondus sur chaque bloc, chiffres géants avec petit libellé partout.
4. Plancher de qualité sans l'annoncer : clavier, contraste, mouvements réduits, petits écrans.
5. Critiquer sur captures réelles, corriger, recommencer.

## 5. Ce qui n'est pas repris, volontairement

- Curseur personnalisé, défilement « inertiel », vidéos plein écran : c'est fait pour un site vitrine qu'on visite une
  fois, pas pour un outil qu'on ouvre vingt fois par jour.
- Photos retouchées ou générées : jamais pour un article (règle Vinted et règle du vendeur).

## 6. Extensions Vinted concurrentes : ce qu'elles proposent, ce qu'ERA a

| Fonction | Concurrents | ERA |
| --- | --- | --- |
| Republication automatique | Fripio, Clemz, VintedCRM, Vintex, Dotb | Oui : tournées du Pilote, liste « À republier », « Republier maintenant » |
| Republication par règles (jour, heure, catégorie) | VintedCRM | Heures oui ; catégorie non |
| Messages et offres aux favoris | Fripio, Clemz | Oui, avec plancher de prix |
| Réponses aux acheteurs par IA | Vintex | Oui (Gemini, relues ou envoyées selon le réglage) |
| Baisse de prix en masse | Fripio | Oui : plan de baisse par article |
| Statistiques, comptabilité, CRM acheteurs | VintedCRM | Oui : ventes, marges, comptabilité, factures ; fiche acheteur partielle |
| Publication assistée (photos → annonce) | Fripio, Peak2List | Oui : Atelier → brouillon → publication |
| Bordereaux | rare | Oui, un ou tous d'un coup |
| Multi-compte | Vintex, Peak2List | **Non, volontairement** : interdit par Vinted |
| Délais aléatoires « pour ne pas être détecté » | Peak2List | **Non, volontairement** : c'est du contournement d'anti-robot |

Tous ces outils, ERA compris, automatisent un compte Vinted : c'est une zone grise des conditions d'utilisation de
Vinted (risque de visibilité réduite ou de blocage). ERA s'impose un budget d'appels, s'arrête au premier refus et
marque EXPERIMENTAL ce qui n'a pas été vu fonctionner sur le compte.

---

# ERA Maison · Lumière (0.55.0)

Le brief du vendeur : garder l'ADN (titres en serif, nuit bleu ardoise, logo, barre latérale) et corriger six défauts.
Deux autres briefs proposaient « Obsidian & Volt » (noir #09090B, vert acide #D4FF00) : ils contredisent le premier
point ; la direction suivie est celle qui garde l'ADN d'ERA. Leur « Snipe en 1 clic » et leur flux d'annonces « à la
seconde » ne sont pas repris : il faudrait interroger Vinted en continu, très au-delà du budget de 60 requêtes par
session qui a été fixé après trois blocages du compte, et acheter automatiquement, c'est un robot d'achat.

## Jetons (sombre, par défaut)

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| Fond | `--bg` | `#080C12` |
| Surface (cartes, fenêtres) | `--surface` | `#0F151F` |
| Surface au survol | `--surface-hover` | `#161F2C` |
| Creux (champs, zones) | `--surface-sunken` | `#0B1119` |
| Bordure latérale | `--border` | `rgba(255,255,255,.06)` |
| Bordure appuyée | `--border-strong` | `rgba(255,255,255,.12)` |
| Arête lumineuse (haut des surfaces) | `--edge-light` | `rgba(255,255,255,.12)` |
| Texte | `--text` | `#F4F2EC` |
| Texte secondaire | `--text-2` | `#8E9BAE` |
| Texte discret (≥ 4,5:1 partout) | `--text-3` | `#8794A7` |
| Action (glacier) | `--accent` / `--on-accent` | `#E2E8F0` / `#080C12` |
| Profit, en ligne, temps réel | `--emerald` | `#34D399` |
| Alerte douce | `--amber` | `#FBBF24` |
| Manqué, critique | `--coral` | `#F87171` |
| Ombre des surfaces | `--shadow-card` | `0 1px 2px rgba(0,0,0,.35), 0 14px 32px -16px rgba(0,0,0,.7)` |

Clair (« Papier ») : fond `#F4F2EC`, surface `#FDFCF7`, texte `#101923`, action `#24445E`, émeraude `#047857`, ambre
`#92400E`, corail `#B91C1C`, arête `rgba(255,255,255,.9)`. Contraste AA vérifié par le test d'accessibilité.

## Règles de lumière
- Toute surface posée (carte, fenêtre, barre de sélection, menu) : bordure latérale `--border`, bordure du haut
  `--edge-light`, ombre `--shadow-card`. Ce qui flotte (menus, fenêtres) prend l'ombre longue `--shadow-3`.
- Rayons : 6 px pour les surfaces, 4 px pour les boutons et champs, 3 px pour les étiquettes.

## Typographie
| Usage | Police | Réglages |
| --- | --- | --- |
| Logo, titres de page (H1) | Bodoni Moda | 500, −0,015 em, 40–64 px (page), 46 px (article) |
| Interface, titres de section | Geist | sections 15–20 px 600–650, −0,02 em ; texte 13–15 px |
| Étiquettes, en-têtes de colonnes | Geist | 10,5 px 600, capitales, +0,13 em |
| Tous les chiffres (prix, marges, heures, durées, compteurs, %) | JetBrains Mono | `tabular-nums`, −0,02 em |

## Écran par écran
- **Aujourd'hui** : « Pour vous » en phrase de couverture ; le rail des tournées en couleurs d'état (terminée
  émeraude, en retard ambre, manquée corail en pointillé, prochaine éclairée) ; « Maintenant · 16 h 27 » en trait
  lumineux sur la frise ; une légende qui filtre les types d'action.
- **Stock** : la Vitrine — fond « studio » quand Vinted ne sert pas de photo (dit comme un emplacement, jamais une
  fausse photo), prix et marge incrustés au pied de la vignette (« Marge ? » tant que le coût est inconnu).
- **Fiche article** : une action principale (Analyser le marché), une secondaire (Republier maintenant), le reste sous
  « Actions » ; les chiffres en une barre de métriques à filets verticaux.
- **Réglages** : mêmes surfaces éclairées, budget Vinted en chiffres mono, interrupteurs et étiquettes
  EXPÉRIMENTAL / NON VÉRIFIÉ.

Maquette interactive (mêmes jetons, données de démonstration) : https://claude.ai/artifact/GhVZeBAsUsMugs7TgNDFX9

## 0.56–0.57 : les étiquettes suivent la preuve, le Pilote ouvre sur son état

- **Expérimental / Non vérifié** : une seule règle pour toute l'interface (`VerifyFlag`, `UntilProven`). L'étiquette
  et les phrases « pas encore vu fonctionner » ne s'affichent que tant que le registre des intégrations (ou, pour les
  repères et les réponses posés dans les pages Vinted, la première trace laissée par le script de page) ne montre pas
  la fonction réussie sur cet appareil. Jamais retirées sur la foi des tests sur faux Vinted.
- **Pilote** : l'écran s'ouvre sur l'état (« Le Pilote tourne » en émeraude, « Le Pilote est éteint ») à côté d'un vrai
  interrupteur ; tous les marche/arrêt du Pilote et de ses agents sont des interrupteurs. Les règles viennent après,
  ouvertes tant que le Pilote ne tourne pas, repliées ensuite (un clic pour les relire).
- **Outils** : même tête de page que les autres écrans (titre serif, phrase, action à droite).
- **Textes** : plus de promesse que le produit ne tient plus (« ERA ne modifie jamais vos annonces », « ERA ne publie
  jamais ») ni de référence à un autre outil.

## 0.58 : Ventes et Analyses à la hauteur du reste

- **Ventes** : l'écran s'ouvre sur deux chiffres en grand (chiffre d'affaires, profit connu), la phrase du panier
  moyen, puis, s'il y a lieu, une seule barre ambre « N ventes sans coût d'achat » avec le bouton qui mène au stock
  filtré. Les sept chiffres secondaires (marge moyenne, ROI, taux d'écoulement, délai médian, capital retourné,
  remboursements, efficacité du capital) suivent en barre à filets, comme sur la fiche article.
- **Bandeaux de chiffres** (Analyses, Capital, Comptabilité, Atelier, Précision) : plus de pastille d'icône colorée,
  libellés en petites capitales espacées, et une même ligne de base pour toute la rangée (CSS subgrid), qu'un libellé
  tienne sur une ligne ou deux.
- **Qualité de la donnée** : le repère (plein, demi, pointillé, losange, vide) est dessiné en CSS ; le caractère ◐
  tombait sur une police de secours et s'affichait comme une virgule.
- **Mots** : « Sell-through » devient « Taux d'écoulement » ; « coûts manquants : minimum » devient « au moins : des
  coûts manquent ».
