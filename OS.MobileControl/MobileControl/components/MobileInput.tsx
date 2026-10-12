import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Country } from '../utils/countries';
import { ControlConfig } from '../utils/config';
import {
  Analysis,
  ErrorCode,
  analysePhone,
  findCountry,
  formatForStorage,
  formatLocal,
  parseStoredValue,
  placeholderFor,
} from '../utils/validation';
import './MobileInput.css';

// ── Types publics ─────────────────────────────────────────────────────────────
export interface MobileInputStrings {
  search: string;
  noResults: string;
  call: string;
  valid: string;
  /** Err_Invalid contient {0} = nom du pays. */
  errors: Record<ErrorCode, string>;
}

export interface PhoneResult {
  value: string;             // valeur à écrire dans la colonne
  isValid: boolean;          // vide = valide (le "requis" est géré par la plateforme)
  errorMessage: string | null;
}

export interface MobileInputProps {
  value: string;
  disabled: boolean;
  masked: boolean;
  config: ControlConfig;
  strings: MobileInputStrings;
  /** persist = true → la valeur doit être écrite (blur, changement de pays). false → validité seulement. */
  onResult: (result: PhoneResult, persist: boolean) => void;
  onCall: (e164: string) => void;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────
function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    if (id) clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => { if (id) clearTimeout(id); };
  return debounced;
}

const sanitize = (text: string): string => text.replace(/[^\d+\s().-]/g, '');

const messageFor = (a: Analysis, country: Country, strings: MobileInputStrings): string | null => {
  if (a.isValid || !a.error) return null;
  return strings.errors[a.error].replace('{0}', country.name);
};

// ── Drapeau (flagcdn) avec repli sur le code ISO si l'image est bloquée ───────
const Flag: React.FC<{ country: Country; show: boolean; small?: boolean }> = ({ country, show, small }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [country.iso2]);
  const iso = country.iso2.toLowerCase();
  if (!show || failed) {
    return <span className={`country-iso${small ? ' small' : ''}`} aria-hidden="true">{country.iso2}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/w40/${iso}.png`}
      srcSet={`https://flagcdn.com/w80/${iso}.png 2x`}
      width={small ? 20 : 22}
      height={small ? 14 : 16}
      alt=""
      className="country-flag"
      onError={() => setFailed(true)}
    />
  );
};

const PhoneIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M4.2 1.5c.4-.1.8.1 1 .5l1.1 2.4c.2.4.1.8-.2 1.1l-.9.8a8.3 8.3 0 0 0 4.5 4.5l.8-.9c.3-.3.7-.4 1.1-.2l2.4 1.1c.4.2.6.6.5 1l-.4 1.7c-.1.4-.5.7-.9.7C6.6 14.2 1.8 9.4 1.8 2.8c0-.4.3-.8.7-.9l1.7-.4z"/>
  </svg>
);

// ── Composant ─────────────────────────────────────────────────────────────────
const MobileInput: React.FC<MobileInputProps> = (props) => {
  const { value, disabled, masked, config, strings } = props;

  const initial = React.useMemo(
    () => parseStoredValue(value, config.countries, config.defaultCountry),
    []
  );

  const [country, setCountry]           = React.useState<Country>(initial.country);
  const [text, setText]                 = React.useState<string>(initial.text);
  const [touched, setTouched]           = React.useState<boolean>(initial.text !== '');
  const [analysis, setAnalysis]         = React.useState<Analysis | null>(null);
  const [isOpen, setIsOpen]             = React.useState<boolean>(false);
  const [search, setSearch]             = React.useState<string>('');
  const [activeIndex, setActiveIndex]   = React.useState<number>(0);
  const [panelStyle, setPanelStyle]     = React.useState<React.CSSProperties>({});

  const triggerRef  = React.useRef<HTMLButtonElement>(null);
  const panelRef    = React.useRef<HTMLDivElement>(null);
  const searchRef   = React.useRef<HTMLInputElement>(null);
  const activeRef   = React.useRef<HTMLLIElement>(null);
  const lastValue   = React.useRef<string>(value);   // dernière valeur connue (reçue ou émise)
  const propsRef    = React.useRef(props);
  propsRef.current  = props;

  const errorId = React.useMemo(() => `os-phone-err-${Math.random().toString(36).slice(2, 9)}`, []);

  // Validation seule (sans écriture) — chargement, valeur externe, frappe
  const reportValidity = React.useCallback((t: string, c: Country) => {
    const p = propsRef.current;
    const a = analysePhone(t, c, p.config.rules);
    setAnalysis(a);
    p.onResult(
      { value: lastValue.current, isValid: a ? a.isValid : true, errorMessage: a ? messageFor(a, c, p.strings) : null },
      false
    );
  }, []);

  const debouncedValidate = React.useMemo(() => debounce(reportValidity, 350), [reportValidity]);
  React.useEffect(() => () => debouncedValidate.cancel(), [debouncedValidate]);

  // Validation initiale (affiche l'erreur d'un numéro historique invalide, comme CheckPhoneNumberControl)
  React.useEffect(() => {
    if (initial.text) reportValidity(initial.text, initial.country);
  }, []);

  // ── Valeur modifiée hors du contrôle (JS, flux, rafraîchissement) ──────────
  React.useEffect(() => {
    if (value === lastValue.current) return; // écho de notre propre écriture
    lastValue.current = value;
    debouncedValidate.cancel();
    const parsed = parseStoredValue(value, config.countries, config.defaultCountry);
    setCountry(parsed.country);
    setText(parsed.text);
    setTouched(parsed.text !== '');
    reportValidity(parsed.text, parsed.country);
  }, [value]);

  // ── Validation complète + écriture (blur / changement de pays) ─────────────
  const commit = (t: string, c: Country) => {
    debouncedValidate.cancel();
    setTouched(true);
    const a = analysePhone(t, c, config.rules);

    if (!a) {
      setText('');
      setAnalysis(null);
      lastValue.current = '';
      props.onResult({ value: '', isValid: true, errorMessage: null }, true);
      return;
    }

    let shownCountry = c;
    let shownText = t.trim();
    if (a.phone) {
      const found = findCountry(config.countries, a.phone);
      if (found) {
        shownCountry = found;
        shownText = formatLocal(a.phone, found);
      } else {
        shownText = a.phone.formatInternational();
      }
    }

    setCountry(shownCountry);
    setText(shownText);
    setAnalysis(a);

    const out = a.isValid && a.phone ? formatForStorage(a.phone, config.outputFormat) : a.fallbackValue;
    lastValue.current = out;
    props.onResult({ value: out, isValid: a.isValid, errorMessage: messageFor(a, shownCountry, strings) }, true);
  };

  // ── Panneau des pays (portal) ──────────────────────────────────────────────
  const computePanelStyle = React.useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 300 && r.top > spaceBelow;
    setPanelStyle({
      position: 'fixed',
      left: r.left,
      width: 300,
      zIndex: 99999,
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    computePanelStyle();
    window.addEventListener('scroll', computePanelStyle, true);
    window.addEventListener('resize', computePanelStyle);
    return () => {
      window.removeEventListener('scroll', computePanelStyle, true);
      window.removeEventListener('resize', computePanelStyle);
    };
  }, [isOpen, computePanelStyle]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const filtered: Country[] = React.useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return config.countries;
    const qDigits = q.replace(/\D/g, '');
    return config.countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso2.toLowerCase() === q ||
        (qDigits !== '' && c.dialCode.replace(/\D/g, '').startsWith(qDigits))
    );
  }, [search, config.countries]);

  React.useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, activeIndex]);

  const open = () => {
    if (disabled || masked) return;
    const idx = config.countries.findIndex((c) => c.iso2 === country.iso2);
    setActiveIndex(Math.max(idx, 0));
    setSearch('');
    setIsOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  function close(returnFocus: boolean) {
    setIsOpen(false);
    setSearch('');
    if (returnFocus) triggerRef.current?.focus();
  }

  const selectCountry = (c: Country) => {
    close(true);
    setCountry(c);
    if (text.trim()) commit(text, c);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[activeIndex]; if (c) selectCountry(c); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  const showState = touched && !disabled && !masked && analysis !== null;
  const isInvalid = showState && analysis !== null && !analysis.isValid;
  const isValid = showState && analysis !== null && analysis.isValid;
  const errorMessage = isInvalid && analysis ? messageFor(analysis, country, strings) : null;

  const containerClass = ['mobile-input-container'];
  if (disabled || masked) containerClass.push('is-disabled');
  if (isValid) containerClass.push('is-valid');
  if (isInvalid) containerClass.push('is-invalid');

  const hasCallButton = config.callProvider !== 'none' || config.openQuickCreate;
  const callable = !masked && analysis?.isValid === true && analysis.phone !== undefined;

  const placeholder = React.useMemo(() => placeholderFor(country), [country]);

  const panel = isOpen
    ? ReactDOM.createPortal(
        <div ref={panelRef} className="os-phone-dropdown" style={panelStyle} role="dialog">
          <input
            ref={searchRef}
            type="text"
            className="country-search"
            placeholder={strings.search}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setActiveIndex(0); }}
            onKeyDown={onSearchKeyDown}
            aria-label={strings.search}
          />
          <ul className="country-list" role="listbox">
            {filtered.length === 0 ? (
              <li className="country-list-empty">{strings.noResults}</li>
            ) : (
              filtered.map((c, i) => {
                const selected = c.iso2 === country.iso2;
                const active = i === activeIndex;
                return (
                  <li
                    key={c.iso2}
                    ref={active ? activeRef : undefined}
                    role="option"
                    aria-selected={selected}
                    className={`country-list-item${selected ? ' selected' : ''}${active ? ' active' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); selectCountry(c); }}
                  >
                    <Flag country={c} show={config.showFlags} small />
                    <span className="country-dial-code">{c.dialCode}</span>
                    <span className="country-name">{c.name}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="mobile-input-wrapper">
      <div className={containerClass.join(' ')}>
        <button
          ref={triggerRef}
          type="button"
          className="country-selector-button"
          disabled={disabled || masked}
          onClick={() => (isOpen ? close(false) : open())}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={country.name}
        >
          <Flag country={country} show={config.showFlags} />
          <span className="country-dial">{country.dialCode}</span>
          <span className="dropdown-arrow" aria-hidden="true">▾</span>
        </button>

        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          className="phone-number-input"
          value={masked ? '••••••' : text}
          placeholder={disabled || masked ? '' : placeholder}
          disabled={disabled || masked}
          aria-invalid={isInvalid}
          aria-describedby={isInvalid ? errorId : undefined}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const t = sanitize(e.target.value);
            setText(t);
            if (touched) debouncedValidate(t, country);
          }}
          onBlur={() => commit(text, country)}
        />

        {(isValid || isInvalid) && (
          <span className={`status-icon ${isValid ? 'ok' : 'ko'}`} title={isValid ? strings.valid : errorMessage ?? ''} aria-hidden="true">
            {isValid ? '✓' : '!'}
          </span>
        )}

        {hasCallButton && (
          <button
            type="button"
            className="call-button"
            disabled={!callable}
            title={strings.call}
            aria-label={strings.call}
            onClick={() => { if (analysis?.phone) props.onCall(analysis.phone.number); }}
          >
            <PhoneIcon />
          </button>
        )}
      </div>

      {panel}

      {isInvalid && errorMessage && (
        <div id={errorId} className="phone-error-message" role="alert">⚠ {errorMessage}</div>
      )}
    </div>
  );
};

export default MobileInput;
