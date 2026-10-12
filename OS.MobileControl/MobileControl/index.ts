import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import * as ReactDOM from "react-dom";
import MobileInput, { MobileInputStrings, PhoneResult } from "./components/MobileInput";
import { countries } from "./utils/countries";
import { CallProvider, ControlConfig, readConfig } from "./utils/config";

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

export const buildCallUrl = (provider: CallProvider, customProtocol: string, e164: string): string | null => {
    switch (provider) {
        case "tel":    return `tel:${e164}`;
        case "teams":  return `https://teams.microsoft.com/l/call/0/0?users=4:${encodeURIComponent(e164)}`;
        case "skype":  return `skype:${e164}?call`;
        case "custom": return customProtocol ? `${customProtocol}:${e164}` : null;
        default:       return null;
    }
};

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
        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
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
        this.clearNotification();
        ReactDOM.unmountComponentAtNode(this._container);
    }

    // ── Rendu ────────────────────────────────────────────────────────────────
    private render(): void {
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
                strings: this._strings,
                onResult: this.onResult,
                onCall: this.onCall,
            }),
            this._container
        );
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
