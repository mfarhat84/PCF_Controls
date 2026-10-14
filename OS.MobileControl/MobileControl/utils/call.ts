import { CallProvider } from "./config";

/** URL à ouvrir pour le bouton d'appel (null = aucun lien). */
export const buildCallUrl = (provider: CallProvider, customProtocol: string, e164: string): string | null => {
    switch (provider) {
        case "tel":    return `tel:${e164}`;
        case "teams":  return `https://teams.microsoft.com/l/call/0/0?users=4:${encodeURIComponent(e164)}`;
        case "skype":  return `skype:${e164}?call`;
        case "custom": return customProtocol ? `${customProtocol}:${e164}` : null;
        default:       return null;
    }
};
