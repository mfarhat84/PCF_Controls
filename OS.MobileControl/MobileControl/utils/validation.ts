// Métadonnées "max" : nécessaires pour getType() (mobile / fixe / VoIP…) et une validation complète.
import {
  AsYouType,
  CountryCode,
  NumberType,
  PhoneNumber,
  getExampleNumber,
  isSupportedCountry,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
} from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/examples.mobile.json';
import { Country } from './countries';

export type OutputFormat = 'e164' | 'international' | 'national';
export type ErrorCode = 'tooShort' | 'tooLong' | 'invalid' | 'countryNotAllowed' | 'typeNotAllowed';

export interface Rules {
  allowedCountries: string[];   // ISO alpha-2, majuscules
  excludedCountries: string[];
  allowedTypes: string[];       // NumberType libphonenumber-js : MOBILE, FIXED_LINE…
  excludedTypes: string[];
}

export interface Analysis {
  isValid: boolean;
  error: ErrorCode | null;
  /** Numéro reconnu (présent si le numéro est valide, même s'il est refusé par une règle). */
  phone?: PhoneNumber;
  /** Valeur à enregistrer si le numéro est invalide (on ne perd jamais la saisie). */
  fallbackValue: string;
}

const asCountry = (iso2: string): CountryCode => iso2 as CountryCode;
const digitsOf = (text: string): string => text.replace(/\D/g, '');

/** "+33…" ou "0033…" → saisie internationale, le pays est déduit du numéro. */
export const isInternationalInput = (text: string): boolean => /^\s*(\+|00)/.test(text);

const matchesType = (type: NumberType | undefined, list: string[], lenient: boolean): boolean => {
  if (!type) return false;
  if (list.includes(type)) return true;
  // Certains pays (US, CA…) ne distinguent pas mobile et fixe : FIXED_LINE_OR_MOBILE.
  if (type === 'FIXED_LINE_OR_MOBILE') {
    return lenient
      ? list.includes('MOBILE') || list.includes('FIXED_LINE')
      : list.includes('MOBILE') && list.includes('FIXED_LINE');
  }
  return false;
};

const isTypeAllowed = (type: NumberType | undefined, rules: Rules): boolean => {
  if (rules.allowedTypes.length > 0 && !matchesType(type, rules.allowedTypes, true)) return false;
  if (rules.excludedTypes.length > 0 && matchesType(type, rules.excludedTypes, false)) return false;
  return true;
};

const isCountryAllowed = (region: string | undefined, rules: Rules): boolean => {
  const r = region ?? '';
  if (rules.allowedCountries.length > 0 && !rules.allowedCountries.includes(r)) return false;
  if (rules.excludedCountries.includes(r)) return false;
  return true;
};

/**
 * Analyse complète d'une saisie. Retourne null si la saisie est vide.
 *
 * Saisie nationale : on essaie
 *   1) le format national du pays sélectionné (gère le préfixe 0 : FR 06…, IT 06… conservé) ;
 *   2) indicatif affiché + chiffres sans 0 initial (comportement OS.Mobile v1, utile pour +1268…).
 * Saisie internationale (+ / 00) : le pays est déduit du numéro.
 */
export const analysePhone = (text: string, country: Country, rules: Rules): Analysis | null => {
  const digits = digitsOf(text);
  if (!digits) return null;

  const international = isInternationalInput(text);
  const tries: { input: string; region?: CountryCode }[] = international
    ? [{ input: '+' + (text.trim().startsWith('00') ? digits.slice(2) : digits) }]
    : [
        { input: digits, region: asCountry(country.iso2) },
        { input: country.dialCode + digits.replace(/^0+/, '') },
      ];

  const fallbackValue = tries[tries.length - 1].input;

  let phone: PhoneNumber | undefined;
  for (const t of tries) {
    const parsed = parsePhoneNumberFromString(t.input, t.region);
    if (parsed?.isValid()) {
      phone = parsed;
      break;
    }
  }

  if (!phone) {
    const length = international
      ? validatePhoneNumberLength(tries[0].input)
      : validatePhoneNumberLength(digits, asCountry(country.iso2));
    const error: ErrorCode = length === 'TOO_SHORT' ? 'tooShort' : length === 'TOO_LONG' ? 'tooLong' : 'invalid';
    return { isValid: false, error, fallbackValue };
  }

  if (!isCountryAllowed(phone.country, rules)) {
    return { isValid: false, error: 'countryNotAllowed', phone, fallbackValue: phone.number };
  }
  if (!isTypeAllowed(phone.getType(), rules)) {
    return { isValid: false, error: 'typeNotAllowed', phone, fallbackValue: phone.number };
  }
  return { isValid: true, error: null, phone, fallbackValue: phone.number };
};

/** Valeur écrite dans la colonne pour un numéro valide. */
export const formatForStorage = (phone: PhoneNumber, format: OutputFormat): string => {
  switch (format) {
    case 'international': return phone.formatInternational();
    case 'national':      return phone.formatNational();
    default:              return phone.number;
  }
};

/** Pays de la liste correspondant au numéro (ISO d'abord, puis indicatif). */
export const findCountry = (list: Country[], phone: PhoneNumber): Country | undefined =>
  list.find((c) => c.iso2 === phone.country) ??
  list.find((c) => c.dialCode === '+' + phone.countryCallingCode);

/**
 * Partie affichée à droite du sélecteur de pays : numéro national mis en forme, sans indicatif.
 * Pour les sous-régions NANP (+1268…), l'indicatif régional déjà affiché est retiré.
 */
export const formatLocal = (phone: PhoneNumber, country: Country): string => {
  const national = String(phone.nationalNumber);
  const extra = country.dialCode.replace(/\D/g, '').slice(String(phone.countryCallingCode).length);
  if (extra && national.startsWith(extra)) return national.slice(extra.length);
  try {
    return phone.country ? new AsYouType(phone.country).input(national) : national;
  } catch {
    return national;
  }
};

/** Relit une valeur déjà enregistrée (E.164, international, ou national si format "national"). */
export const parseStoredValue = (
  value: string,
  list: Country[],
  fallback: Country
): { country: Country; text: string } => {
  if (!value.trim()) return { country: fallback, text: '' };

  const phone =
    parsePhoneNumberFromString(value) ?? parsePhoneNumberFromString(value, asCountry(fallback.iso2));
  if (phone) {
    const country = findCountry(list, phone);
    if (country) return { country, text: formatLocal(phone, country) };
    // Pays absent de la liste (exclu / non autorisé) : on garde le format international lisible.
    return { country: fallback, text: phone.formatInternational() };
  }
  // Valeur non reconnue (données historiques) : affichée telle quelle, jamais effacée.
  return { country: fallback, text: value };
};

export const placeholderFor = (country: Country): string => {
  try {
    if (!isSupportedCountry(country.iso2)) return '';
    const example = getExampleNumber(asCountry(country.iso2), examples as never);
    return example ? formatLocal(example, country) : '';
  } catch {
    return '';
  }
};
