/**
 * Rapport mensuel de réputation.
 *
 * C'est la preuve de valeur qui arrive sans qu'on la demande, et le meilleur
 * outil de rétention du produit : le gérant reçoit tous les mois un document
 * qui dit ce qui s'est passé et ce qu'il y a à faire.
 *
 * Le rendu PDF vit côté API (il a besoin d'une bibliothèque) ; la structure et
 * le rendu HTML sont ici, pour que l'e-mail et le PDF disent exactement la
 * même chose.
 */

import { THEME_LABELS } from './nlp.js';
import type { ThemeId } from './types.js';

export interface ReportPeriod {
  /** Premier jour du mois, ISO. */
  start: string;
  /** Premier jour du mois suivant, ISO. */
  end: string;
  label: string;
}

export interface ReportHighlight {
  kind: 'win' | 'watch' | 'action';
  text: string;
}

export interface MonthlyReport {
  establishmentName: string;
  period: ReportPeriod;
  averageRating: number;
  /**
   * Écart avec le mois précédent, ou `null` quand ce mois-là ne comportait
   * aucun avis. Afficher « +4,33 » parce que la base de comparaison est vide
   * est une progression imaginaire : le premier mois de suivi doit le dire.
   */
  ratingDelta: number | null;
  reviewCount: number;
  reviewCountDelta: number | null;
  negativeCount: number;
  replyRate: number;
  medianReplyDelayHours: number | null;
  scans: number;
  scanToReviewRate: number | null;
  loyaltyMembers: number;
  topThemes: Array<{ theme: ThemeId; label: string; mentions: number; averageRating: number }>;
  platforms: Array<{ label: string; reviewCount: number; share: number }>;
  highlights: ReportHighlight[];
}

/** Période du mois civil précédant la date donnée. */
export function previousMonthPeriod(reference: Date = new Date()): ReportPeriod {
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 1, 1),
  );
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: start.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  };
}

/**
 * Trois à cinq constats, formulés pour être lus en dix secondes.
 *
 * L'ordre compte : ce qui va bien d'abord — un rapport qui commence par un
 * reproche finit à la corbeille — puis ce qui se dégrade, puis ce qu'il y a
 * concrètement à faire.
 */
export function buildHighlights(
  report: Omit<MonthlyReport, 'highlights'>,
): ReportHighlight[] {
  const highlights: ReportHighlight[] = [];

  if (report.ratingDelta == null) {
    highlights.push({
      kind: 'win',
      text: `Premier mois de suivi : votre note moyenne s'établit à ${fr(report.averageRating)}/5 sur ${report.reviewCount} avis.`,
    });
  } else if (report.ratingDelta >= 0.1) {
    highlights.push({
      kind: 'win',
      text: `Votre note moyenne progresse de ${fr(report.ratingDelta)} point pour atteindre ${fr(report.averageRating)}/5.`,
    });
  }

  if (report.reviewCountDelta != null && report.reviewCountDelta > 0) {
    highlights.push({
      kind: 'win',
      text: `${report.reviewCount} avis reçus, soit ${report.reviewCountDelta} de plus que le mois précédent.`,
    });
  }

  const best = report.topThemes.find((theme) => theme.averageRating >= 4.5 && theme.mentions >= 3);
  if (best) {
    highlights.push({
      kind: 'win',
      text: `« ${best.label} » revient dans ${best.mentions} avis avec une note moyenne de ${fr(best.averageRating, 1)}/5 : c'est votre point fort du mois.`,
    });
  }

  if (report.ratingDelta != null && report.ratingDelta <= -0.1) {
    highlights.push({
      kind: 'watch',
      text: `Votre note moyenne recule de ${fr(Math.abs(report.ratingDelta))} point. À surveiller de près le mois prochain.`,
    });
  }

  const worst = report.topThemes.find((theme) => theme.averageRating <= 3 && theme.mentions >= 2);
  if (worst) {
    highlights.push({
      kind: 'watch',
      text: `« ${worst.label} » est cité dans ${worst.mentions} avis avec une note moyenne de ${fr(worst.averageRating, 1)}/5.`,
    });
  }

  if (report.replyRate < 0.8 && report.negativeCount > 0) {
    highlights.push({
      kind: 'action',
      text: `${Math.round((1 - report.replyRate) * 100)} % de vos avis n'ont pas de réponse. Répondre aux avis négatifs est ce qui pèse le plus sur la perception des futurs clients.`,
    });
  }

  const weakest = report.platforms.filter((p) => p.share < 10 && p.reviewCount < 20)[0];
  if (weakest) {
    highlights.push({
      kind: 'action',
      text: `Votre présence sur ${weakest.label} reste faible (${weakest.reviewCount} avis). Le routage NFC y envoie déjà vos clients en priorité.`,
    });
  }

  return highlights.slice(0, 5);
}

/** Rendu HTML, utilisé tel quel dans l'e-mail et comme source du PDF. */
export function renderReportHtml(report: MonthlyReport): string {
  const kpi = (label: string, value: string, hint = ''): string => `
    <td style="padding:12px 14px;background:#f8f7f4;border-radius:10px;vertical-align:top">
      <div style="font-size:12px;color:#6b6a63">${escapeHtml(label)}</div>
      <div style="font-size:22px;font-weight:600;color:#141413;margin-top:2px">${escapeHtml(value)}</div>
      ${hint ? `<div style="font-size:11px;color:#8a8a85;margin-top:2px">${escapeHtml(hint)}</div>` : ''}
    </td>`;

  const highlightColors: Record<ReportHighlight['kind'], string> = {
    win: '#3f7d58',
    watch: '#9a6b18',
    action: '#c25c3a',
  };

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Rapport ${escapeHtml(report.period.label)}</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#141413;background:#fff">
  <div style="max-width:640px;margin:0 auto">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#c25c3a;font-weight:600">Avisio</div>
    <h1 style="font-size:24px;margin:6px 0 2px">${escapeHtml(report.establishmentName)}</h1>
    <div style="font-size:14px;color:#6b6a63;margin-bottom:20px">Rapport de réputation — ${escapeHtml(report.period.label)}</div>

    <table style="width:100%;border-spacing:8px;border-collapse:separate;margin:0 -8px 8px">
      <tr>
        ${kpi('Note moyenne', fr(report.averageRating), formatDelta(report.ratingDelta))}
        ${kpi('Avis reçus', String(report.reviewCount), plural(report.negativeCount, 'négatif'))}
        ${kpi('Taux de réponse', `${Math.round(report.replyRate * 100)} %`, report.medianReplyDelayHours == null ? '' : `délai médian ${report.medianReplyDelayHours} h`)}
      </tr>
      <tr>
        ${kpi('Scans NFC', String(report.scans), plural(report.loyaltyMembers, 'membre fidélité', 'membres fidélité'))}
        ${kpi('Conversion scan vers avis', report.scanToReviewRate == null ? '—' : `${Math.round(report.scanToReviewRate * 100)} %`)}
        ${kpi('Plateformes actives', String(report.platforms.length))}
      </tr>
    </table>

    <h2 style="font-size:16px;margin:26px 0 10px">Ce qu'il faut retenir</h2>
    ${report.highlights
      .map(
        (highlight) => `
      <div style="border-left:3px solid ${highlightColors[highlight.kind]};padding:8px 0 8px 12px;margin-bottom:10px">
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${highlightColors[highlight.kind]};font-weight:600">${labelOf(highlight.kind)}</div>
        <div style="font-size:14.5px;line-height:1.5;margin-top:3px">${escapeHtml(highlight.text)}</div>
      </div>`,
      )
      .join('')}

    ${
      report.topThemes.length === 0
        ? ''
        : `<h2 style="font-size:16px;margin:26px 0 10px">Ce dont parlent vos clients</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="text-align:left;color:#6b6a63;font-size:12px">
        <th style="padding:6px 0;font-weight:500">Thème</th>
        <th style="padding:6px 0;font-weight:500">Avis</th>
        <th style="padding:6px 0;font-weight:500">Note moyenne</th>
      </tr>
      ${report.topThemes
        .map(
          (theme) => `<tr style="border-top:1px solid #e4e1d8">
        <td style="padding:8px 0">${escapeHtml(theme.label)}</td>
        <td style="padding:8px 0">${theme.mentions}</td>
        <td style="padding:8px 0">${fr(theme.averageRating, 1)}/5</td>
      </tr>`,
        )
        .join('')}
    </table>`
    }

    <h2 style="font-size:16px;margin:26px 0 10px">Répartition par plateforme</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${report.platforms
        .map(
          (platform) => `<tr style="border-top:1px solid #e4e1d8">
        <td style="padding:8px 0">${escapeHtml(platform.label)}</td>
        <td style="padding:8px 0;text-align:right">${platform.reviewCount} avis · ${platform.share.toFixed(0)} %</td>
      </tr>`,
        )
        .join('')}
    </table>

    <p style="font-size:11.5px;color:#8a8a85;line-height:1.5;margin-top:28px">
      Avisio lit les avis déjà publiés via les API officielles des plateformes.
      Aucun avis n'est filtré, masqué ni retardé.
    </p>
  </div>
</body></html>`;
}

const labelOf = (kind: ReportHighlight['kind']): string =>
  kind === 'win' ? 'Point fort' : kind === 'watch' ? 'À surveiller' : 'À faire';

/** Nombre en écriture française : virgule décimale. */
export const fr = (value: number, digits = 2): string =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatDelta = (delta: number | null): string => {
  if (delta == null) return 'premier mois de suivi';
  if (Math.abs(delta) < 0.01) return 'stable';
  return `${delta > 0 ? '+' : '−'}${fr(Math.abs(delta))} vs mois précédent`;
};

/** Accord en nombre, pour ne pas écrire « 1 négatifs ». */
export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count > 1 ? pluralForm : singular}`;

export const themeLabel = (theme: ThemeId): string => THEME_LABELS[theme];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
