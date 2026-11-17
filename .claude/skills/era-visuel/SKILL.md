---
name: era-visuel
description: Rendre ERA très visuel (3D, scènes interactives, animations) selon la méthode Omnya Lab — à charger avant toute vue visuelle, 3D, carte, scène ou animation dans l'extension ERA.
---

# ERA visuel — la méthode « stade » appliquée à un stock Vinted

Source : le blueprint gratuit d'Omnya Lab (« Stadium Method », 9 pages) — un stade three.js de 108 761 sièges où l'on
choisit sa place. Ce qui compte n'est pas le stade : c'est **la façon dont ils font coder Claude**. Six règles, puis
leur traduction dans ERA.

## Les six règles

1. **Décrire le résultat, pas le code.** Leurs prompts tiennent en 4 lignes : ce qu'il y a dans la scène, les
   matières, les quantités, la structure (« Draw all the seats as one InstancedMesh, so every seat knows its tier, row
   and number »). Écrire ainsi chaque demande visuelle : scène → éléments → ce que chaque élément sait → interaction.
2. **Chaque élément sait qui il est.** Un siège connaît sa tribune, son bloc, son rang, son numéro : c'est ce qui le rend
   cliquable. Dans ERA : chaque instance 3D porte l'`itemId` de l'article (index d'instance → article), jamais une
   forme anonyme.
3. **Une seule référence.** Chez eux la 3D est la vérité ; photos et vidéos en dérivent « same camera, same framing,
   add nothing ». Dans ERA : **les données sont la vérité** (Dexie, `buildItemViews`) ; la scène les montre, n'invente
   rien (UNKNOWN ≠ ZERO : un prix inconnu n'a pas de hauteur inventée, il est marqué inconnu).
4. **Pas de coupe.** « The end of every clip is the start of the next » : la caméra va du survol à l'article en un seul
   mouvement continu, interruptible. Sauf en mouvements réduits (`prefers-reduced-motion` ou Réglages → Animations) :
   saut direct, aucune animation.
5. **La couleur vient après, par-dessus.** La scène de base reste sobre ; un filtre (« Baisse à faire », « À
   republier », « À envoyer ») colore seulement les instances concernées, comme leur masque orange en post. Jamais de
   couleur décorative qui ne veut rien dire.
6. **Survol → prix, clic → vol → « billet ».** Le survol montre l'essentiel (titre, prix, vues, favoris, jours en
   ligne) ; le clic vole jusqu'à l'article et ouvre sa « carte billet » : la photo, l'état, **la prochaine action**
   (l'équivalent de leur « upgrade VIP ») et un bouton vers la fiche.

## Les règles d'ERA qui priment

- **Aucune photo générée ou retouchée par IA** pour un article (règlement Vinted, règle du vendeur). Leurs étapes 2-3
  (photo IA, vidéo IA) ne s'appliquent **jamais** aux articles. Une photo affichée est celle de Vinted, telle quelle.
- **Aucune fausse donnée présentée comme réelle** ; une scène en démo dit qu'elle est en démo.
- **Local** : three.js est empaqueté (npm), chargé à la demande (`import()` dans l'écran 3D seulement) ; aucun script
  distant (CSP MV3).
- **Accessible** : la vue 3D a toujours son équivalent en liste/tableau ; navigation clavier (flèches, Entrée) ;
  `aria-label` sur le canvas, région `aria-live` pour l'article survolé ; contraste des cartes en clair et en sombre.
- **Sobre en calcul** : une `InstancedMesh` par forme (jamais un mesh par article), rendu à la demande (pas de boucle
  quand rien ne bouge), `devicePixelRatio` plafonné à 2, nettoyage (`dispose`) au démontage.
- **Repli** : WebGL indisponible → message clair et lien vers la liste, jamais un écran vide.
- **Tests** : la mise en page (positions, couleurs) est pure et testée en unitaire ; l'e2e passe par le clavier, pas
  par des coordonnées de pixels.

## Modèle de demande (à réutiliser)

> Construis [la scène] en three.js : [disposition, en mots simples]. Dessine tous les [éléments] dans une seule
> InstancedMesh, pour que chaque [élément] sache [son identité ERA]. Couleur de base [sobre] ; le filtre [X] colore en
> [couleur] seulement [les éléments concernés]. Survol : [infos]. Clic : la caméra vole sans coupure jusqu'à
> [l'élément] et la carte montre [photo, état, prochaine action, bouton]. Mouvements réduits : saut direct.
