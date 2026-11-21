# Estimation de la reprise du trafic (volet A)

Code : `backend/app/estimation/`. Validation : `python -m app.estimation.evaluation` (depuis `backend/`).

## Idée

Les CFF annoncent une heure de fin. Elle reste l'information principale. Notre estimation ajoute une marge honnête autour, calculée à partir des incidents passés, et traduit l'annonce en probabilités :

> « SBB announces 18:00. In 11 past incidents (same cause, still ongoing after 24 min), it was over by 18:00 in 32% of cases and by 19:00 in 63%. »

## Méthode

1. **Historique** (`features.py`). On reconstitue la chronologie de chaque incident (version actuelle + audit). Le **début** est la création VIA, la **fin réelle** le premier passage à `ENDED` après la dernière version `INFO`, et la **fin annoncée** vient de `duration_to` (elle correspond au texte dans 97 % des versions). On exclut les travaux planifiés, les incidents jamais terminés et les durées aberrantes. Il reste 496 incidents utilisables : médiane 2 h 47, première annonce trop optimiste dans 68 % des cas.
2. **Situations** (« snapshots »). Chaque version publiée pendant l'incident devient une ligne : ce qu'un voyageur voyait à cet instant (temps écoulé, heure annoncée, cause, interruption ou restriction).
3. **Incidents similaires au même âge** (`estimator.py`). On garde les incidents passés qui duraient **encore** après le même temps écoulé, avec la version publiée à cet âge-là. Poids : même cause 1, même famille de causes 0,35, autre 0,08 ; × 0,6 si le type (interruption ou restriction) diffère.
4. **Prédiction**. Fin prédite = fin annoncée + (fin réelle − fin annoncée) observée sur les incidents similaires. Sans annonce, on utilise la durée restante des incidents similaires (logique de survie). Les quantiles pondérés donnent la fourchette, et la fonction de répartition donne P(fini avant 18h).
5. **Règle CFF**. La fourchette « likely » (25 %–75 %) contient toujours l'heure officielle tant qu'elle n'est pas passée, et ne commence jamais avant « maintenant ».

## Validation sur 2026 (sans regarder le futur)

Chaque version de chaque incident de 2026 est évaluée en n'utilisant que les incidents **déjà terminés** à cet instant, soit 632 situations sur 132 incidents.

| | Score probabiliste (pinball, min) ↓ | Fin réelle avant la médiane | avant le 75e centile | Largeur 10–90 % |
|---|---|---|---|---|
| Annonce CFF seule | 46,5 | 45 % (heure annoncée) | – | – |
| Historique seul | 46,3 | 56 % | 82 % | 9 h 06 |
| **Notre méthode** | **38,8** | **56 %** | **81 %** | **5 h 07** |

- Le score est **17 % meilleur** que l'annonce seule, avec une bonne calibration (voir `calibration-2026.png`).
- Le message honnête pour le jury : nous ne prédisons pas mieux l'heure exacte que les CFF (erreur de la médiane comparable). En revanche, nous disons avec quelle probabilité l'annonce tiendra, et ces probabilités sont justes.
- Tenir compte du temps écoulé améliore la calibration. Sans lui, la fin réelle tombe avant notre médiane dans 63 % des cas au lieu de 56 % (l'idéal est 50 %).

## Endpoints (voir `/docs` du backend)

| Endpoint | Usage |
|---|---|
| `GET /journeys/demo-1/status?minutes_since_start=45` | Statut + estimation à un instant du rejeu. Par défaut, les heures sont décalées pour que cet instant soit « maintenant » (`live=true`) |
| `GET /journeys/demo-1/details` | Écran « plus de détails » : trains rebroussés, bus, recommandations, messages internes (KULT) |
| `GET /incidents/{id}/timeline` | Rejeu : chaque version + l'estimation affichée à ce moment + ce qui a changé |
| `GET /incidents/{id}/risk?departure=18:32&minutes_since_start=60` | Alerte pendulaire : P(encore perturbé au départ de mon train) |
| `GET /incidents/demo` | Incidents intéressants à rejouer (ceux avec détails internes en premier) |

En Python, pour les volets B et C : `estimator.estimate_live(reason_id, start, official_end)` pour un incident en direct, et `estimator.departure_risk(incident_id, departure, at)`.

## Incident de démo

**Incendie Puidoux – Vauderens, 25.09.2026** (ligne Lausanne – Fribourg, IR 15 / IC 1), associé au cas KULT 24666.
Il dure de 16:03 à 18:15. Première annonce à 18:00, repoussée à 18:45 à 17:46. Le personnel a été informé 23 min avant le public.

## Limites

- `ENDED` est un indicateur de la reprise réelle (la saisie peut avoir quelques minutes de retard).
- Les données internes KULT ne couvrent que septembre 2026. Le rapprochement se fait par heure, lieu et cause, avec un score affiché.
- Les fourchettes à 80 % restent larges (environ 5 h) : c'est la réalité des données, et nous la montrons au lieu de la cacher.
