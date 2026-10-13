# Extensions FC 27 Web App

- `SnipeFC27/` : autobuyer existant (achat sous le prix, revente avec marge).
- `AlbumFC27/` : complète les sets de la **Galerie** FC 27 importés depuis fut.gg (achat au prix le plus bas, revente au prix d'achat, relist au prix du marché).

## AlbumFC27 : utilisation

1. Chrome > `chrome://extensions` > Mode développeur > Charger l'extension non empaquetée > dossier `AlbumFC27` (« Recharger » après mise à jour).
2. Ouvrir la Web App FC 27 : le panneau s'affiche à gauche (onglets Achats, Ventes, Journal).
3. **Importer** : « + Importer un set fut.gg », ouvrir un set de la Galerie, cliquer « Envoyer à AlbumFC27 ». Répéter pour plusieurs sets. Renvoyer un set le met à jour.
4. **Cocher** les joueurs manquants (case du set = tous). Prix de départ = prix fut.gg, modifiable ; vide = prix trouvé par sondage du marché au lancement.
5. **Récapitulatif** (haut de l'onglet Achats) : crédits à dépenser, crédits récupérés à la revente, coût réel (taxe EA 5 %), avec le pire cas si la hausse va au plafond, et barre des crédits disponibles (engagé, hausse possible, manque).
6. **Acheter** : pour chaque joueur, recherche au prix de départ et achat de l'annonce la moins chère (si la page est pleine, nouvelle recherche sous le minimum vu). Aucune annonce : le prix monte par paliers de 5 % jusqu'au plafond (+30 % par défaut, réglable dans le pied du panneau). Chaque joueur acheté est remis en vente immédiatement **au prix d'achat**. Ordre : set par set dans l'ordre du panneau (dernier importé en haut), joueurs dans l'ordre de la liste du set ; bilan à la fin de chaque set. Un joueur présent dans plusieurs sets est acheté dans le premier. Les joueurs non trouvés restent cochés : relancer suffit.
7. **Vitesse** (onglet Réglages, résumé cliquable dans le récapitulatif de l'onglet Achats) : préréglages Prudent (7–12 s), Normal (4–8 s), Rapide (2–4 s), ou délais personnalisés entre recherches et avant achat. Ralentissement après limite EA réglable : multiplicateur à chaque limite (×1,5 par défaut, 1 = jamais), plafond (×4), retour au rythme normal après N min sans limite (30), bouton « Revenir au rythme normal ». Appliqué immédiatement, y compris pendant les achats et le relist.
8. **Relister** (onglet Ventes ou popup) : encaisse les ventes, puis pour chaque joueur invendu de la liste de transferts (acheté par AlbumFC27 ou non), sonde le marché et le remet en vente au prix de l'annonce la moins chère trouvée (aucune annonce : prix précédent). Les échecs individuels sont remis en vente en bloc à leur prix précédent. Les annonces en cours ne peuvent pas être modifiées (règle EA) : elles sont relistables à leur expiration.

## Onglet Ventes

- Coût réel = perte réalisée (prix d'achat − net encaissé) + perte en attente (sur les joueurs encore en vente, au prix affiché).
- En vente (valeur, invendus), vendus / achetés, crédits récupérés, dépensé, taxe payée. Liste des joueurs en vente, invendus en tête.

## Garde-fous

- Quotas réglables dans l'onglet Réglages (0 = illimité), cumulés avec SnipeFC27 : recherches par heure, recherches et achats par 24 h (tous désactivés par défaut) ; refus de démarrer si SnipeFC27 tourne, liste de transferts pleine (100) : attente des ventes.
- Pauses après refus EA réglables dans l'onglet Réglages (0 = aucune, défaut) : après une limite de débit (426, 429, 512, 521, ou 8 achats ratés d'affilée) et après un captcha (458, 460, 494). À 0, le process reprend après le délai normal entre recherches ; une pause enregistrée par une version précédente est levée au démarrage. Valeur > 0 : doublée si ça se répète (max 30 min pour les limites, 2 h pour les captchas).
- Captcha : notification (au plus une toutes les 10 min). Le captcha n'est pas résolu automatiquement : tant qu'il n'est pas résolu dans la Web App, les requêtes échouent et le process réessaie en boucle.
- Session expirée : rechargement de la Web App, clic sur le bouton de connexion si la session EA est encore ouverte, reprise des achats.
- Joueurs déjà dans la Galerie (`isCollected` dans les réponses EA, historique d'achats) : ignorés.

## Limites connues

- Import basé sur la page fut.gg affichée (liens `/players/…/27-<defId>`, prix à côté de l'icône crédit) : un changement de mise en page fut.gg peut le casser.
- Que l'achat suffise à compter le joueur dans le set (sans ajout manuel dans la Galerie) n'est pas vérifié.
- L'automatisation de la Web App est contraire aux conditions d'EA : risque de restriction du marché ou du compte.
