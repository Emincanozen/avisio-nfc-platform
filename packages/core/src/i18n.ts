/**
 * Internationalisation de la landing page NFC.
 *
 * La langue est négociée à partir de l'en-tête `Accept-Language` du navigateur
 * mobile, avec repli sur la langue par défaut de l'établissement. Aucune
 * donnée n'est stockée pour cela : l'en-tête est lu, utilisé, oublié.
 */

import type { Locale } from './types.js';

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en', 'es', 'de', 'it', 'nl'];

export interface LandingMessages {
  title: string;
  subtitle: string;
  cta: string;
  redirecting: string;
  loyaltyIntro: string;
  loyaltyCta: string;
  loyaltyPlaceholder: string;
  loyaltySuccess: string;
  disclosure: string;
  disclosureWithReward: string;
  error: string;
  poweredBy: string;
}

const MESSAGES: Record<Locale, LandingMessages> = {
  fr: {
    title: 'Merci de votre visite',
    subtitle: 'Votre avis aide {establishment} à progresser. Une minute suffit.',
    cta: 'Laisser un avis sur {platform}',
    redirecting: 'Ouverture de {platform}…',
    loyaltyIntro: 'Cumulez des points fidélité',
    loyaltyCta: 'Enregistrer mes points',
    loyaltyPlaceholder: 'Votre e-mail ou téléphone',
    loyaltySuccess: 'Points enregistrés : {balance}',
    disclosure:
      'Votre avis est publié directement sur la plateforme, sans relecture ni filtrage de notre part.',
    disclosureWithReward:
      'Les points sont accordés pour le dépôt d’un avis, quelle que soit la note. Votre avis est publié directement sur la plateforme.',
    error: 'Cette plaquette n’est pas encore activée. Signalez-le à l’établissement.',
    poweredBy: 'Propulsé par Avisio',
  },
  en: {
    title: 'Thanks for stopping by',
    subtitle: 'Your review helps {establishment} improve. It takes a minute.',
    cta: 'Leave a review on {platform}',
    redirecting: 'Opening {platform}…',
    loyaltyIntro: 'Collect loyalty points',
    loyaltyCta: 'Save my points',
    loyaltyPlaceholder: 'Your email or phone',
    loyaltySuccess: 'Points saved: {balance}',
    disclosure:
      'Your review is posted straight to the platform. We never screen or filter it.',
    disclosureWithReward:
      'Points are granted for posting a review, whatever the rating. Your review goes straight to the platform.',
    error: 'This tag is not active yet. Please let the staff know.',
    poweredBy: 'Powered by Avisio',
  },
  es: {
    title: 'Gracias por su visita',
    subtitle: 'Su opinión ayuda a {establishment} a mejorar. Solo tarda un minuto.',
    cta: 'Dejar una opinión en {platform}',
    redirecting: 'Abriendo {platform}…',
    loyaltyIntro: 'Acumule puntos de fidelidad',
    loyaltyCta: 'Guardar mis puntos',
    loyaltyPlaceholder: 'Su correo o teléfono',
    loyaltySuccess: 'Puntos guardados: {balance}',
    disclosure:
      'Su opinión se publica directamente en la plataforma, sin revisión ni filtro por nuestra parte.',
    disclosureWithReward:
      'Los puntos se conceden por publicar una opinión, sea cual sea la nota. Su opinión se publica directamente.',
    error: 'Esta placa aún no está activada. Avise al establecimiento.',
    poweredBy: 'Con tecnología de Avisio',
  },
  de: {
    title: 'Danke für Ihren Besuch',
    subtitle: 'Ihre Bewertung hilft {establishment}. Es dauert nur eine Minute.',
    cta: 'Bewertung auf {platform} abgeben',
    redirecting: '{platform} wird geöffnet…',
    loyaltyIntro: 'Treuepunkte sammeln',
    loyaltyCta: 'Punkte speichern',
    loyaltyPlaceholder: 'E-Mail oder Telefon',
    loyaltySuccess: 'Gespeicherte Punkte: {balance}',
    disclosure:
      'Ihre Bewertung wird direkt auf der Plattform veröffentlicht – ohne Prüfung oder Filterung.',
    disclosureWithReward:
      'Punkte gibt es für das Abgeben einer Bewertung, unabhängig von der Note.',
    error: 'Dieses Schild ist noch nicht aktiv. Bitte informieren Sie das Personal.',
    poweredBy: 'Bereitgestellt von Avisio',
  },
  it: {
    title: 'Grazie della visita',
    subtitle: 'La tua recensione aiuta {establishment} a migliorare. Basta un minuto.',
    cta: 'Lascia una recensione su {platform}',
    redirecting: 'Apertura di {platform}…',
    loyaltyIntro: 'Accumula punti fedeltà',
    loyaltyCta: 'Registra i miei punti',
    loyaltyPlaceholder: 'Email o telefono',
    loyaltySuccess: 'Punti registrati: {balance}',
    disclosure:
      'La tua recensione viene pubblicata direttamente sulla piattaforma, senza filtri da parte nostra.',
    disclosureWithReward:
      'I punti sono assegnati per la pubblicazione di una recensione, qualunque sia il voto.',
    error: 'Questa targhetta non è ancora attiva. Segnalalo al personale.',
    poweredBy: 'Realizzato con Avisio',
  },
  nl: {
    title: 'Bedankt voor uw bezoek',
    subtitle: 'Uw review helpt {establishment} vooruit. Het kost een minuut.',
    cta: 'Laat een review achter op {platform}',
    redirecting: '{platform} wordt geopend…',
    loyaltyIntro: 'Spaar loyaliteitspunten',
    loyaltyCta: 'Mijn punten opslaan',
    loyaltyPlaceholder: 'E-mail of telefoon',
    loyaltySuccess: 'Opgeslagen punten: {balance}',
    disclosure:
      'Uw review wordt rechtstreeks op het platform geplaatst, zonder controle of filtering.',
    disclosureWithReward:
      'Punten worden toegekend voor het plaatsen van een review, ongeacht de score.',
    error: 'Deze tag is nog niet geactiveerd. Meld dit aan het personeel.',
    poweredBy: 'Mogelijk gemaakt door Avisio',
  },
};

/**
 * Négocie la langue à partir d'un en-tête `Accept-Language`.
 * Exemple : "it-IT,it;q=0.9,en;q=0.8" avec fallback "fr" -> "it".
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  fallback: Locale = 'fr',
  supported: Locale[] = SUPPORTED_LOCALES,
): Locale {
  if (!acceptLanguage) return fallback;

  const candidates = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((c) => c.tag.length > 0 && c.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    if (candidate.tag === '*') return fallback;
    const base = candidate.tag.split('-')[0] as Locale;
    if (supported.includes(base)) return base;
  }
  return fallback;
}

export function messages(locale: Locale): LandingMessages {
  return MESSAGES[locale] ?? MESSAGES.fr;
}

/** Interpolation minimale : `{clef}` remplacé par la valeur fournie. */
export function t(
  locale: Locale,
  key: keyof LandingMessages,
  vars: Record<string, string | number> = {},
): string {
  const template = messages(locale)[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
