/**
 * Jeu de démonstration.
 *
 * Généré de façon déterministe (PRNG à graine fixe) pour que la démo
 * commerciale montre toujours les mêmes chiffres : un restaurant avec une
 * tendance « attente » qui monte, une boutique saine, un hôtel sous-représenté
 * sur TripAdvisor — chacun illustrant un des quatre axes du produit.
 */

import {
  DEFAULT_PREFERENCES,
  PLATFORM_LABELS,
  addMonths,
  buildInvoice,
  heuristicAnalysis,
  type Alert,
  type Establishment,
  type Invoice,
  type LoyaltyMember,
  type Manager,
  type NfcTag,
  type NotificationPreferences,
  type PlatformId,
  type PlatformLink,
  type Review,
  type ScanEvent,
  type Subscription,
} from '@avisio/core';
import { hashContact, hashPassword } from './auth.js';
import type { PosCredentialRecord, PosTicketRecord } from './repository/types.js';

export interface DemoDataset {
  managers: Manager[];
  establishments: Establishment[];
  platformLinks: PlatformLink[];
  tags: NfcTag[];
  reviews: Review[];
  scans: ScanEvent[];
  alerts: Alert[];
  loyalty: LoyaltyMember[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  preferences: NotificationPreferences[];
  posTickets: PosTicketRecord[];
  posCredentials: PosCredentialRecord[];
}

/** Compte gérant : voit ses trois établissements. */
export const DEMO_CREDENTIALS = { email: 'demo@avisio.fr', password: 'demo1234' };
/** Compte exploitant : back-office, tout le parc, facturation. */
export const DEMO_ADMIN_CREDENTIALS = { email: 'admin@avisio.fr', password: 'admin1234' };

/** PRNG déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!;

export function buildDemoDataset(now = new Date()): DemoDataset {
  const random = rng(20260917);
  const iso = (daysAgo: number, hour = 12): string =>
    new Date(now.getTime() - daysAgo * 86_400_000 + hour * 3_600_000 - 12 * 3_600_000).toISOString();

  const establishments: Establishment[] = [
    {
      id: 'est_comptoir',
      name: 'Le Comptoir des Minimes',
      sector: 'restaurant',
      postalCode: '31200',
      nafCode: '5610A',
      plan: 'premium',
      addons: [],
      committed12Months: true,
      brandTone:
        'chaleureux et direct, vouvoiement, ton de bistrot de quartier, jamais corporate',
      defaultLocale: 'fr',
      createdAt: iso(400),
    },
    {
      id: 'est_atelier',
      name: 'Atelier Sézanne',
      sector: 'retail',
      postalCode: '31000',
      nafCode: '4771Z',
      plan: 'pro',
      addons: ['analytics'],
      committed12Months: true,
      brandTone: 'élégant et sobre, vouvoiement, vocabulaire de la mode',
      defaultLocale: 'fr',
      createdAt: iso(240),
    },
    {
      id: 'est_hotel',
      name: 'Hôtel Garonne',
      sector: 'hotel',
      postalCode: '31000',
      nafCode: '5510Z',
      plan: 'essentiel',
      addons: ['negative_reviews'],
      committed12Months: false,
      brandTone: 'professionnel, courtois, orienté service hôtelier',
      defaultLocale: 'fr',
      createdAt: iso(90),
    },
  ];

  const managers: Manager[] = [
    {
      id: 'mgr_demo',
      email: DEMO_CREDENTIALS.email,
      passwordHash: hashPassword(DEMO_CREDENTIALS.password),
      name: 'Camille Martin',
      role: 'owner',
      establishmentIds: establishments.map((e) => e.id),
      createdAt: iso(400),
    },
    {
      id: 'mgr_admin',
      email: DEMO_ADMIN_CREDENTIALS.email,
      passwordHash: hashPassword(DEMO_ADMIN_CREDENTIALS.password),
      name: 'Exploitation Avisio',
      role: 'admin',
      // L'admin voit tout le parc via le back-office ; cette liste ne limite
      // que son accès à l'espace gérant classique.
      establishmentIds: establishments.map((e) => e.id),
      createdAt: iso(400),
    },
  ];

  const platformLinks: PlatformLink[] = [
    link('est_comptoir', 'google', 'https://g.page/r/comptoir-minimes/review', 412, 4.3),
    link('est_comptoir', 'tripadvisor', 'https://www.tripadvisor.fr/UserReview-comptoir', 38, 4.0),
    link('est_comptoir', 'thefork', 'https://www.thefork.fr/restaurant/comptoir/avis', 0),
    link('est_atelier', 'google', 'https://g.page/r/atelier-sezanne/review', 96, 4.7),
    link('est_atelier', 'facebook', 'https://facebook.com/ateliersezanne/reviews', 21, 4.6),
    link('est_hotel', 'google', 'https://g.page/r/hotel-garonne/review', 233, 3.9),
    // Désactivée : l'Hôtel Garonne est en offre Essentiel, qui n'autorise que
    // Google. Le lien reste en base — ses 14 avis nourrissent la répartition
    // affichée au gérant — mais il n'entre pas dans le routage. Laisser deux
    // plateformes actives contredirait le quota de son offre.
    link('est_hotel', 'tripadvisor', 'https://www.tripadvisor.fr/UserReview-garonne', 14, 3.7, false),
  ];

  const tags: NfcTag[] = [
    tag('tag_comptoir_bar', 'est_comptoir', 'Comptoir — zone bar', 'k7m2p9qa', 'premium', 318),
    tag('tag_comptoir_add', 'est_comptoir', 'Chevalet — addition', 'r4x8t2vb', 'chevalet', 241),
    tag('tag_comptoir_terr', 'est_comptoir', 'Terrasse', 'w9j3n6ec', 'chevalet', 97),
    tag('tag_atelier_caisse', 'est_atelier', 'Caisse', 'h5d8s3fg', 'premium', 164),
    tag('tag_hotel_reception', 'est_hotel', 'Réception', 'z2q7v4kh', 'sticker', 88),
  ];

  // ---- Avis --------------------------------------------------------------
  const reviews: Review[] = [];

  // Le Comptoir : fond correct sur 90 jours, dégradation « attente » sur 7 j.
  const comptoirPositives = [
    'Excellente cuisine, produits frais et accueil très chaleureux. On reviendra.',
    'Plats savoureux et copieux, le service est rapide même le midi. Je recommande.',
    'Ambiance de bistrot parfaite, équipe aux petits soins, addition raisonnable.',
    'Très bon rapport qualité prix, le personnel est souriant et efficace.',
    'Cadre agréable, cuisine de qualité, une belle adresse du quartier des Minimes.',
  ];
  const comptoirWait = [
    "45 minutes d'attente entre l'entrée et le plat, c'est beaucoup trop long le midi.",
    "Cuisine correcte mais service très lent, nous avons attendu près d'une heure.",
    "Attente interminable pour l'addition, on a dû relancer trois fois.",
    "Plat arrivé froid après une longue attente, dommage car la carte est belle.",
  ];
  const comptoirMixed = [
    'Bonne cuisine mais la salle est très bruyante, difficile de discuter.',
    "Correct sans plus, les prix ont augmenté pour des portions plus petites.",
  ];

  for (let i = 0; i < 26; i += 1) {
    const daysAgo = 8 + Math.floor(random() * 40);
    const rating = random() < 0.75 ? 5 : random() < 0.6 ? 4 : 3;
    reviews.push(
      makeReview({
        id: `rev_cmp_old_${i}`,
        establishmentId: 'est_comptoir',
        platform: random() < 0.85 ? 'google' : 'tripadvisor',
        rating,
        comment: rating >= 4 ? pick(random, comptoirPositives) : pick(random, comptoirMixed),
        publishedAt: iso(daysAgo, Math.floor(random() * 12) + 10),
        answered: random() < 0.4,
      }),
    );
  }

  // Fenêtre courte : la tendance « attente » que le dashboard doit détecter.
  const recentComptoir: Array<[number, string, number]> = [
    [1, comptoirWait[0]!, 1],
    [2, comptoirWait[1]!, 2],
    [3, comptoirWait[2]!, 2],
    [5, comptoirWait[3]!, 1],
    [2, comptoirPositives[0]!, 5],
    [4, comptoirPositives[2]!, 5],
    [6, comptoirPositives[1]!, 4],
  ];
  recentComptoir.forEach(([daysAgo, comment, rating], i) => {
    reviews.push(
      makeReview({
        id: `rev_cmp_new_${i}`,
        establishmentId: 'est_comptoir',
        platform: 'google',
        rating,
        comment,
        publishedAt: iso(daysAgo, 19),
        answered: i > 3,
      }),
    );
  });

  // Atelier Sézanne : établissement sain, sert de contre-exemple.
  const atelierComments = [
    'Conseil personnalisé et boutique impeccable, une expérience très agréable.',
    'Belles pièces, accueil parfait, on prend le temps de vous conseiller.',
    'Un peu cher mais la qualité est au rendez-vous et le service irréprochable.',
    'Boutique très propre, vendeuse de bon conseil, je recommande vivement.',
  ];
  for (let i = 0; i < 18; i += 1) {
    const rating = random() < 0.85 ? 5 : 4;
    reviews.push(
      makeReview({
        id: `rev_atl_${i}`,
        establishmentId: 'est_atelier',
        platform: random() < 0.8 ? 'google' : 'facebook',
        rating,
        comment: pick(random, atelierComments),
        publishedAt: iso(1 + Math.floor(random() * 60), 15),
        answered: random() < 0.7,
      }),
    );
  }

  // Hôtel Garonne : avis négatifs non traités, illustre l'axe 1 et le SLA.
  const hotelNegatives = [
    "Chambre bruyante côté rue, impossible de dormir. Le personnel n'a rien proposé.",
    "Propreté de la salle de bain très moyenne, joints noircis, douche qui fuit.",
    "Arrivée à 15 h, chambre pas prête, une heure d'attente dans le hall sans explication.",
  ];
  const hotelPositives = [
    'Emplacement idéal, personnel accueillant et petit-déjeuner copieux.',
    'Chambre confortable et calme sur cour, bon rapport qualité prix.',
  ];
  hotelNegatives.forEach((comment, i) => {
    reviews.push(
      makeReview({
        id: `rev_htl_neg_${i}`,
        establishmentId: 'est_hotel',
        platform: i === 2 ? 'tripadvisor' : 'google',
        rating: i === 1 ? 1 : 2,
        comment,
        publishedAt: iso(i + 1, 9),
        answered: false,
      }),
    );
  });
  for (let i = 0; i < 12; i += 1) {
    reviews.push(
      makeReview({
        id: `rev_htl_${i}`,
        establishmentId: 'est_hotel',
        platform: 'google',
        rating: random() < 0.6 ? 4 : random() < 0.5 ? 5 : 3,
        comment: pick(random, hotelPositives),
        publishedAt: iso(5 + Math.floor(random() * 55), 11),
        answered: random() < 0.25,
      }),
    );
  }

  // ---- Scans -------------------------------------------------------------
  const scans: ScanEvent[] = [];
  let scanSeq = 0;
  for (const nfcTag of tags) {
    const establishment = establishments.find((e) => e.id === nfcTag.establishmentId)!;
    const links = platformLinks.filter((l) => l.establishmentId === establishment.id);
    for (let d = 0; d < 30; d += 1) {
      const count = Math.floor(random() * 6);
      for (let i = 0; i < count; i += 1) {
        scanSeq += 1;
        scans.push({
          id: `scan_${scanSeq}`,
          tagId: nfcTag.id,
          establishmentId: establishment.id,
          platform: pick(random, links).platform,
          locale: random() < 0.88 ? 'fr' : pick(random, ['en', 'es', 'it'] as const),
          createdAt: iso(d, 12 + Math.floor(random() * 8)),
        });
      }
    }
  }

  // ---- Alertes ouvertes --------------------------------------------------
  const alerts: Alert[] = reviews
    .filter((r) => r.rating <= 3 && r.status !== 'answered')
    .slice(0, 8)
    .map((r, i) => ({
      id: `alr_${i}`,
      establishmentId: r.establishmentId,
      type: 'negative_review' as const,
      severity: r.rating <= 2 ? ('critical' as const) : ('warning' as const),
      title: `Avis ${r.rating}★ sur ${PLATFORM_LABELS[r.platform]}`,
      body: r.comment.slice(0, 140),
      reviewId: r.id,
      createdAt: r.ingestedAt,
    }));

  const loyalty: LoyaltyMember[] = Array.from({ length: 24 }, (_, i) => ({
    id: `loy_${i}`,
    establishmentId: i % 3 === 0 ? 'est_atelier' : 'est_comptoir',
    contactHash: `demo${i.toString().padStart(3, '0')}${'0'.repeat(25)}`.slice(0, 32),
    channel: i % 2 === 0 ? ('email' as const) : ('sms' as const),
    points: (i % 5) * 10 + 10,
    createdAt: iso(20 + i),
    lastEarnedAt: iso(Math.floor(random() * 15)),
  }));

  // ---- Abonnements et factures -------------------------------------------
  // Chaque établissement illustre un état de facturation différent : à jour,
  // à jour, et une facture échue qui déclenche la relance.
  const subscriptions: Subscription[] = establishments.map((establishment, index) => {
    const startedAt = iso(index === 2 ? 90 : 400);
    // La période en cours court jusqu'à l'anniversaire mensuel à venir.
    let periodStart = startedAt;
    while (new Date(addMonths(periodStart, 1)).getTime() < now.getTime()) {
      periodStart = addMonths(periodStart, 1);
    }
    return {
      id: `sub_${establishment.id}`,
      establishmentId: establishment.id,
      plan: establishment.plan,
      addons: establishment.addons,
      extraPlatforms: platformLinks.filter(
        (l) => l.establishmentId === establishment.id && l.platform !== 'google',
      ).length,
      tags: tags.filter((t) => t.establishmentId === establishment.id).length,
      committed12Months: establishment.committed12Months,
      status: 'active',
      startedAt,
      currentPeriodStart: periodStart,
      currentPeriodEnd: addMonths(periodStart, 1),
    };
  });

  const invoices: Invoice[] = [];
  let invoiceSeq = 0;
  for (const subscription of subscriptions) {
    // Trois dernières échéances : deux réglées, la plus récente ouverte.
    for (let back = 3; back >= 1; back -= 1) {
      invoiceSeq += 1;
      const periodStart = addMonths(subscription.currentPeriodStart, -back);
      const periodEnd = addMonths(periodStart, 1);
      const draft = buildInvoice({
        subscription,
        periodStart,
        periodEnd,
        sequence: invoiceSeq,
        issuedAt: periodStart,
        includeOneOff: false,
      });

      // Hôtel Garonne : dernière facture impayée, échue depuis dix jours.
      // Le retard est calé sur « maintenant » plutôt que sur la période, pour
      // que la démonstration montre une relance en cours — et non une
      // suspension déjà prononcée, qui ne dit rien du fonctionnement.
      const unpaid = subscription.establishmentId === 'est_hotel' && back === 1;
      invoices.push({
        ...draft,
        id: `inv_${invoiceSeq}`,
        status: unpaid ? 'open' : 'paid',
        ...(unpaid
          ? { issuedAt: iso(25), dueAt: iso(10), remindersSent: 1 }
          : { paidAt: new Date(new Date(draft.dueAt).getTime() - 86_400_000).toISOString() }),
      });
    }
  }

  const preferences: NotificationPreferences[] = establishments.map((e) =>
    DEFAULT_PREFERENCES(e.id),
  );

  // ---- Intégration caisse (Premium seulement) ----------------------------
  const posTickets: PosTicketRecord[] = Array.from({ length: 42 }, (_, i) => {
    const hasContact = random() < 0.45;
    const closedAt = iso(Math.floor(random() * 28), 12 + Math.floor(random() * 9));
    return {
      id: `pos_${i}`,
      establishmentId: 'est_comptoir',
      externalId: `TCK-${4200 + i}`,
      closedAt,
      totalCents: 1800 + Math.floor(random() * 7000),
      ...(hasContact
        ? {
            contactHash: hashContact(`client${i}@exemple.fr`, 'demo-salt'),
            contactChannel: 'email' as const,
            invitedAt: closedAt,
          }
        : {}),
      reference: `Table ${1 + Math.floor(random() * 18)}`,
      createdAt: closedAt,
    };
  });

  const posCredentials: PosCredentialRecord[] = [
    {
      establishmentId: 'est_comptoir',
      vendor: 'generic',
      // Condensat de la clé de démonstration « demo-pos-secret ».
      secretHash: hashContact('demo-pos-secret', 'pos'),
      createdAt: iso(60),
      lastUsedAt: iso(0),
    },
  ];

  return {
    managers,
    establishments,
    platformLinks,
    tags,
    reviews,
    scans,
    alerts,
    loyalty,
    subscriptions,
    invoices,
    preferences,
    posTickets,
    posCredentials,
  };

  // ---- Fabriques ---------------------------------------------------------
  function link(
    establishmentId: string,
    platform: PlatformId,
    reviewUrl: string,
    reviewCount: number,
    averageRating?: number,
    enabled = true,
  ): PlatformLink {
    return {
      establishmentId,
      platform,
      reviewUrl,
      enabled,
      reviewCount,
      routedScans: 0,
      ...(averageRating == null ? {} : { averageRating }),
    };
  }

  function tag(
    id: string,
    establishmentId: string,
    label: string,
    slug: string,
    material: NfcTag['material'],
    scanCount: number,
  ): NfcTag {
    return {
      id,
      establishmentId,
      label,
      slug,
      material,
      scanCount,
      createdAt: iso(120),
      lastScanAt: iso(Math.floor(random() * 3)),
    };
  }

  function makeReview(input: {
    id: string;
    establishmentId: string;
    platform: PlatformId;
    rating: number;
    comment: string;
    publishedAt: string;
    answered: boolean;
  }): Review {
    const analysis = heuristicAnalysis(input.comment, input.rating);
    const publishedMs = new Date(input.publishedAt).getTime();
    return {
      id: input.id,
      establishmentId: input.establishmentId,
      platform: input.platform,
      externalId: `${input.platform}_${input.id}`,
      author: pick(random, AUTHORS),
      rating: input.rating,
      comment: input.comment,
      publishedAt: input.publishedAt,
      ingestedAt: new Date(publishedMs + 15 * 60_000).toISOString(),
      status: input.answered ? 'answered' : 'new',
      analysis,
      ...(input.answered
        ? {
            replyText:
              'Merci beaucoup pour votre retour, il compte pour toute l’équipe. Au plaisir de vous revoir très vite.',
            repliedAt: new Date(publishedMs + 20 * 3_600_000).toISOString(),
          }
        : {}),
    };
  }
}

const AUTHORS = [
  'Julien M.',
  'Sarah B.',
  'Thomas L.',
  'Inès K.',
  'Marc D.',
  'Claire P.',
  'Ahmed T.',
  'Sophie R.',
  'Lucas V.',
  'Nadia C.',
  'Pierre G.',
  'Emma S.',
] as const;
