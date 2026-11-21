# Analyse des données du challenge CFF « Disruption → best next move »

Analyse descriptive des trois sources fournies (aucune proposition de solution). Chiffres calculés sur les fichiers tels quels.

---

## 0. Vue d'ensemble

| Source | Qui la voit ? | Période | Volume | Langues |
|---|---|---|---|---|
| **1. Liveticker externe (public)** | **Voyageurs** (app/web CFF, grosses perturbations uniquement) | mars 2024 → oct. 2026 | 523 incidents, 3 234 messages, + ~9 500 versions historiques | DE / FR / IT / EN (1 original + 3 traductions machine) |
| **2. Liveticker interne KULT** | **Personnel CFF** (accompagnants de train, personnel en gare, TCC) | septembre 2026 | 137 cas, 882 messages, 4 372 lignes de log | Une seule langue par message (DE majoritaire, puis FR, IT) |
| **3. Ereignismeldungen VIA (xlsx)** | **Voyageurs indirectement** (info perturbation affichée dans l'horaire) – mais ici sous forme de log technique interne | septembre 2026 | 2 710 lignes = 168 événements VIA | Codes + abréviations, pas de texte libre |

**Clés de liaison entre sources**

```
VIA (xlsx).alea_fall_id  ==  externe.incident.id   (ex. 2195005174318, 13 chiffres)
VIA.ereignisgrund (EG_xxx) == externe.reason.id == interne.Ereigniskategorie.name
VIA.stoerungs_ort* (8 5xxxxx) -> code "NUMBER" du référentiel open data CFF des points d'exploitation (didok)
KULT  <->  VIA / externe : AUCUN identifiant commun -> rapprochement seulement par date/heure + lieu + cause
```

- Les 168 événements VIA de septembre 2026 ne deviennent **pas tous** des incidents du liveticker public : seulement **13** se retrouvent dans `incident` (14 dans `incident_audit`). Le liveticker public est réservé aux perturbations majeures.
- Pour KULT : en rapprochant par cause identique et création à ±3 h, 88 des 137 cas KULT ont un événement VIA candidat. C'est une heuristique, pas une jointure garantie.

---

## 1. Liveticker externe (public) – `Daten/extern-liveticker/`

Export PostgreSQL du 12.10.2026. C'est ce que **le voyageur voit** pour les perturbations importantes.

### 1.1 Modèle

```
reason (93) 1 ──< incident (523) 1 ──< message (3 234)
                    │                     │
            incident_audit (4 782)   message_audit (4 722)   ← anciennes versions (trigger)
```

### 1.2 `incident` – une perturbation (état actuel / final)

| Colonne | Signification | Observations |
|---|---|---|
| `id` | ID de l'événement VIA (13 chiffres) | Clé vers VIA xlsx (`alea_fall_id`) |
| `lifecycle` | État VIA : `INFO` (en cours), `ENDED` (terminée), `DELETED` (retirée) | État final : 501 `DELETED`, 22 `ENDED`, 0 `INFO` → l'export ne contient que des perturbations closes |
| `duration_type` | Comment lire la fin prévue | `UNTIL` 253, `UNTIL_AT_LEAST` 148, `UNTIL_APPROX_DATE_TIME` 58, `UNTIL_DATE` 26, `UNTIL_AT_LEAST_DATE_TIME` 22, `UNKNOWN` 9, `FROM_TO` 4, `NONE` 3 |
| `duration_from` | Début (FROM_TO) | Vide dans 519/523 |
| `duration_to` | Fin prévue (date+heure) | Rempli dans 511/523 ; **change souvent au fil des versions** (= prolongation des pronostics) |
| `duration_at_least` | Heure « au moins jusqu'à » | Rempli seulement pour les types `*_AT_LEAST*` ; attention : dans les exemples vérifiés, il est décalé de 2 h par rapport à `duration_to` et au texte (ex. `05:00` alors que la description dit « au moins jusqu'à 07:00 ») → se fier plutôt à `duration_to` |
| `reason_id_fk` | Cause standard `EG_xxx` | 30 causes utilisées sur 93. Top : EG_010 dérangement installations (94), EG_047 accident de personne (71), EG_070 cause externe (70), EG_008 ligne de contact (54), EG_006 dégât voie (53), EG_014 train bloque la ligne (51) |
| `origin_language` | Langue originale | FR 375, DE 134, IT 14 |
| `summary_{de,fr,it,en}` | Titre court | Forme standardisée : `Interruption A - B`, `Restriction A - B`, puis `Trafic rétabli: A - B` en fin. ~37 caractères |
| `description_{de,fr,it,en}` | Texte généré (template VIA) | ~145 caractères, phrases-gabarits : tronçon, cause, durée, lignes concernées, « retards et suppressions à prévoir » |
| `created_at_source` / `updated_at_source` | Horodatage VIA (création / dernière mise à jour) | Durée médiane création→dernière MAJ VIA : **2,8 h** (max 57 h) |
| `created_date` / `last_modified_date` | Écriture dans la base liveticker | Réception ~10 min après création VIA (médiane) |
| `version` | Numéro de version VIA | Croissant mais **non unique** par incident ; médiane 328 |
| `author_id_fk` | Employé (table non fournie) | 77 auteurs distincts |

**Volume dans le temps** : 9 à 27 incidents/mois, stable de mars 2024 à sept. 2026 (oct. 2026 partiel). Pics horaires de création entre 7 h et 19 h, creux la nuit.

### 1.3 `incident_audit` – l'historique d'un incident

- Une ligne = **ancienne version** copiée par un trigger avant chaque UPDATE/DELETE. Historique complet = lignes audit + ligne actuelle.
- Ordre : par `last_modified_date` (clé unique `(id, last_modified_date)`, vérifiée sans doublon).
- **8,7 versions en moyenne par incident** (max 27).
- 27 IDs n'existent plus dans `incident` (supprimés par le job nocturne, historique conservé).
- Ce qui change entre versions (nombre de changements cumulés) : `description_*` 2 391, `duration_to` 851, `summary_*` 821, `lifecycle` 1 111, `duration_type` 71, `reason_id_fk` 21 (la cause peut être corrigée en cours de route).
- Préfixes des titres dans l'historique (FR) : `Interruption` 2 422, `Trafic rétabli` 1 565, `Restriction` 795 → on voit des bascules restriction ↔ interruption.
- Séquences typiques de `lifecycle` : `INFO > ENDED > DELETED` (457 incidents) ; quelques allers-retours (`ENDED > DELETED > ENDED…`, réouvertures `… > INFO`).

**Exemple (Etoy – Allaman, accident de personne, 10.03.2024)** : Restriction fin « au moins 07:00 » → fin repoussée à 08:00 → passage en Interruption → retour en Restriction → fin 08:45 → `ENDED` « Trafic rétabli » → `DELETED` le soir.

### 1.4 `message` – mises à jour rédigées par le TCC

| Colonne | Signification | Observations |
|---|---|---|
| `id` | UUID | |
| `incident_id_fk` | Incident parent | 504 incidents ont ≥1 message ; 19 n'en ont aucun. Médiane 5 messages/incident (max 30) |
| `status` | `PUBLISHED` (3 107) ou `HIDDEN` (127, retiré) | Autres statuts (DRAFT, REJECTED…) absents de l'export |
| `title_{de,fr,it,en}` | Titre libre | Très hétérogène : « Ersatzbusse », « Bahnersatzbusse », « Ende der Störung », « Reiseempfehlung », « Prognose », « Gute Nachrichten »… 453 titres contiennent des **emoji** (🚌, 🔴…) |
| `message_{de,fr,it,en}` | Texte libre | Médiane 155 caractères (max 1 076) ; 1 292 avec sauts de ligne, 81 avec emoji, 3 avec URL, pas de HTML |
| `{lang}_translated` | `false` = langue originale, `true` = traduction machine | Original DE 2 013, FR 1 120, IT ~40 ; quelques lignes avec plusieurs `false` ou EN non traduit (incohérences) |
| `created_date` / `last_modified_date` | Création / dernière modif. | Premier message en moyenne **~39 min** (médiane) après création VIA de l'incident |
| `author_id_fk` | Employé | 91 auteurs |

Contenu typique : bus de remplacement (horaires, arrêts), pronostic de reprise, recommandations d'itinéraire, fin de perturbation.

### 1.5 `message_audit`

- 4 722 anciennes versions ; **chaque message a ≥1 ligne d'audit** (souvent une copie quasi immédiate à la création : écart médian 0 s).
- 339 messages ont un texte réellement modifié ; 157 changements de statut (publication → masqué).

### 1.6 `reason` – table de causes (93 codes `EG_xxx`)

Libellés en DE/FR/IT/EN. Exemples : EG_047 Accident de personne, EG_010 Dérangement aux installations ferroviaires, EG_158 Travaux exceptionnels, EG_126–187 grèves par pays, EG_166–176 événements par pays, EG_140 « Aucune cause » (fallback), EG_056/EG_156 « inconnu ». **Même codification** dans le xlsx VIA et (partiellement) dans KULT.

### 1.7 Qualité / pièges

- CSV avec sauts de ligne et emoji dans les textes → utiliser un vrai parseur CSV.
- Fuseaux horaires mixtes `+0100` / `+0200` (heure d'hiver/été) → convertir en UTC ou Europe/Zurich.
- Traductions EN de qualité variable (ex. EG_010 « Signal box failure », EG_014 « Technical difficulty with the engine »).
- Colonnes absentes de l'export : `incident.status` (workflow interne NEW/OPEN/…), `source`, `has_been_opened`, `media`, `verifier`…; tables `employee`, `media`, `link`, `rating` non fournies.

---

## 2. Liveticker interne KULT – `Daten/intern-liveticker/`

Outil interne du TCC pour informer le **personnel** (accompagnants, personnel en gare, « KUBE » = renforts clients). Septembre 2026 uniquement. Fichiers « ohne Zeilenschaltungen » = sauts de ligne supprimés ; encodage UTF-8 avec BOM.

### 2.1 Modèle

```
Ereigniskategorie (22) 1 ──< Ereignisfall (137) 1 ──< LivetickerMessage (882)
                                       └──< Logs (4 372)  (Ereignisfall, InfoboardModule, LivetickerMessage, Kubealarm, Kubeeinsatz)
```

### 2.2 `1__Ereignisfaelle` – un cas (perturbation) – 137 lignes

| Colonne | Signification | Observations |
|---|---|---|
| `id` | ID interne KULT (24416–24701) | **Pas** l'ID VIA |
| `created_at` | Création du cas | 01.09 → 30.09.2026 ; pics 5 h, 14 h–17 h ; mardi/vendredi les plus chargés |
| `datum` | Date/heure de l'événement | En général quelques minutes autour de `created_at` |
| `active` / `archived` | État | Tous `active=False`, `archived=True` (mois clôturé) |
| `zug_nr_strecke` | Lieu ou tronçon, texte libre | « Bern - Olten », « Ostermundigen », « Küssnacht am Rigi - » (incomplet), parfois numéro de train |
| `beschreibung` | Description libre | Vide dans 119/137 cas ; sinon court (« Weichenstörung », « Stellwerkstörung ») ou copie du texte VIA |
| `ereigniskategorie_id` | Catégorie | Top : train bloque la ligne (25), dérangement installations (25), dégât voie (16), **avis de disparition** (14), accident de personne (13), travaux exceptionnels (8) |

### 2.3 `2__Ereigniskategorien` – 22 catégories

`name` = code ; la plupart sont les codes **EG_xxx** du liveticker public (FR/DE/IT), plus 2 codes propres : `EK_IT_STOERUNG` (panne IT) et `EK_VERMISSTMELDUNG` (avis de disparition, catégorie interne sans équivalent public).

### 2.4 `3_liveticker_messages` – fil de messages interne – 882 lignes

| Colonne | Signification | Observations |
|---|---|---|
| `id`, `ereignisfall_id` | Clés (exportées en float `361720.0`) | 99 cas ont des messages, 38 n'en ont aucun ; médiane 8 messages/cas (max 34). 1 ligne vide |
| `timestamp` | Heure du message, **à la minute** | 01.09 04:19 → 30.09 07:18 |
| `sender` | Émetteur | `TCC` 854, `uxxx` 19 (utilisateur anonymisé : tests, remarques « Schreibfehler… »), `KOO Bhf` 8 (coordinateur de gare), `a` 1 |
| `message` | Texte en **HTML** (balises `<br>`, `<strong>`, couleurs) | 427 contiennent du HTML ; 11 vides ; médiane 76 caractères (max ~1 800) |
| `name`, `vorname`, `telefonnummer` | Données personnelles | **Toujours vides** (anonymisées) |

Style : très opérationnel, abrégé, horodaté, avec numéros de train. Exemple de déroulé (accident de personne Ostermundigen, 01.09.2026) :
« Totalunterbruch » → « Konzept in Bearbeitung » → « Konzept aktiv ab 05:00 » → bus en place à Gümligen → arrêts des bus de remplacement → trains déviés/rebroussant (« 960 wendet in Thun ») → « Prognose 08.15 » → reprise sur une voie → liste des premiers trains → « Bahnersatz wird beendet » → « Liveticker wird beendet ».

Délai création cas → premier message interne : **médiane ~3 min** (contre ~39 min pour le premier message public).

### 2.5 `4__Logs` – journal d'audit – 4 372 lignes (01.09 → 21.10.2026)

| Colonne | Signification |
|---|---|
| `id`, `ereignisfall_id` | Clés |
| `Spalte1`, `Spalte2` | Colonnes vides (artefact d'export) |
| `created_at` | Horodatage précis (ms) |
| `user_name` | Utilisateur anonymisé (`u238251`…), 82 utilisateurs |
| `action` | `UPDATE` 2 050, `CREATE` 1 103, `SEND` 903, `ARCHIVE` 125, `DEACTIVATE` 93, `ACTIVATE` 84, `DELETE` 12, `REACTIVATE` 2 |
| `entity` | Type d'objet modifié (voir ci-dessous) |
| `data` | **Dump texte de l'objet** façon Java `toString()` (`Classe{champ=valeur, …}`) → à parser par regex |

Entités dans `data` :

- **`Ereignisfall`** (534) : `datum`, `zugNrStrecke`, `beschreibung`, `ereigniskategorie`, **`concept`** = concept d'exploitation activé (ex. `BERN - THUN`, `HEITERSBERG`, `COLGEN`, `AESP - WANZ - RTR Total`, `LBT - Total`).
- **`InfoboardModule`** (2 812) : le « tableau d'info » structuré par cas, avec des modules typés (`titel`) :
  - `STOERUNGSBESCHRIEB` (description de la perturbation) ; souvent le champ `textVia` contient le **texte VIA public** en DE/FR/IT,
  - `BETRIEBSKONZEPT_FERN` / `_REGIONAL` (trains grandes lignes / régionaux supprimés, détournés : « IR 90 supprimés entre Renens VD et Genève-Aéroport »),
  - `MASSNAHMEN` (mesures par numéro de train : « 557: Ausfall Zürich HB - Chur »),
  - `ERSATZVERKEHR` (bus de remplacement, cadence, arrêts précis),
  - `REISEEMPFEHLUNG` (recommandation de voyage : « Reisende von Zug Richtung Zürich HB reisen via Thalwil »),
  - `KULANZMASNAHMEN` (geste commercial / validité des billets via un autre itinéraire, droits des passagers),
  - modules libres (« Massnahmen IC5/51 », « Luzern »…).
  Champs : `linie` (IR90, IC1…), `betriebspunkt` (abréviations : LZ, GD…), `active`, `index`. Un module est mis à jour en moyenne ~3 fois (max 52). **62 textes contiennent encore des placeholders `XXX`/`xxh00`** (gabarits non remplis).
- **`LivetickerMessage`** (949) : `SEND` = envoi, `DEACTIVATE` (68) = message retiré ; contient `betriebspunkt` (gares concernées, ex. `[BON,MTM]`) absent du CSV 3.
- **`Kubeeinsatz`** (31) / **`Kubealarm`** (46) : mobilisation de personnel d'assistance client (KUBE) : région, catégories de personnel, message d'appel (« KUBE gesucht in Bern und Thun… »), statut `RUNNING`/`SUCCESS`. 23 cas sur 137 ont une mobilisation.

Durée création → archivage d'un cas : médiane **2,6 h** (max 49 h). 14 cas sans log.

---

## 3. Ereignismeldungen VIA – `Daten/Ereignismeldungen/Ereignismeldungen Via.xlsx`

Log de publication des événements dans **VIA** (système qui produit l'info perturbation affichée dans l'horaire/app). Septembre 2026. Deux feuilles : les données (2 710 lignes × 21 colonnes) et `Schema` (description DE/EN des colonnes).

Chaque ligne = une **(re)publication** d'un événement (`log_info` toujours « Ereignis wurde aktualisiert und publiziert »). 168 événements distincts, médiane 10 publications/événement (max 186).

| Colonne | Signification | Observations |
|---|---|---|
| `id` | ID de la ligne de log | |
| `modified`, `logging_date_time` | Enregistrement / heure du log | Quasi identiques (~10 ms d'écart) |
| `alea_fall_id` | ID du système amont (ALEA) = **ID VIA = `incident.id` du liveticker public** | 13 en commun avec le public |
| `alea_erstellungszeitpunkt` | Création dans ALEA | 01.09 01:14 → 30.09 17:55 |
| `alea_ort_strecke` | Lieu/tronçon en **abréviations** de points d'exploitation | `MOR-STP` (Morges–St-Prex), `STET`, `LP`, `COSG-CHI`… |
| `alea_ereignisgrund` | Cause en texte, nomenclature **opérationnelle** ALEA | Stellwerkstörung 588, Bauarbeiten 441, Personenunfall 404, Unregelmässigkeit Fahrbahn 333… (22 valeurs) |
| `alea_zeitpunkt_eroeffnung_zugliste` | Calcul de la liste des trains touchés | Médiane 9 min après création |
| `zeitpunkt_inbearbeitungnahme` | Prise en charge dans VIA | Peut changer dans un même événement (57 événements) |
| `zeitpunkt_erstpublikation` | **Première publication voyageurs** | Médiane **15 min** après création (max 5,5 h) |
| `zeitpunkt_globale_endmeldung` | Clôture | Remplie pour 131/168 ; médiane 52 min après la 1re publication |
| `ereignisgrund` | Cause **codée EG_xxx** (même table que `reason`) | Mapping ALEA→EG pas 1:1 : « Verspätung ab Vorbahn » → EG_167/168 (événement France/Italie), EG_026, EG_047…; « Bauarbeiten » → EG_158 ou EG_004 |
| `stoerungs_ort1` / `stoerungs_ort2` | Début / fin de l'interruption (code numérique 85xxxxx) | `ort2` vide (307) = un seul point touché. À résoudre via le dataset open data CFF « Dienststellen » (colonne NUMBER) ; préfixes 85 (CH), 87 (FR), 83 (IT), 80 (DE) |
| `stoerungs_linie_von` / `_bis` | Extrémités de la ligne concernée (souvent au-delà de l'interruption) | Vides dans 813 lignes |
| `stoerungs_liniennummer` | Lignes touchées, liste | « IR15, IR57, IR90, R8, R9 », « TER », « S30 »… ; vide 221 ; évolue dans 29 événements |
| `zeitpunkt_weitere_informationen_geaendert` | Dernière modification du texte d'info | |
| `zeitpunkt_erstpublikation_reiseempfehlung` | 1re **recommandation de voyage** publiée | Seulement 36/168 événements ; médiane 9 min après 1re publication |
| `zeitpunkt_erstpublikation_bahnersatz` | 1re publication de **bus de remplacement** | 31/168 ; médiane 41 min après 1re publication |

**Pas de texte** dans ce fichier : uniquement des métadonnées, codes, lieux et horodatages du cycle de publication.

---

## 4. Public vs interne – ce qui diffère concrètement

| Aspect | Public (liveticker externe + info horaire VIA) | Interne (KULT) |
|---|---|---|
| Couverture | Toutes perturbations VIA (168 en sept.) dans l'horaire ; liveticker seulement pour les majeures (13 en sept.) | 137 cas en sept., y compris catégories internes (avis de disparition) |
| Délai | 1re publication VIA ~15 min ; 1er message liveticker ~39 min | 1er message interne ~3 min |
| Ton / forme | Gabarits standardisés + messages rédigés, 4 langues, emoji | Opérationnel, HTML, abréviations, numéros de train, 1 langue |
| Détail | Tronçon, cause, durée estimée, lignes, bus de remplacement, pronostic | Concept d'exploitation, trains supprimés/rebroussés un par un, arrêts précis des bus, gestes commerciaux, mobilisation de personnel |
| Lieux | Noms de gares (texte) ; codes numériques didok dans VIA | Texte libre + abréviations de points d'exploitation |
| Évolution | Versions complètes (audit) avec horodatage | Fil chronologique + logs de chaque modification de module |

## 5. Horodatages utiles pour reconstruire « ce qu'on savait à l'instant t »

- Public : `incident_audit.last_modified_date` / `updated_at_source` (versions), `message.created_date` / `message_audit.last_modified_date`.
- VIA : `alea_erstellungszeitpunkt`, `zeitpunkt_erstpublikation`, `…_reiseempfehlung`, `…_bahnersatz`, `zeitpunkt_globale_endmeldung`, `modified` (chaque republication).
- KULT : `liveticker_messages.timestamp` (minute), `Logs.created_at` (ms).
- Attention : public avec offset (`+0100/+0200`) ; KULT et xlsx **sans fuseau** (heure locale suisse a priori).

## 6. Recouvrement temporel des 3 sources

Seul **septembre 2026** est couvert par les trois sources. Les 13 incidents publics de septembre 2026 (ex. Ardon – Sion 12.09, Zürich Stadelhofen – Stettbach 25.09, Puidoux – Vauderens 25.09, Renens – Morges 17.09) se retrouvent par ID dans le xlsx VIA, et peuvent être cherchés dans KULT par date + lieu.
