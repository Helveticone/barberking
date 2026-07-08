# Plan de design — Barber King Delémont

## Palette
- Encre (fond sombre): #17140F
- Papier (fond clair): #F4EEE1
- Rouge barbier (oxblood, pas criard): #9E2B25
- Bleu marine: #1F3552
- Laiton (accent premium): #B7935A
- Gris texte sur papier: #6E6659

## Typo
- Display: Oswald (condensé, esprit enseigne de barbier), majuscules, tracking large
- Texte courant: Work Sans
- Chiffres/horaires: Work Sans (tabular nums)

## Signature
Le ruban de l'enseigne de barbier (rouge/blanc/bleu en diagonale) devient
l'élément récurrent du site : séparateurs de section animés, soulignement
des titres, indicateur "ouvert maintenant". Ancré directement dans le vrai
logo et les vraies photos du salon (pas un accent générique).

## Mise en page (mobile-first, une page)
Bandeau d'infos -> Header sticky -> Hero (photo dramatique N&B) ->
ruban -> Services & tarifs -> Hassan (le barbier) -> Galerie ->
Réservation WhatsApp (étapes) -> Horaires (jour en cours en évidence) ->
Contact & accès -> Footer

## Notes
- Adresse exacte non confirmée à 100% par la recherche web -> placeholder
  à valider par le client avant mise en ligne.
- Un seul barbier actif (Hassan) mais la structure JS (tableau `BARBERS`)
  est prête pour en ajouter d'autres facilement.
