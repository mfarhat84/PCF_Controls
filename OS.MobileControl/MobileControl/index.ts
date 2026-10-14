import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import * as ReactDOM from "react-dom";
import MobileInput, { MobileInputStrings, PhoneResult } from "./components/MobileInput";
import { Country, countries } from "./utils/countries";
import { pickDefaultCountry, readPath, resolveCountryCode } from "./utils/countrySource";
import { ControlConfig, readConfig } from "./utils/config";
import { buildCallUrl } from "./utils/call";

// setNotification / clearNotification existent à l'exécution dans les applications pilotées par modèle
// mais ne sont pas typés (ni garantis) : on vérifie leur présence avant chaque appel.
interface NotificationUtility {
    setNotification?: (message: string, notificationId: string) => boolean;
    clearNotification?: (notificationId?: string) => boolean;
}

interface XrmLike {
    Navigation?: {
        openForm: (options: Record<string, unknown>, parameters?: Record<string, unknown>) => Promise<unknown>;
    };
}

interface ContextInfo {
    entityId?: string;
    entityTypeName?: string;
    entityRecordName?: string;
}

const NOTIFICATION_ID = "os-mobile-invalid";

/** Vue minimale des propriétés liées optionnelles (types générés variables selon le type de colonne). */
interface LooseProperty {
    raw?: unknown;
    formatted?: string;
    attributes?: { LogicalName?: string };
}

export class MobileControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private _container: HTMLDivElement;
    private _notifyOutputChanged: () => void;
    private _context: ComponentFramework.Context<IInputs>;
    private _config: ControlConfig;
    private _strings: MobileInputStrings;

    private _value = "";             // valeur écrite dans la colonne
    private _isValid = true;         // valeur écrite dans numberValid
    private _readOnly = false;
    private _notificationShown = false;
    private _destroyed = false;

    // Pays lu via la Web API (countryPath) — résolu de façon asynchrone
    private _pathKey = "";
    private _pathCountry: string | null = null;

    constructor() { /* vide */ }

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this._container = container;
        this._notifyOutputChanged = notifyOutputChanged;
        this._context = context;

        const p = context.parameters;
        this._config = readConfig(
            {
                outputFormat: p.outputFormat?.raw,
                defaultCountry: p.defaultCountry?.raw,
                countryPath: p.countryPath?.raw,
                priorityCountries: p.priorityCountries?.raw,
                allowedCountries: p.allowedCountries?.raw,
                excludedCountries: p.excludedCountries?.raw,
                allowedTypes: p.allowedTypes?.raw,
                excludedTypes: p.excludedTypes?.raw,
                blockSaveWhenInvalid: p.blockSaveWhenInvalid?.raw,
                showFlags: p.showFlags?.raw,
                callProvider: p.callProvider?.raw,
                customCallProtocol: p.customCallProtocol?.raw,
                openQuickCreate: p.openQuickCreate?.raw,
            },
            countries
        );

        const s = (key: string) => context.resources.getString(key);
        this._strings = {
            search: s("Ui_Search"),
            noResults: s("Ui_NoResults"),
            call: s("Ui_Call"),
            valid: s("Ui_Valid"),
            errors: {
                tooShort: s("Err_TooShort"),
                tooLong: s("Err_TooLong"),
                invalid: s("Err_Invalid"),
                countryNotAllowed: s("Err_CountryNotAllowed"),
                typeNotAllowed: s("Err_TypeNotAllowed"),
            },
        };

        this._value = p.phoneValue.raw ?? "";
        this._isValid = p.numberValid?.raw ?? true;
        this.refreshPathCountry();
        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
        this.refreshPathCountry();
        this.render();
    }

    public getOutputs(): IOutputs {
        return {
            // undefined = colonne vidée (null)
            phoneValue: this._value === "" ? undefined : this._value,
            numberValid: this._isValid,
        };
    }

    public destroy(): void {
        this._destroyed = true;
        this.clearNotification();
        ReactDOM.unmountComponentAtNode(this._container);
    }

    // ── Rendu ────────────────────────────────────────────────────────────────
    private render(): void {
        if (this._destroyed) return;
        const field = this._context.parameters.phoneValue;
        let disabled = this._context.mode.isControlDisabled;
        let masked = false;
        if (field.security) {
            disabled = disabled || !field.security.editable;
            masked = !field.security.readable;
        }
        this._readOnly = disabled || masked;
        if (this._readOnly) this.clearNotification(); // jamais bloquer un enregistrement que l'utilisateur ne peut pas corriger

        ReactDOM.render(
            React.createElement(MobileInput, {
                value: field.raw ?? "",
                disabled,
                masked,
                config: this._config,
                defaultCountry: this.computeDefaultCountry(),
                strings: this._strings,
                onResult: this.onResult,
                onCall: this.onCall,
            }),
            this._container
        );
    }

    // ── Pays par défaut ─────────────────────────────────────────────────────────
    // Ordre de priorité : 1) champ lu via countryPath (recherche ou enregistrement courant)
    //                     2) colonne defaultCountryColumn  3) valeur fixe defaultCountry  4) 1er pays de la liste
    private param(name: string): LooseProperty | undefined {
        return (this._context.parameters as unknown as Record<string, LooseProperty | undefined>)[name];
    }

    private computeDefaultCountry(): Country {
        const column = this.param("defaultCountryColumn");
        const columnValue = column ? column.formatted || column.raw : null;
        return pickDefaultCountry(this._config.countries, [
            this._pathCountry,
            resolveCountryCode(columnValue),
            this._config.staticDefaultCountry,
        ]);
    }

    /** Relance la lecture Web API quand la recherche, le chemin ou l'enregistrement changent. */
    private refreshPathCountry(): void {
        const path = this._config.countryPath;
        const webAPI = this._context.webAPI as ComponentFramework.WebApi | undefined;
        let start: { entity: string; id: string } | null = null;

        if (path && webAPI) {
            const lookup = this.param("countryLookup");
            const lookupConfigured = !!lookup && (lookup.raw != null || !!lookup.attributes?.LogicalName);
            if (lookupConfigured) {
                // Départ = l'enregistrement pointé par la recherche (valeur en direct du formulaire)
                const first = Array.isArray(lookup.raw) && lookup.raw.length > 0
                    ? (lookup.raw[0] as { id?: string; entityType?: string })
                    : null;
                if (first?.id && first.entityType) start = { entity: first.entityType, id: first.id };
            } else {
                // Départ = l'enregistrement courant : la table est détectée automatiquement
                const info = (this._context.mode as unknown as { contextInfo?: ContextInfo }).contextInfo;
                if (info?.entityId && info.entityTypeName) start = { entity: info.entityTypeName, id: info.entityId };
            }
        }

        const key = start && path ? `${start.entity}:${start.id}|${path.join(".")}` : "";
        if (key === this._pathKey) return;
        this._pathKey = key;
        const hadValue = this._pathCountry !== null;
        this._pathCountry = null;
        if (!start || !path || !webAPI) {
            if (hadValue) this.render();
            return;
        }

        readPath(webAPI, start.entity, start.id, path)
            .then((value) => {
                if (this._pathKey !== key) return; // une lecture plus récente a été lancée
                this._pathCountry = resolveCountryCode(value);
                this.render();
            })
            .catch(() => undefined); // champ inaccessible (droits, nom erroné) : on garde les autres sources
    }

    // ── Résultat de validation venant du composant ───────────────────────────
    private onResult = (result: PhoneResult, persist: boolean): void => {
        this.updateNotification(result);
        if (!persist) return;
        if (result.value !== this._value || result.isValid !== this._isValid) {
            this._value = result.value;
            this._isValid = result.isValid;
            this._notifyOutputChanged();
        }
    };

    private updateNotification(result: PhoneResult): void {
        if (!this._config.blockSaveWhenInvalid || this._readOnly) return;
        const utils = this._context.utils as unknown as NotificationUtility;
        if (!result.isValid && result.errorMessage) {
            if (typeof utils.setNotification === "function") {
                utils.setNotification(result.errorMessage, NOTIFICATION_ID);
                this._notificationShown = true;
            }
        } else {
            this.clearNotification();
        }
    }

    private clearNotification(): void {
        if (!this._notificationShown) return;
        const utils = this._context.utils as unknown as NotificationUtility;
        if (typeof utils.clearNotification === "function") utils.clearNotification(NOTIFICATION_ID);
        this._notificationShown = false;
    }

    // ── Click to call ────────────────────────────────────────────────────────
    private onCall = (e164: string): void => {
        const url = buildCallUrl(this._config.callProvider, this._config.customCallProtocol, e164);
        if (url) {
            const link = document.createElement("a");
            link.href = url;
            if (url.startsWith("https:")) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
            document.body.appendChild(link);
            link.click();
            link.remove();
        }
        if (this._config.openQuickCreate) this.openPhoneCallQuickCreate(e164);
    };

    private openPhoneCallQuickCreate(e164: string): void {
        const xrm = (window as unknown as { Xrm?: XrmLike }).Xrm;
        if (!xrm?.Navigation) return; // hors application pilotée par modèle

        const info = (this._context.mode as unknown as { contextInfo?: ContextInfo }).contextInfo;
        const options: Record<string, unknown> = { entityName: "phonecall", useQuickCreateForm: true };
        const parameters: Record<string, unknown> = { phonenumber: e164 };

        if (info?.entityId && info.entityTypeName) {
            const reference = { entityType: info.entityTypeName, id: info.entityId, name: info.entityRecordName ?? "" };
            options.createFromEntity = reference;
            parameters.to = [reference];
        }
        xrm.Navigation.openForm(options, parameters).catch(() => undefined);
    }
}
