# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète les sets de la **Galerie** FC 27 importés depuis fut.gg, avec la méthode du « Gallery Solver » de FUT Simple Trader (statut Galerie lu chez EA, prix de référence du marché, achat avec tolérance en paliers, revente ou club). Le catalogue de sets de FST vient de son serveur payant : les sets restent importés depuis fut.gg.

## AlbumFC27 : utilisation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27` (« Recharger » après mise à jour).
2. Ouvrir la Web App FC 27 : le panneau s'affiche à gauche (onglets Achats, Ventes, Journal).
3. **Importer** : « + Importer un set fut.gg », ouvrir un set de la Galerie, cliquer « Envoyer à AlbumFC27 ». Répéter pour plusieurs sets. Renvoyer un set le met à jour.
4. **Statut Galerie** (comme FST) : lu chez EA par la requête `GET /ut/game/fc27/defid?type=player&defId=…` (champ `isCollected`, 250 joueurs par requête), à l'import, au démarrage, avant chaque lot d'achats et via « ↻ Galerie EA ». Un joueur acheté mais non collecté selon EA redevient manquant (signalé dans le journal). La rareté (`rareflag`) et la note sont lues au passage.
5. **Cocher** les joueurs manquants (case du set = tous). Prix de départ = prix fut.gg, modifiable ; vide = prix de référence trouvé par sondage au lancement.
6. **Vérifier les prix** (facultatif, comme FST) : pour chaque joueur coché, prix de référence = 4e annonce la moins chère parmi celles publiées depuis plus d'une minute ; page pleine (21 annonces) : recherche dichotomique sous ce prix (10 recherches max, plancher 200/350 selon la note, 1 000 pour les cartes spéciales). Le prix trouvé remplace le prix de départ.
7. **Récapitulatif** (haut de l'onglet Achats) : crédits à dépenser, crédits récupérés, coût réel selon « Après achat » (taxe EA 5 % si revente, prix payé si club), avec le pire cas si la tolérance est consommée, et barre des crédits disponibles.
8. **Acheter** (boucle d'achat de FST) : recherche de la carte exacte au prix de départ, achat de l'une des 2 annonces les moins chères. Aucune annonce : prix relevé d'un palier EA par recherche, jusqu'à la **tolérance** (3 paliers par défaut, 0–10). Au-delà : statut « prix monté » avec l'annonce la moins chère relevée, joueur sauté (modifier le prix pour réessayer). 2 achats ratés : fenêtre de prix décalée d'un palier ; 6 ratés : abandon (concurrence) ; 10 recherches max par joueur. Crédits insuffisants pour le prix de départ : joueur sauté.
9. **Après achat** : « Revendre au prix d'achat » (défaut), « Revendre avec marge » (+5 % par défaut, au moins un palier) ou « Garder au club ». Mise en vente 1 h bornée à la fourchette de prix EA, enchère de départ un palier en dessous. Liste de transferts pleine ou mise en vente échouée : joueur gardé au club. Ordre : set par set dans l'ordre du panneau (dernier importé en haut) ; bilan à la fin de chaque set. Un joueur présent dans plusieurs sets est acheté dans le premier. Les joueurs non achetés restent cochés : relancer suffit.
10. **Vitesse** (onglet Réglages, résumé cliquable dans le récapitulatif de l'onglet Achats) : préréglages Prudent (7–12 s), Normal (4–8 s), Rapide (2–4 s), ou délais personnalisés entre recherches et avant achat. Ralentissement après limite EA réglable : multiplicateur à chaque limite (×1,5 par défaut, 1 = jamais), plafond (×4), retour au rythme normal après N min sans limite (30), bouton « Revenir au rythme normal ». Appliqué immédiatement, y compris pendant les achats et le relist.
11. **Relister** (onglet Ventes ou popup) : encaisse les ventes, puis pour chaque joueur invendu de la liste de transferts (acheté par AlbumFC27 ou non), sonde le marché (même sondage que « Vérifier les prix ») et le remet en vente au prix de l'annonce la moins chère vue, bornée à la fourchette EA (aucune annonce : prix précédent). Une carte que la Web App n'a pas chargée est remise en vente par la même requête que la Web App (identifiant de carte, session EA déjà ouverte). Les échecs sont remis en vente en bloc à leur prix précédent. Les annonces en cours ne peuvent pas être modifiées (règle EA) : elles sont relistables à leur expiration.

## Onglet Ventes

- Coût réel = perte réalisée (prix d'achat − net encaissé) + perte en attente (sur les joueurs encore en vente, au prix affiché). Joueurs gardés au club : nombre et montant dans la tuile « Dépensé ».
- En vente (valeur, invendus), vendus / achetés, crédits récupérés, dépensé, taxe payée. Liste des joueurs en vente, invendus en tête.

## Garde-fous

- Quotas réglables dans l'onglet Réglages (0 = illimité), cumulés avec SnipeFC27 : recherches par heure, recherches et achats par 24 h (tous désactivés par défaut) ; refus de démarrer si SnipeFC27 tourne.
- Pauses après refus EA réglables dans l'onglet Réglages (0 = aucune, défaut) : après une limite de débit (426, 429, 512, 521, ou 8 achats ratés d'affilée) et après un captcha (458, 460, 494). À 0, le process reprend après le délai normal entre recherches ; une pause enregistrée par une version précédente est levée au démarrage. Valeur > 0 : doublée si ça se répète (max 30 min pour les limites, 2 h pour les captchas).
- Captcha : notification (au plus une toutes les 10 min). Le captcha n'est pas résolu automatiquement : tant qu'il n'est pas résolu dans la Web App, les requêtes échouent et le process réessaie en boucle.
- Session expirée : rechargement de la Web App, clic sur le bouton de connexion si la session EA est encore ouverte, reprise des achats.
- Joueurs déjà dans la Galerie (`isCollected` de la requête `/defid` et des réponses EA) : ignorés.

## Limites connues

- Import basé sur la page fut.gg affichée (liens `/players/…/27-<defId>`, prix à côté de l'icône crédit) : un changement de mise en page fut.gg peut le casser.
- Que l'achat suffise à compter le joueur dans le set est contrôlé a posteriori par la lecture `/defid` (« Achetés mais absents de la Galerie selon EA » dans le journal) ; la requête `/defid` n'a été testée que sur une Web App simulée.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
