/**
 * Adaptateur PostgreSQL (Prisma).
 *
 * Note d'implémentation : le client Prisma est chargé dynamiquement et typé
 * ici par une interface structurelle minimale. Raison : `@prisma/client` n'est
 * typé qu'après `prisma generate`, qui exige une DATABASE_URL. Avec ce
 * découplage, `tsc` et la suite de tests tournent sur une machine qui n'a
 * jamais vu la base — ce qui est exactement le cas de l'environnement de démo.
 */

import type {
  Alert,
  Establishment,
  LoyaltyMember,
  Manager,
  NfcTag,
  PlatformLink,
  Review,
  ScanEvent,
  ThemeId,
} from '@avisio/core';
import type { Repository, ReviewQuery } from './types.js';

type Row = Record<string, unknown>;

interface Delegate {
  findFirst(args: Row): Promise<Row | null>;
  findMany(args?: Row): Promise<Row[]>;
  findUnique(args: Row): Promise<Row | null>;
  create(args: Row): Promise<Row>;
  update(args: Row): Promise<Row>;
  upsert(args: Row): Promise<Row>;
  count(args?: Row): Promise<number>;
}

interface PrismaLike {
  manager: Delegate;
  establishment: Delegate;
  platformLink: Delegate;
  nfcTag: Delegate;
  scanEvent: Delegate;
  review: Delegate;
  alert: Delegate;
  loyaltyMember: Delegate;
  $disconnect(): Promise<void>;
}

export async function createPrismaRepository(): Promise<Repository> {
  const mod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => PrismaLike;
  };
  const db = new mod.PrismaClient();

  return {
    kind: 'prisma',

    managers: {
      async findByEmail(email) {
        const row = await db.manager.findUnique({
          where: { email: email.trim().toLowerCase() },
          include: { establishments: { select: { id: true } } },
        });
        return row ? toManager(row) : null;
      },
      async findById(id) {
        const row = await db.manager.findUnique({
          where: { id },
          include: { establishments: { select: { id: true } } },
        });
        return row ? toManager(row) : null;
      },
      async listByEstablishment(establishmentId) {
        const rows = await db.manager.findMany({
          where: { establishments: { some: { id: establishmentId } } },
          include: { establishments: { select: { id: true } } },
        });
        return rows.map(toManager);
      },
      async create(manager) {
        const row = await db.manager.create({
          data: {
            id: manager.id,
            email: manager.email.toLowerCase(),
            passwordHash: manager.passwordHash,
            name: manager.name,
            createdAt: new Date(manager.createdAt),
            establishments: { connect: manager.establishmentIds.map((id) => ({ id })) },
          },
          include: { establishments: { select: { id: true } } },
        });
        return toManager(row);
      },
    },

    establishments: {
      async create(establishment) {
        const row = await db.establishment.create({
          data: {
            id: establishment.id,
            name: establishment.name,
            sector: establishment.sector,
            postalCode: establishment.postalCode,
            nafCode: establishment.nafCode ?? null,
            plan: establishment.plan,
            addons: establishment.addons,
            committed12Months: establishment.committed12Months,
            brandTone: establishment.brandTone,
            defaultLocale: establishment.defaultLocale,
            createdAt: new Date(establishment.createdAt),
          },
        });
        return toEstablishment(row);
      },
      async findById(id) {
        const row = await db.establishment.findUnique({ where: { id } });
        return row ? toEstablishment(row) : null;
      },
      async listByIds(ids) {
        const rows = await db.establishment.findMany({ where: { id: { in: ids } } });
        return rows.map(toEstablishment);
      },
      async listAll() {
        const rows = await db.establishment.findMany({});
        return rows.map(toEstablishment);
      },
      async update(id, patch) {
        const row = await db.establishment.update({
          where: { id },
          data: stripUndefined({
            name: patch.name,
            sector: patch.sector,
            postalCode: patch.postalCode,
            nafCode: patch.nafCode,
            plan: patch.plan,
            addons: patch.addons,
            committed12Months: patch.committed12Months,
            brandTone: patch.brandTone,
            defaultLocale: patch.defaultLocale,
          }),
        });
        return toEstablishment(row);
      },
    },

    platformLinks: {
      async listByEstablishment(establishmentId) {
        const rows = await db.platformLink.findMany({ where: { establishmentId } });
        return rows.map(toPlatformLink);
      },
      async upsert(link) {
        const data = {
          establishmentId: link.establishmentId,
          platform: link.platform,
          reviewUrl: link.reviewUrl,
          externalId: link.externalId ?? null,
          enabled: link.enabled,
          reviewCount: link.reviewCount,
          routedScans: link.routedScans,
          averageRating: link.averageRating ?? null,
        };
        const row = await db.platformLink.upsert({
          where: {
            establishmentId_platform: {
              establishmentId: link.establishmentId,
              platform: link.platform,
            },
          },
          create: data,
          update: data,
        });
        return toPlatformLink(row);
      },
      async incrementRoutedScans(establishmentId, platform) {
        await db.platformLink.update({
          where: { establishmentId_platform: { establishmentId, platform } },
          data: { routedScans: { increment: 1 } },
        });
      },
      async syncCounts(establishmentId, platform, counts) {
        await db.platformLink.update({
          where: { establishmentId_platform: { establishmentId, platform } },
          data: stripUndefined({
            reviewCount: counts.reviewCount,
            averageRating: counts.averageRating,
            routedScans: 0,
            lastSyncedAt: new Date(),
          }),
        });
      },
    },

    tags: {
      async findBySlug(slug) {
        const row = await db.nfcTag.findUnique({ where: { slug } });
        return row ? toTag(row) : null;
      },
      async listByEstablishment(establishmentId) {
        const rows = await db.nfcTag.findMany({ where: { establishmentId } });
        return rows.map(toTag);
      },
      async create(tag) {
        const row = await db.nfcTag.create({
          data: {
            id: tag.id,
            establishmentId: tag.establishmentId,
            label: tag.label,
            slug: tag.slug,
            material: tag.material,
            scanCount: tag.scanCount,
            createdAt: new Date(tag.createdAt),
          },
        });
        return toTag(row);
      },
      async recordScan(tagId, at) {
        await db.nfcTag.update({
          where: { id: tagId },
          data: { scanCount: { increment: 1 }, lastScanAt: new Date(at) },
        });
      },
    },

    scans: {
      async create(scan) {
        const row = await db.scanEvent.create({
          data: {
            id: scan.id,
            tagId: scan.tagId,
            establishmentId: scan.establishmentId,
            platform: scan.platform,
            locale: scan.locale,
            userAgent: scan.userAgent ?? null,
            createdAt: new Date(scan.createdAt),
          },
        });
        return toScan(row);
      },
      async listByEstablishment(establishmentId, since) {
        const rows = await db.scanEvent.findMany({
          where: {
            establishmentId,
            ...(since ? { createdAt: { gte: new Date(since) } } : {}),
          },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map(toScan);
      },
    },

    reviews: {
      async query(query: ReviewQuery) {
        const rows = await db.review.findMany({
          where: stripUndefined({
            establishmentId: query.establishmentId,
            status: query.status,
            rating: query.maxRating == null ? undefined : { lte: query.maxRating },
            publishedAt: query.since ? { gte: new Date(query.since) } : undefined,
          }),
          orderBy: { publishedAt: 'desc' },
          take: query.limit ?? 200,
        });
        return rows.map(toReview);
      },
      async findById(id) {
        const row = await db.review.findUnique({ where: { id } });
        return row ? toReview(row) : null;
      },
      async upsertMany(incoming) {
        const created: Review[] = [];
        for (const review of incoming) {
          const existing = await db.review.findUnique({
            where: {
              establishmentId_platform_externalId: {
                establishmentId: review.establishmentId,
                platform: review.platform,
                externalId: review.externalId,
              },
            },
          });
          if (existing) continue;
          const row = await db.review.create({ data: fromReview(review) });
          created.push(toReview(row));
        }
        return created;
      },
      async update(id, patch) {
        const row = await db.review.update({
          where: { id },
          data: stripUndefined({
            status: patch.status,
            replyText: patch.replyText,
            repliedAt: patch.repliedAt ? new Date(patch.repliedAt) : undefined,
            sentiment: patch.analysis?.sentiment,
            sentimentScore: patch.analysis?.score,
            themes: patch.analysis?.themes,
            keywords: patch.analysis?.keywords,
            language: patch.analysis?.language,
            analysisEngine: patch.analysis?.engine,
          }),
        });
        return toReview(row);
      },
      async listAll() {
        const rows = await db.review.findMany({});
        return rows.map(toReview);
      },
    },

    alerts: {
      async create(alert) {
        const row = await db.alert.create({
          data: {
            id: alert.id,
            establishmentId: alert.establishmentId,
            type: alert.type,
            severity: alert.severity,
            title: alert.title,
            body: alert.body,
            reviewId: alert.reviewId ?? null,
            createdAt: new Date(alert.createdAt),
          },
        });
        return toAlert(row);
      },
      async listByEstablishment(establishmentId, limit = 50) {
        const rows = await db.alert.findMany({
          where: { establishmentId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return rows.map(toAlert);
      },
      async markRead(id, at) {
        await db.alert.update({ where: { id }, data: { readAt: new Date(at) } });
      },
      async existsSince(establishmentId, type, title, since) {
        const row = await db.alert.findFirst({
          where: { establishmentId, type, title, createdAt: { gte: new Date(since) } },
        });
        return row != null;
      },
    },

    loyalty: {
      async findByContactHash(establishmentId, contactHash) {
        const row = await db.loyaltyMember.findUnique({
          where: { establishmentId_contactHash: { establishmentId, contactHash } },
        });
        return row ? toLoyalty(row) : null;
      },
      async create(member) {
        const row = await db.loyaltyMember.create({
          data: {
            id: member.id,
            establishmentId: member.establishmentId,
            contactHash: member.contactHash,
            channel: member.channel,
            points: member.points,
            createdAt: new Date(member.createdAt),
            lastEarnedAt: member.lastEarnedAt ? new Date(member.lastEarnedAt) : null,
          },
        });
        return toLoyalty(row);
      },
      async update(id, patch) {
        const row = await db.loyaltyMember.update({
          where: { id },
          data: stripUndefined({
            points: patch.points,
            lastEarnedAt: patch.lastEarnedAt ? new Date(patch.lastEarnedAt) : undefined,
          }),
        });
        return toLoyalty(row);
      },
      async countByEstablishment(establishmentId) {
        return db.loyaltyMember.count({ where: { establishmentId } });
      },
    },

    async close() {
      await db.$disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Mappers ligne SQL -> domaine
// ---------------------------------------------------------------------------

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const optionalIso = (value: unknown): string | undefined =>
  value == null ? undefined : iso(value);

function toManager(row: Row): Manager {
  const establishments = (row.establishments as Array<{ id: string }> | undefined) ?? [];
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.passwordHash),
    name: String(row.name),
    establishmentIds: establishments.map((e) => e.id),
    createdAt: iso(row.createdAt),
  };
}

function toEstablishment(row: Row): Establishment {
  return {
    id: String(row.id),
    name: String(row.name),
    sector: row.sector as Establishment['sector'],
    postalCode: String(row.postalCode),
    ...(row.nafCode ? { nafCode: String(row.nafCode) } : {}),
    plan: row.plan as Establishment['plan'],
    addons: (row.addons as Establishment['addons']) ?? [],
    committed12Months: Boolean(row.committed12Months),
    brandTone: String(row.brandTone),
    defaultLocale: row.defaultLocale as Establishment['defaultLocale'],
    createdAt: iso(row.createdAt),
  };
}

function toPlatformLink(row: Row): PlatformLink {
  return {
    establishmentId: String(row.establishmentId),
    platform: row.platform as PlatformLink['platform'],
    reviewUrl: String(row.reviewUrl),
    ...(row.externalId ? { externalId: String(row.externalId) } : {}),
    enabled: Boolean(row.enabled),
    reviewCount: Number(row.reviewCount ?? 0),
    routedScans: Number(row.routedScans ?? 0),
    ...(row.averageRating == null ? {} : { averageRating: Number(row.averageRating) }),
  };
}

function toTag(row: Row): NfcTag {
  return {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    label: String(row.label),
    slug: String(row.slug),
    material: row.material as NfcTag['material'],
    scanCount: Number(row.scanCount ?? 0),
    createdAt: iso(row.createdAt),
    ...(row.lastScanAt ? { lastScanAt: iso(row.lastScanAt) } : {}),
  };
}

function toScan(row: Row): ScanEvent {
  return {
    id: String(row.id),
    tagId: String(row.tagId),
    establishmentId: String(row.establishmentId),
    platform: row.platform as ScanEvent['platform'],
    locale: row.locale as ScanEvent['locale'],
    ...(row.userAgent ? { userAgent: String(row.userAgent) } : {}),
    createdAt: iso(row.createdAt),
  };
}

function toReview(row: Row): Review {
  const review: Review = {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    platform: row.platform as Review['platform'],
    externalId: String(row.externalId),
    author: String(row.author),
    rating: Number(row.rating),
    comment: String(row.comment),
    publishedAt: iso(row.publishedAt),
    ingestedAt: iso(row.ingestedAt),
    status: row.status as Review['status'],
  };
  const replyText = row.replyText == null ? undefined : String(row.replyText);
  if (replyText) review.replyText = replyText;
  const repliedAt = optionalIso(row.repliedAt);
  if (repliedAt) review.repliedAt = repliedAt;
  if (row.sentiment) {
    review.analysis = {
      sentiment: row.sentiment as 'positive' | 'neutral' | 'negative',
      score: Number(row.sentimentScore ?? 0),
      themes: ((row.themes as string[]) ?? []) as ThemeId[],
      keywords: (row.keywords as string[]) ?? [],
      language: String(row.language ?? 'fr'),
      engine: (row.analysisEngine as 'llm' | 'heuristic') ?? 'heuristic',
    };
  }
  return review;
}

function fromReview(review: Review): Row {
  return {
    id: review.id,
    establishmentId: review.establishmentId,
    platform: review.platform,
    externalId: review.externalId,
    author: review.author,
    rating: review.rating,
    comment: review.comment,
    publishedAt: new Date(review.publishedAt),
    ingestedAt: new Date(review.ingestedAt),
    status: review.status,
    replyText: review.replyText ?? null,
    repliedAt: review.repliedAt ? new Date(review.repliedAt) : null,
    sentiment: review.analysis?.sentiment ?? null,
    sentimentScore: review.analysis?.score ?? null,
    themes: review.analysis?.themes ?? [],
    keywords: review.analysis?.keywords ?? [],
    language: review.analysis?.language ?? null,
    analysisEngine: review.analysis?.engine ?? null,
  };
}

function toAlert(row: Row): Alert {
  return {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    type: row.type as Alert['type'],
    severity: row.severity as Alert['severity'],
    title: String(row.title),
    body: String(row.body),
    ...(row.reviewId ? { reviewId: String(row.reviewId) } : {}),
    createdAt: iso(row.createdAt),
    ...(row.readAt ? { readAt: iso(row.readAt) } : {}),
  };
}

function toLoyalty(row: Row): LoyaltyMember {
  return {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    contactHash: String(row.contactHash),
    channel: row.channel as LoyaltyMember['channel'],
    points: Number(row.points ?? 0),
    createdAt: iso(row.createdAt),
    ...(row.lastEarnedAt ? { lastEarnedAt: iso(row.lastEarnedAt) } : {}),
  };
}

const stripUndefined = (obj: Row): Row =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
