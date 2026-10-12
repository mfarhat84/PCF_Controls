# OS.MobileControl v2 — fusion OS.Mobile × CheckPhoneNumberControl

Contrôle PCF de saisie de téléphone pour Dataverse / Power Apps.
**Interface d'OS.Mobile** (sélecteur de pays avec drapeaux et recherche) + **logique et configuration de CheckPhoneNumberControl** (règles pays/types, format enregistré, champ « numéro valide », click-to-call), sur `libphonenumber-js` (métadonnées *max*).

## Configuration

| Propriété | Rôle | Défaut |
|---|---|---|
| `phoneValue` | Colonne Téléphone **ou Texte** liée | — (requis) |
| `numberValid` | Colonne Oui/Non mise à jour à chaque saisie (vide = valide) | — |
| `outputFormat` | Format enregistré : `e164` (+33612345678), `international` (+33 6 12 34 56 78), `national` (06 12 34 56 78) | `e164` |
| `defaultCountry` | Pays ISO présélectionné et utilisé pour lire les numéros nationaux | 1er pays de la liste |
| `priorityCountries` | Pays affichés en tête (ISO, séparés par des virgules) | `AE,SA,KW,BH,QA,OM,JO,EG,LB,IQ` (= ordre de la v1) |
| `allowedCountries` / `excludedCountries` | Pays acceptés / refusés — **filtrent aussi la liste** | vide = tous |
| `allowedTypes` / `excludedTypes` | `mobile`, `fixed_line`, `toll_free`, `premium_rate`, `shared_cost`, `voip`, `personal_number`, `pager`, `uan`, `voicemail` (les noms awesome-phonenumber `fixed-line`… sont acceptés) | vide = tous |
| `blockSaveWhenInvalid` | Notification sur le champ qui bloque l'enregistrement | `Yes` |
| `showFlags` | Drapeaux flagcdn.com ; `No` (ou image bloquée) → badge ISO | `Yes` |
| `callProvider` | Bouton d'appel : `none`, `tel`, `teams`, `skype`, `custom` | `none` |
| `customCallProtocol` | Protocole si `custom` (ex. `sip`, `callto`) | — |
| `openQuickCreate` | Ouvre aussi la création rapide « Appel téléphonique » (pré-remplie) | `No` |

> `fixed_line_or_mobile` (US, CA…) est accepté si `mobile` **ou** `fixed_line` est autorisé, et exclu seulement si les deux sont exclus.

## Ce que la fusion corrige

- **Préfixe 0 conservé quand il fait partie du numéro** (fixes italiens `06…`) — la v1 supprimait tous les 0 initiaux.
- **Sous-régions NANP** (+1268…) relues correctement (la v1 doublait l'indicatif régional au rechargement).
- **Valeur historique non reconnue** : affichée telle quelle au lieu d'être vidée.
- **Collage `+33 6…` / `0033…`** : pays détecté automatiquement.
- **Champ en lecture seule** : jamais de blocage d'enregistrement ; droits d'accès au champ (masquage) respectés.
- **Click-to-call** : bug `None` vs `none` de CheckPhone corrigé, lien Teams valide.
- **Type de numéro** : bug de priorité d'opérateurs de CheckPhone corrigé.
- Vatican : +39 (au lieu de +379).
- Écriture de la valeur au *blur* (et non plus à chaque frappe) ; validation en direct après la première sortie du champ.
- Textes EN/FR via resx ; navigation clavier dans la liste (↑ ↓ Entrée Échap) ; panneau qui s'ouvre vers le haut si manque de place.

## Mise à jour depuis la v1

Namespace et constructeur inchangés (`OS.MobileControl`) → mise à jour en place, version 2.0.0.
À vérifier sur un environnement de dev : la propriété `phoneValue` passe d'un type fixe (`SingleLine.Phone`) à un **type-group** (Téléphone + Texte). Si l'import refuse la mise à jour, revenir à `of-type="SingleLine.Phone"`.

## Build

```bash
npm install
npm run build        # ou npm start pour le harnais de test
```

> `setNotification` n'est pas une API PCF documentée : elle est appelée seulement si elle existe. La voie officielle pour bloquer l'enregistrement reste la colonne `numberValid` (règle métier ou script OnSave).
