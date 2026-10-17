# FC27 Trader

Extension Chrome unique pour la Web App FC 27 : fusion de SnipeFC27 (0.6.2) et AlbumFC27 (3.3). Elle remplace les deux anciennes extensions : désinstalle-les avant de charger celle-ci (les réglages, cibles, sets et statistiques sont repris automatiquement, même stockage).

## Installation

`chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `FC27Trader` (« Recharger » après mise à jour).

## Interface

- **Bouton flottant** (bas à gauche) : état en direct, bouton ▶ / ■ pour lancer ou arrêter le sniper, clic pour ouvrir le panneau.
- **Panneau** : onglets Sniper, Galerie, Ventes, Journal, Réglages. Un bandeau unique montre la tâche en cours avec un seul bouton **Arrêter** (et « Lever la pause » pendant une pause anti-captcha).
- **Popup** de l'extension : état, crédits, profit, lancer / arrêter le sniper, alternance, relister, ouvrir le panneau.

## Sniper (moteur SnipeFC27)

1. Onglet Sniper > **Cibles** : chercher un joueur, « + Filtre de la Web App », ou ajouter des cartes manquantes depuis la Galerie (🎯).
2. **Lancer le sniper**. Prix automatiques : achat un palier sous la moins chère du marché, baissé jusqu'au profit visé (2 % du prix, 150 minimum, ou profit min réglé), revente 1 h jamais sous le prix d'achat taxe comprise.
3. **Alterner les cibles** (remplace le mode nuit) : change de cible toutes les 450 à 900 recherches.

Ventes détectées vite : liste de transferts relue toutes les 2 à 4 min pendant le sniping tant que des cartes sont en vente ; liste pleine ou crédits insuffisants : relue toutes les 1 à 2 min et reprise dès qu'une vente libère la place ou les crédits (avant : nouvel essai après 8 à 12 min). Achat direct Galerie en attente de crédits : relecture toutes les minutes.

Fonctionnement continu, toujours actif : le sniper attend au lieu de s'arrêter (crédits insuffisants, liste de transferts pleine, quota anti-ban, cible sans prix rentable), reprend après rechargement de la Web App (session expirée, connexion automatique si la session EA est ouverte), après une tâche Galerie et après une pause. Pendant ses pauses : ventes encaissées, non-assignés rangés, snipes invendus remis en vente.

Hésitations : 8 % des recherches, +0,5 à 1,5 s (au lieu de +1 à 4 s).

## Galerie (AlbumFC27)

- Sets de la Galerie fut.gg importés à l'ouverture (au plus toutes les 6 h), ou un par un avec le bouton « Envoyer à FC27 Trader » sur fut.gg. Statut collecté lu chez EA.
- **Synchro par critère** : un set de la Galerie se remplit avec n'importe quel joueur qui remplit son critère (ligue, club, nation, rareté). Les joueurs listés par fut.gg ne sont que l'équipe la moins chère. Le critère est déduit de la rubrique fut.gg (/leagues/, /nations/, /rarities/, sinon club) et des attributs EA des joueurs listés ; s'il n'est pas reconnu (saisons, promos…), seuls les joueurs listés comptent (« liste fut.gg »). Places = cartes requises, sinon nombre de joueurs listés. **Collection Galerie** : « Scanner le club » lit le club (prêts exclus), puis le statut « collecté » de tous les joueurs du jeu chez EA (recherche « concept » de la Web App, 200 joueurs par page, 1 à 2 s entre les pages, quelques minutes) : joueurs présents et passés au club, ventes d'avant l'installation comprises. Après une lecture complète, la collection = joueurs collectés selon EA + club. Si la recherche « concept » est indisponible : repli sur les joueurs des sets, le club, les achats et les snipes de l'extension. « Copier le diagnostic » (bloc Sets à faire) copie ce que l'extension lit chez EA, pour corriger la synchro.
- **Places et grades** : le nombre de joueurs requis (« requires 20 … players ») et les seuils de grade D à S (« Grade requirements ») sont lus sur la page fut.gg de chaque set ; catalogue relu une fois après la mise à jour. Une tuile affiche « Remplies X / places » et le grade estimé (« Grade C · B à 700 k ») : score = meilleures cartes de ta collection dans la limite des places, barème des joueurs, sans bonus de tags (souvent plus haut en jeu). « places ? » : nombre requis non lu, taille de la liste fut.gg utilisée. Quand fut.gg change sa liste (prix, nouvelles cartes), un joueur déjà collecté du set reste compté.
- **Objectif niveau Galerie** (haut de l'onglet Galerie, niveau 10 ≈ 3 000 000 points, estimation des joueurs) : score actuel (saisi depuis le jeu ; sinon lu dans une réponse EA « gallery » s'il y passe ; sinon estimé sur les sets importés), objectif, budget (crédits engagés au plus, solde par défaut). Plan : les cartes qui rapportent le plus de points estimés par crédit, jusqu'à l'objectif ou au budget. Une carte compte dans chaque set importé où elle entre (emplacements = cartes requises, sinon tous les joueurs du set) ou remplace une carte plus faible. Score par carte : barème des joueurs, non publié par EA (or 75 = 90 … 84 = 830, 85 = 2 100, 90 = 14 000, 99 = 100 000 ; argent 35 ; bronze 20 ; rareté spéciale x1,25 estimée). Non comptés : bonus de tags (First Owner, etc.) ; une carte achetée n'a jamais le tag First Owner. « Acheter le plan » : achat direct de la plus rentable à la moins rentable, puis traitement selon « Après achat » (revente : coût = taxe 5 %, le score reste acquis). « 🎯 Sniper le plan » : cartes envoyées au sniper. Placer ensuite les cartes dans les sets du jeu (remplissage automatique) : l'extension ne le fait pas.
- **Sets à faire** (haut de l'onglet Galerie) : « ⟳ Scanner le club » lit les joueurs présents au club (page par page) puis le statut Galerie EA (joueurs passés au club), sniper suspendu pendant le scan. Pour chaque set incomplet : cartes à acheter pour le finir (seulement les moins chères si le set n'en demande qu'une partie, « N requises ») et coût au prix fut.gg ou au prix vérifié. Sets proposés et cochés après le scan : les moins chers à finir qui tiennent ensemble dans le solde (joueur commun à plusieurs sets compté une fois ; sets avec une carte sans prix jamais proposés). Cocher / décocher, puis **Faire les sets** : achat direct lancé tout de suite, set par set du moins cher au plus cher, progression dans la fenêtre d'achat. Solde insuffisant : confirmation, puis attente des ventes en cours. « Ajuster… » ouvre la fenêtre d'achat (prix, cartes, écart max, après achat) sans lancer.
- Barre de recherche (sans accents ni majuscules) : filtre les sets par nom ou par joueur, et liste les joueurs trouvés dans tous les sets (clic : sélection d'une carte manquante, ↗ : ouvrir le set). Filtre Tous / Incomplets / Complets.
- Plusieurs sets d'un coup : cocher les sets (liste « Sets à faire », case en haut à gauche de chaque set, ou « Cocher les sets affichés »), puis 🎯 Sniper ou Faire les sets sur les cartes qui manquent pour les finir.
- Sélectionner les cartes manquantes, puis au choix :
  - **🎯 Sniper** : les cartes deviennent des cibles du sniper (alternance activée, sniper lancé). Achat sous le prix du marché, revente avec profit : la Galerie se remplit en gagnant des crédits, plus lentement. Une carte obtenue est retirée des cibles.
  - **Acheter maintenant** : achat direct au prix du marché (méthode FST : 4e annonce la moins chère, écart max en paliers), puis revente au prix d'achat, avec marge ou club. Rapide, coût = taxe EA 5 %. Le sniper est suspendu pendant les achats puis reprend seul. En fin de lot, les cartes non achetées peuvent être envoyées au sniper.

## Ventes

Un seul **Relister les invendus** (sniper arrêté) : remet chaque invendu un palier sous la moins chère du marché, jamais sous le prix d'achat (taxe comprise pour un snipe, prix payé pour une carte Galerie). « Cartes Galerie en vente » : recalé sur la vraie liste de transferts à chaque lecture (ouverture de la Web App, pauses du sniper, liste ouverte dans la Web App, bouton « ↻ Actualiser ») ; une carte absente n'est plus suivie. Suivi du sniper (profit réel, par heure, en attente, snipes, recherches, temps, rendement sur les cartes vendues, taxe EA payée, délai de vente moyen, profit du jour), coût réel de la Galerie, dernières ventes.

Suivi détaillé du sniper (bouton « Réinitialiser » commun) :

- **Sessions** : une session couvre le fonctionnement continu du sniper, rechargements de la Web App et tâches Galerie compris ; un arrêt manuel la clôt, plus de 30 min d'interruption en ouvre une nouvelle. Par session : durée, recherches, snipes / ratés, profit réel (rattaché à la session d'achat, même si la vente arrive plus tard), en attente, profit / h ; détail des cibles au survol. 30 dernières sessions conservées. L'onglet Sniper et la popup affichent la session en cours.
- **Par joueur** : snipes / ratés, ventes, profit réel, profit moyen par vente, délai moyen de vente, cartes en attente ; recherches ciblées, investi et meilleure vente au survol. Tri par profit, snipes ou activité récente, export CSV (presse-papiers).
- **Par jour** : 14 derniers jours, durée, recherches, snipes, ventes, profit réel.

## Garde-fous (communs à toutes les tâches)

- Une seule tâche EA à la fois.
- Limites anti-ban (Prudent 600 recherches / h, 3 000 / 24 h, 120 achats / h, 600 / 24 h ; ou Stevie), délais et pauses réglables dans Réglages.
- Captcha ou limite EA (426, 429, 458, 460, 494, 512, 521, marché vide sans filtre) : pause de 30 à 60 min puis reprise automatique, doublée si ça se répète dans les 24 h (4 h max), notification système. Un captcha affiché doit être résolu à la main dans la Web App.

## Limites connues

- Testé sur une Web App simulée uniquement (moteurs, suspension et reprise, ventes, relist, pause captcha).
- Import fut.gg dépendant de la mise en page de fut.gg.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
