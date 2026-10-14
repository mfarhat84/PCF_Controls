import { Country } from './countries';
import { OutputFormat, Rules } from './validation';
import { parsePath, resolveCountryCode } from './countrySource';

/** Configuration lue une fois dans init() à partir des propriétés du manifest. */
export interface ControlConfig {
  outputFormat: OutputFormat;
  countries: Country[];          // liste affichée (filtrée + ordonnée)
  /** Pays par défaut « statique » (propriété defaultCountry : FR, +33 ou France). */
  staticDefaultCountry: string | null;
  /** Chemin vers le champ pays (ex. parentcustomerid.address1_country), déjà découpé. */
  countryPath: string[] | null;
  rules: Rules;
  blockSaveWhenInvalid: boolean;
  showFlags: boolean;
  callProvider: CallProvider;
  customCallProtocol: string;
  openQuickCreate: boolean;
}

export type CallProvider = 'none' | 'tel' | 'teams' | 'skype' | 'custom';

const splitList = (raw: string | null | undefined, normalize: (s: string) => string): string[] =>
  (raw ?? '')
    .split(/[,;\s]+/)
    .map(normalize)
    .filter((s) => s.length > 0);

export const isoCode = (s: string): string => s.trim().toUpperCase();

/** Accepte les noms libphonenumber-js (FIXED_LINE) et awesome-phonenumber (fixed-line). */
export const typeName = (s: string): string => s.trim().toUpperCase().replace(/[-\s]/g, '_');

export const buildCountryList = (
  all: Country[],
  allowed: string[],
  excluded: string[],
  priority: string[]
): Country[] => {
  let list = all.filter(
    (c) => (allowed.length === 0 || allowed.includes(c.iso2)) && !excluded.includes(c.iso2)
  );
  if (list.length === 0) list = all; // configuration incohérente : on n'affiche pas une liste vide

  if (priority.length > 0) {
    const first = priority
      .map((p) => list.find((c) => c.iso2 === p))
      .filter((c): c is Country => c !== undefined);
    list = [...first, ...list.filter((c) => !priority.includes(c.iso2))];
  }
  return list;
};

export interface RawParams {
  outputFormat?: string | null;
  defaultCountry?: string | null;
  countryPath?: string | null;
  priorityCountries?: string | null;
  allowedCountries?: string | null;
  excludedCountries?: string | null;
  allowedTypes?: string | null;
  excludedTypes?: string | null;
  blockSaveWhenInvalid?: string | null;
  showFlags?: string | null;
  callProvider?: string | null;
  customCallProtocol?: string | null;
  openQuickCreate?: string | null;
}

export const readConfig = (p: RawParams, all: Country[]): ControlConfig => {
  const allowed = splitList(p.allowedCountries, isoCode);
  const excluded = splitList(p.excludedCountries, isoCode);
  const priority = splitList(p.priorityCountries, isoCode);
  const countries = buildCountryList(all, allowed, excluded, priority);


  const fmt = (p.outputFormat ?? 'e164').toLowerCase();
  const outputFormat: OutputFormat = fmt === 'international' || fmt === 'national' ? fmt : 'e164';

  const provider = (p.callProvider ?? 'none').toLowerCase();
  const callProvider: CallProvider =
    provider === 'tel' || provider === 'teams' || provider === 'skype' || provider === 'custom' ? provider : 'none';

  return {
    outputFormat,
    countries,
    staticDefaultCountry: resolveCountryCode(p.defaultCountry),
    countryPath: parsePath(p.countryPath),
    rules: {
      allowedCountries: allowed,
      excludedCountries: excluded,
      allowedTypes: splitList(p.allowedTypes, typeName),
      excludedTypes: splitList(p.excludedTypes, typeName),
    },
    blockSaveWhenInvalid: p.blockSaveWhenInvalid !== 'No',
    showFlags: p.showFlags !== 'No',
    callProvider,
    customCallProtocol: (p.customCallProtocol ?? '').trim().replace(/:+$/, ''),
    openQuickCreate: p.openQuickCreate === 'Yes',
  };
};
