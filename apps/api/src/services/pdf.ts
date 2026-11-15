/**
 * Génération des PDF : factures et rapport mensuel.
 *
 * PDFKit plutôt qu'un navigateur headless : un Chromium pour produire une
 * facture d'une page coûterait 400 Mo d'image et plusieurs secondes par
 * document, pour un rendu qu'on ne maîtrise pas mieux.
 *
 * La facture porte les mentions obligatoires françaises : identité de
 * l'émetteur et du client, numéro, dates, détail, TVA, échéance, pénalités de
 * retard et indemnité forfaitaire de recouvrement.
 */

import PDFDocument from 'pdfkit';
import {
  LATE_PENALTY_RATE,
  RECOVERY_FEE_CENTS,
  formatDelta,
  formatEuros,
  fr,
  plural,
  type Establishment,
  type Invoice,
  type MonthlyReport,
} from '@avisio/core';
import { env } from '../env.js';

const INK = '#141413';
const MUTED = '#6b6a63';
const ACCENT = '#c25c3a';
const RULE = '#e4e1d8';

/** Rend un document PDFKit en un seul Buffer. */
function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function renderInvoicePdf(
  invoice: Invoice,
  establishment: Establishment,
): Promise<Buffer> {
  return render((doc) => {
    const left = 48;
    const right = 547;

    doc.fillColor(ACCENT).fontSize(9).text('AVISIO', left, 48, { characterSpacing: 1.5 });
    doc.fillColor(INK).fontSize(20).text('Facture', left, 66);
    doc.fillColor(MUTED).fontSize(10).text(invoice.number, left, 92);

    // Émetteur
    doc.fontSize(9).fillColor(MUTED).text('Émetteur', 330, 66);
    doc
      .fillColor(INK)
      .fontSize(9.5)
      .text(
        [
          env.company.name,
          env.company.address,
          `SIRET ${env.company.siret}`,
          `TVA ${env.company.vatNumber}`,
        ].join('\n'),
        330,
        80,
        { width: 217 },
      );

    // Client
    let y = 150;
    doc.fontSize(9).fillColor(MUTED).text('Facturé à', left, y);
    doc
      .fillColor(INK)
      .fontSize(10.5)
      .text(establishment.name, left, y + 14)
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(establishment.postalCode, left, y + 30);

    doc.fontSize(9).fillColor(MUTED).text('Dates', 330, y);
    doc
      .fillColor(INK)
      .fontSize(9.5)
      .text(
        [
          `Émise le ${formatDate(invoice.issuedAt)}`,
          `Échéance le ${formatDate(invoice.dueAt)}`,
          `Période du ${formatDate(invoice.periodStart)} au ${formatDate(invoice.periodEnd)}`,
        ].join('\n'),
        330,
        y + 14,
        { width: 217 },
      );

    // Lignes
    y = 230;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
    y += 10;
    doc.fontSize(8.5).fillColor(MUTED);
    doc.text('DÉSIGNATION', left, y);
    doc.text('QTÉ', 360, y, { width: 40, align: 'right' });
    doc.text('P.U. HT', 405, y, { width: 65, align: 'right' });
    doc.text('TOTAL HT', 475, y, { width: 72, align: 'right' });
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
    y += 10;

    doc.fontSize(10).fillColor(INK);
    for (const line of invoice.lines) {
      doc.text(line.label, left, y, { width: 300 });
      doc.text(String(line.quantity), 360, y, { width: 40, align: 'right' });
      doc.text(formatEuros(line.unitCents), 405, y, { width: 65, align: 'right' });
      doc.text(formatEuros(line.totalCents), 475, y, { width: 72, align: 'right' });
      y += Math.max(18, doc.heightOfString(line.label, { width: 300 }) + 4);
    }

    y += 6;
    doc.moveTo(330, y).lineTo(right, y).strokeColor(RULE).stroke();
    y += 10;

    const totalRow = (label: string, value: string, bold = false): void => {
      doc
        .fontSize(bold ? 12 : 10)
        .fillColor(bold ? INK : MUTED)
        .text(label, 330, y, { width: 140, align: 'right' })
        .fillColor(INK)
        .text(value, 475, y, { width: 72, align: 'right' });
      y += bold ? 20 : 16;
    };

    totalRow('Total HT', formatEuros(invoice.subtotalCents));
    totalRow('TVA 20 %', formatEuros(invoice.vatCents));
    totalRow('Total TTC', formatEuros(invoice.totalCents), true);

    if (invoice.status === 'paid') {
      doc
        .fontSize(10)
        .fillColor('#3f7d58')
        .text(
          `Réglée le ${formatDate(invoice.paidAt ?? invoice.issuedAt)}`,
          330,
          y,
          { width: 217, align: 'right' },
        );
      y += 20;
    }

    // Mentions légales obligatoires, calées sur le bas de page.
    //
    // Leur hauteur est mesurée avant placement : posées à une ordonnée fixe,
    // elles débordaient sur une seconde page dès que l'IBAN était renseigné,
    // et une facture d'une ligne partait en deux feuillets.
    const legal = [
      `Paiement à ${formatDate(invoice.dueAt)}. En cas de retard, pénalités au taux annuel de ${formatRate(LATE_PENALTY_RATE)} (trois fois le taux d'intérêt légal, art. L.441-10 du code de commerce), exigibles sans rappel préalable.`,
      `Indemnité forfaitaire pour frais de recouvrement : ${formatEuros(RECOVERY_FEE_CENTS)} (art. D.441-5 du code de commerce).`,
      'Pas d’escompte pour paiement anticipé.',
      env.company.iban ? `Règlement par virement : ${env.company.iban}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const legalWidth = right - left;
    doc.fontSize(7.5).fillColor(MUTED);
    const legalHeight = doc.heightOfString(legal, { width: legalWidth });
    const legalY = doc.page.height - doc.page.margins.bottom - legalHeight;

    doc.text(legal, left, Math.max(y + 20, legalY), { width: legalWidth, align: 'left' });
  });
}

export function renderReportPdf(report: MonthlyReport): Promise<Buffer> {
  return render((doc) => {
    const left = 48;
    const right = 547;

    doc.fillColor(ACCENT).fontSize(9).text('AVISIO', left, 48, { characterSpacing: 1.5 });
    doc.fillColor(INK).fontSize(21).text(report.establishmentName, left, 66);
    doc
      .fillColor(MUTED)
      .fontSize(11)
      .text(`Rapport de réputation — ${report.period.label}`, left, 94);

    // Bandeau d'indicateurs
    let y = 130;
    // Pas de flèche ni de tiret cadratin dans les libellés : la police
    // Helvetica embarquée par PDFKit est en encodage WinAnsi, où « → » sort en
    // caractères parasites.
    const cards: Array<[string, string, string]> = [
      ['Note moyenne', fr(report.averageRating), formatDelta(report.ratingDelta)],
      ['Avis reçus', String(report.reviewCount), plural(report.negativeCount, 'négatif')],
      ['Taux de réponse', `${Math.round(report.replyRate * 100)} %`,
        report.medianReplyDelayHours == null ? '' : `délai médian ${report.medianReplyDelayHours} h`],
      ['Scans NFC', String(report.scans),
        plural(report.loyaltyMembers, 'membre fidélité', 'membres fidélité')],
      ['Conversion scan vers avis',
        report.scanToReviewRate == null ? '-' : `${Math.round(report.scanToReviewRate * 100)} %`, ''],
      ['Plateformes', String(report.platforms.length), ''],
    ];

    const cardWidth = (right - left - 2 * 12) / 3;
    cards.forEach(([label, value, hint], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = left + column * (cardWidth + 12);
      const cardY = y + row * 78;
      doc.roundedRect(x, cardY, cardWidth, 66, 8).fillColor('#f8f7f4').fill();
      doc.fillColor(MUTED).fontSize(8).text(label, x + 10, cardY + 10, { width: cardWidth - 20 });
      doc.fillColor(INK).fontSize(18).text(value, x + 10, cardY + 24, { width: cardWidth - 20 });
      if (hint) {
        doc.fillColor(MUTED).fontSize(7.5).text(hint, x + 10, cardY + 48, { width: cardWidth - 20 });
      }
    });

    y += 78 * 2 + 12;

    // Constats
    doc.fillColor(INK).fontSize(13).text("Ce qu'il faut retenir", left, y);
    y += 20;
    const colors = { win: '#3f7d58', watch: '#9a6b18', action: ACCENT } as const;
    const labels = { win: 'POINT FORT', watch: 'À SURVEILLER', action: 'À FAIRE' } as const;

    for (const highlight of report.highlights) {
      const height = doc.heightOfString(highlight.text, { width: right - left - 14 }) + 16;
      doc.rect(left, y, 2.5, height).fillColor(colors[highlight.kind]).fill();
      doc
        .fillColor(colors[highlight.kind])
        .fontSize(7.5)
        .text(labels[highlight.kind], left + 12, y + 1, { characterSpacing: 0.6 });
      doc
        .fillColor(INK)
        .fontSize(10)
        .text(highlight.text, left + 12, y + 12, { width: right - left - 14 });
      y += height + 8;
    }

    // Thèmes
    if (report.topThemes.length > 0) {
      y += 8;
      doc.fillColor(INK).fontSize(13).text('Ce dont parlent vos clients', left, y);
      y += 20;
      doc.fontSize(8.5).fillColor(MUTED);
      doc.text('THÈME', left, y);
      doc.text('AVIS', 380, y, { width: 60, align: 'right' });
      doc.text('NOTE MOYENNE', 450, y, { width: 97, align: 'right' });
      y += 13;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
      y += 8;
      for (const theme of report.topThemes) {
        doc.fillColor(INK).fontSize(10).text(theme.label, left, y, { width: 320 });
        doc.text(String(theme.mentions), 380, y, { width: 60, align: 'right' });
        doc.text(`${fr(theme.averageRating, 1)}/5`, 450, y, { width: 97, align: "right" });
        y += 17;
      }
    }

    // Plateformes
    y += 12;
    doc.fillColor(INK).fontSize(13).text('Répartition par plateforme', left, y);
    y += 20;
    for (const platform of report.platforms) {
      doc.fillColor(INK).fontSize(10).text(platform.label, left, y, { width: 260 });
      doc
        .fillColor(MUTED)
        .text(`${platform.reviewCount} avis · ${Math.round(platform.share)} %`, 380, y, {
          width: 167,
          align: 'right',
        });
      y += 17;
    }

    doc
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        "Avisio lit les avis déjà publiés via les API officielles des plateformes. Aucun avis n'est filtré, masqué ni retardé.",
        left,
        780,
        { width: 499 },
      );
  });
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Taux en écriture française : virgule décimale, espace avant le %. */
const formatRate = (rate: number): string =>
  `${(rate * 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

