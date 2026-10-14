import { Country, countries as ALL_COUNTRIES } from './countries';

// ─────────────────────────────────────────────────────────────────────────────
// 1) Interpréter une valeur "pays" quelle que soit sa forme :
//    "FR", "fr", "+33", "0033", "33", "France", "france", "Allemagne", "Germany"…
// ─────────────────────────────────────────────────────────────────────────────

/** Indicatifs partagés par plusieurs pays : pays retenu par défaut. */
const PREFERRED_FOR_DIAL: Record<string, string> = {
  '1': 'US', '7': 'RU', '39': 'IT', '44': 'GB', '47': 'NO', '61': 'AU', '212': 'MA', '262': 'RE', '358': 'FI', '590': 'GP',
};

const simplify = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

type DisplayNamesCtor = new (locales: string[], options: { type: 'region' }) => { of: (code: string) => string | undefined };

let nameIndex: Map<string, string> | null = null;

/** Index nom → ISO : noms anglais de la liste + noms localisés (langue du navigateur, français, anglais). */
const getNameIndex = (): Map<string, string> => {
  if (nameIndex) return nameIndex;
  const index = new Map<string, string>();
  const DisplayNames = (Intl as unknown as { DisplayNames?: DisplayNamesCtor }).DisplayNames;
  const languages = Array.from(new Set([navigator.language, 'fr', 'en'].filter((l) => !!l)));
  const translators = DisplayNames
    ? languages.map((l) => { try { return new DisplayNames([l], { type: 'region' }); } catch { return null; } })
    : [];

  for (const c of ALL_COUNTRIES) {
    index.set(simplify(c.name), c.iso2);
    for (const t of translators) {
      const localized = t?.of(c.iso2);
      if (localized) index.set(simplify(localized), c.iso2);
    }
  }
  nameIndex = index;
  return index;
};

/** Retourne le code ISO alpha-2 correspondant à la valeur, ou null si rien ne correspond. */
export const resolveCountryCode = (input: unknown): string | null => {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (/^(\+|00)?\d{1,4}$/.test(s)) {                       // indicatif : +33, 0033, 33
    const dial = s.replace(/^(\+|00)/, '');
    const matches = ALL_COUNTRIES.filter((c) => c.dialCode === '+' + dial);
    if (matches.length === 0) return null;
    return (matches.find((c) => c.iso2 === PREFERRED_FOR_DIAL[dial]) ?? matches[0]).iso2;
  }
  if (/^[a-z]{2}$/i.test(s)) {                             // ISO : FR
    const iso = s.toUpperCase();
    return ALL_COUNTRIES.some((c) => c.iso2 === iso) ? iso : null;
  }
  return getNameIndex().get(simplify(s)) ?? null;          // nom : France, Allemagne…
};

/** Premier candidat présent dans la liste affichée, sinon le premier pays de la liste. */
export const pickDefaultCountry = (list: Country[], candidates: (string | null)[]): Country => {
  for (const iso of candidates) {
    const found = iso ? list.find((c) => c.iso2 === iso) : undefined;
    if (found) return found;
  }
  return list[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) Lire un champ en suivant des recherches (lookups) via la Web API.
//    Chemin = noms logiques séparés par des points :
//      "address1_country"                         champ de l'enregistrement de départ
//      "parentcustomerid.address1_country"        champ du compte parent
//      "parentcustomerid.mf_paysid.mf_codeiso"    deux niveaux de recherche
//    Le type de chaque table est détecté automatiquement (annotation lookuplogicalname),
//    donc les recherches Client (compte OU contact) fonctionnent.
// ─────────────────────────────────────────────────────────────────────────────

const LOOKUP_TYPE = '@Microsoft.Dynamics.CRM.lookuplogicalname';
const FORMATTED = '@OData.Community.Display.V1.FormattedValue';

const cleanId = (id: string): string => id.replace(/[{}]/g, '').toLowerCase();

const isSafeName = (s: string): boolean => /^[a-z_][a-z0-9_]*$/.test(s);

export const parsePath = (path: string | null | undefined): string[] | null => {
  const segments = (path ?? '').split('.').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  return segments.length > 0 && segments.every(isSafeName) ? segments : null;
};

/** Nom affiché d'une colonne de recherche. */
const readLookupName = (
  webAPI: ComponentFramework.WebApi,
  entity: string,
  id: string,
  field: string
): Promise<unknown> =>
  webAPI
    .retrieveRecord(entity, id, `?$select=_${field}_value`)
    .then((rec) => rec[`_${field}_value${FORMATTED}`] ?? null);

const readFinalField = (
  webAPI: ComponentFramework.WebApi,
  entity: string,
  id: string,
  field: string
): Promise<unknown> =>
  webAPI
    .retrieveRecord(entity, id, `?$select=${field}`)
    .then((rec) => rec[field + FORMATTED] ?? rec[field] ?? null)
    // Le champ final est peut-être lui-même une recherche → on lit son nom affiché.
    .catch(() => readLookupName(webAPI, entity, id, field));

export const readPath = (
  webAPI: ComponentFramework.WebApi,
  entity: string,
  id: string,
  segments: string[]
): Promise<unknown> => {
  const [head, ...rest] = segments;
  if (rest.length === 0) return readFinalField(webAPI, entity, cleanId(id), head);

  const key = `_${head}_value`;
  return webAPI.retrieveRecord(entity, cleanId(id), `?$select=${key}`).then((rec) => {
    const nextId = rec[key];
    const nextEntity = rec[key + LOOKUP_TYPE];
    if (typeof nextId !== 'string' || typeof nextEntity !== 'string') return null; // recherche vide
    return readPath(webAPI, nextEntity, nextId, rest);
  });
};
