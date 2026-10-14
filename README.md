# AlbumFC27 : album + sniper pour la Web App FC 27

Une seule extension (`AlbumFC27/`), un seul panneau à droite de la Web App avec deux onglets :

- **Album** : complète les sets de la **Galerie** importés depuis fut.gg (achat au prix le plus bas, revente au prix d'achat, relist au prix du marché).
- **Snipe** : autobuyer repris de SnipeFC27 0.4 (filtres, prix automatiques, revente avec marge, pauses, mode nuit, relist de la liste de transferts).

## Installation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27` (« Recharger » après mise à jour).
2. **Supprimer les anciennes extensions AlbumFC27 2.x et SnipeFC27** si elles sont installées : les deux sont intégrées ici. Les données déjà enregistrées (sets, sélection, réglages, compteurs, journal, filtres du sniper) sont reprises telles quelles.
3. Ouvrir la Web App FC 27 : le panneau s'affiche à droite. L'icône de l'extension ouvre le popup (album : ACHETER / STOP, Relister ; sniper : LANCER / STOP, mode nuit ; afficher / masquer le panneau).

Une seule tâche tourne à la fois sur le marché (sniper, relist ou achats album) : les boutons de l'autre volet sont grisés tant qu'une tâche tourne. Pendant une tâche, la fenêtre de progression couvre la Web App ; « Réduire » la masque (le process continue, la ligne d'état sous les onglets la réaffiche), utile pour résoudre un captcha.

## Onglet Snipe

Repris de SnipeFC27 0.4 : limites anti-ban, activité du marché, filtres (joueur ou filtre de la Web App), prix automatiques ou fixés, pause et délai (Long, Normal, Risqué, Dangereux), mode nuit, suivi de session et journal. Les recherches et achats de l'album comptent dans les limites anti-ban affichées (ligne « Achats » = snipes + achats album).

## Onglet Album

1. **Importer** : « + Importer un set fut.gg », ouvrir un set de la Galerie, cliquer « Envoyer à AlbumFC27 ». Répéter pour plusieurs sets. Renvoyer un set le met à jour.
2. **Cocher** les joueurs manquants (case du set = tous). Prix de départ = prix fut.gg, modifiable ; vide = prix trouvé par sondage du marché au lancement.
3. **Récapitulatif** (haut de l'onglet) : crédits à dépenser, crédits récupérés à la revente, coût réel (taxe EA 5 %), avec le pire cas si la hausse va au plafond, et barre des crédits disponibles (engagé, hausse possible, manque).
4. **ACHETER** : pour chaque joueur, recherche au prix de départ et achat de l'annonce la moins chère (si la page est pleine, nouvelle recherche sous le minimum vu). Aucune annonce : le prix monte par paliers de 5 % jusqu'au plafond (+30 % par défaut, réglable dans le récapitulatif). Chaque joueur acheté est remis en vente immédiatement **au prix d'achat**. Ordre : set par set dans l'ordre du panneau (dernier importé en haut), joueurs dans l'ordre de la liste du set ; bilan à la fin de chaque set. Un joueur présent dans plusieurs sets est acheté dans le premier. Les joueurs non trouvés restent cochés : relancer suffit.
5. **Vitesse et pauses** : préréglages Prudent (7–12 s), Normal (4–8 s), Rapide (2–4 s), ou délais personnalisés entre recherches et avant achat. Ralentissement après limite EA réglable : multiplicateur à chaque limite (×1,5 par défaut, 1 = jamais), plafond (×4), retour au rythme normal après N min sans limite (30), bouton « Revenir au rythme normal ». Appliqué immédiatement, y compris pendant les achats.
6. **Relister** (bouton en bas de l'onglet Album, bouton « Relister au prix du marché » de l'onglet Snipe ou popup : même action) : encaisse les ventes, puis pour chaque joueur invendu de la liste de transferts, vérifie le prix du marché et le remet en vente :
   - joueur acheté par l'album : au prix de l'annonce la moins chère ;
   - carte snipée : un palier sous la moins chère, jamais sous le prix d'achat taxe comprise ;
   - autre carte : un palier sous la moins chère ;
   - aucune annonce : prix précédent.

   Une carte que la Web App n'a pas chargée est remise en vente par la même requête que la Web App (identifiant de carte, session EA déjà ouverte). Les échecs sont remis en vente en bloc à leur prix précédent. Les annonces en cours ne peuvent pas être modifiées (règle EA) : elles sont relistables à leur expiration.
7. **Ventes de l'album** (« Actualiser » relit la liste de transferts : ventes encaissées, état et prix des annonces, sans recherche sur le marché) : coût réel = perte réalisée (prix d'achat − net encaissé) + perte en attente (joueurs encore en vente, au prix affiché) ; en vente (valeur, invendus), vendus / achetés, crédits récupérés, dépensé, taxe payée ; liste des joueurs de l'album en vente, invendus en tête. Une lecture depuis le cache de la Web App (parfois incomplète) ne retire aucun joueur de la liste.
8. **Journal** de l'album, filtrable (Tout, Essentiel, Achats / ventes, Problèmes), copiable, effaçable.

## Garde-fous

- Sniper et relist : limites fixes (900 recherches / h, 4 500 / 24 h, 180 achats / h, 1 800 / 24 h) ; captcha ou limite EA : arrêt et verrou 12 h (« Lever le verrou »). Ce verrou bloque aussi l'album.
- Album : quotas réglables (0 = illimité, désactivés par défaut), comptés avec le sniper. Pauses après refus EA réglables (0 = aucune, défaut) : après une limite de débit (426, 429, 512, 521, ou 8 achats ratés d'affilée) et après un captcha (458, 460, 494). À 0, le process reprend après le délai normal ; valeur > 0 : doublée si ça se répète (max 30 min pour les limites, 2 h pour les captchas), reprise automatique ensuite.
- Captcha pendant les achats album : notification (au plus une toutes les 10 min). Le captcha n'est pas résolu automatiquement : tant qu'il n'est pas résolu dans la Web App (« Réduire » la fenêtre de progression), les requêtes échouent et le process réessaie en boucle.
- Session expirée : rechargement de la Web App, clic sur le bouton de connexion si la session EA est encore ouverte, reprise (sniper, mode nuit ou achats album).
- Liste de transferts pleine (100) : attente des ventes.
- Joueurs déjà dans la Galerie (`isCollected` dans les réponses EA, historique d'achats) : ignorés par l'album.

## Limites connues

- Import basé sur la page fut.gg affichée (liens `/players/…/27-<defId>`, prix à côté de l'icône crédit) : un changement de mise en page fut.gg peut le casser.
- Que l'achat suffise à compter le joueur dans le set (sans ajout manuel dans la Galerie) n'est pas vérifié.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
