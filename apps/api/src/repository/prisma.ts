/**
 * Adaptateur PostgreSQL (Prisma).
 *
 * Note d'implémentation : le client Prisma est chargé dynamiquement et typé
 * ici par une interface structurelle minimale. Raison : `@prisma/client` n'est
 * typé qu'après `prisma generate`, qui exige une DATABASE_URL. Avec ce
 * découplage, `tsc` et la suite de tests tournent sur une machine qui n'a
 * jamais vu la base — ce qui est exactement le cas de l'environnement de démo.
 */

import { formatInvoiceNumber } from '@avisio/core';
import type {
  Alert,
  Establishment,
  Invoice,
  LoyaltyMember,
  Manager,
  NfcTag,
  NotificationPreferences,
  PlatformLink,
  Review,
  ScanEvent,
  Subscription,
  ThemeId,
} from '@avisio/core';
import type {
  GoogleConnectionRecord,
  PendingPushRecord,
  PosCredentialRecord,
  PosTicketRecord,
  PushSubscriptionRecord,
  Repository,
  ReviewQuery,
} from './types.js';

type Row = Record<string, unknown>;

interface Delegate {
  findFirst(args: Row): Promise<Row | null>;
  findMany(args?: Row): Promise<Row[]>;
  findUnique(args: Row): Promise<Row | null>;
  create(args: Row): Promise<Row>;
  update(args: Row): Promise<Row>;
  upsert(args: Row): Promise<Row>;
  delete(args: Row): Promise<Row>;
  deleteMany(args?: Row): Promise<{ count: number }>;
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
  subscription: Delegate;
  invoice: Delegate;
  invoiceCounter: Delegate;
  pushSubscription: Delegate;
  notificationPreference: Delegate;
  pendingPush: Delegate;
  posTicket: Delegate;
  posCredential: Delegate;
  googleConnection: Delegate;
  rateCounter: Delegate;
  /** Réservation atomique du numéro de facture : séquence sans trou. */
  $transaction<T>(fn: (tx: PrismaLike) => Promise<T>): Promise<T>;
  /**
   * SQL brut, réservé à l'incrément de la limitation de débit : `upsert`
   * ferait deux allers-retours et laisserait deux requêtes simultanées se
   * compter une seule fois. `ON CONFLICT DO UPDATE` est atomique côté serveur.
   */
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
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
      async listAll() {
        const rows = await db.manager.findMany({
          include: { establishments: { select: { id: true } } },
        });
        return rows.map(toManager);
      },
      async update(id, patch) {
        const row = await db.manager.update({
          where: { id },
          data: stripUndefined({
            name: patch.name,
            email: patch.email?.toLowerCase(),
            passwordHash: patch.passwordHash,
            role: patch.role,
            ...(patch.establishmentIds
              ? { establishments: { set: patch.establishmentIds.map((eid) => ({ id: eid })) } }
              : {}),
          }),
          include: { establishments: { select: { id: true } } },
        });
        return toManager(row);
      },
      async create(manager) {
        const row = await db.manager.create({
          data: {
            id: manager.id,
            email: manager.email.toLowerCase(),
            passwordHash: manager.passwordHash,
            name: manager.name,
            role: manager.role,
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
      async findById(id) {
        const row = await db.alert.findUnique({ where: { id } });
        return row ? toAlert(row) : null;
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

    subscriptions: {
      async create(subscription) {
        const row = await db.subscription.create({ data: fromSubscription(subscription) });
        return toSubscription(row);
      },
      async findByEstablishment(establishmentId) {
        const row = await db.subscription.findUnique({ where: { establishmentId } });
        return row ? toSubscription(row) : null;
      },
      async findById(id) {
        const row = await db.subscription.findUnique({ where: { id } });
        return row ? toSubscription(row) : null;
      },
      async listAll() {
        const rows = await db.subscription.findMany({});
        return rows.map(toSubscription);
      },
      async listDue(now) {
        const rows = await db.subscription.findMany({
          where: {
            status: { in: ['active', 'past_due', 'trialing'] },
            currentPeriodEnd: { lte: new Date(now) },
          },
        });
        return rows.map(toSubscription);
      },
      async update(id, patch) {
        const row = await db.subscription.update({
          where: { id },
          data: stripUndefined({
            plan: patch.plan,
            addons: patch.addons,
            extraPlatforms: patch.extraPlatforms,
            tags: patch.tags,
            committed12Months: patch.committed12Months,
            status: patch.status,
            currentPeriodStart: patch.currentPeriodStart
              ? new Date(patch.currentPeriodStart)
              : undefined,
            currentPeriodEnd: patch.currentPeriodEnd ? new Date(patch.currentPeriodEnd) : undefined,
            cancelAt: patch.cancelAt ? new Date(patch.cancelAt) : undefined,
            canceledAt: patch.canceledAt ? new Date(patch.canceledAt) : undefined,
          }),
        });
        return toSubscription(row);
      },
    },

    invoices: {
      /**
       * Le numéro est réservé dans la même transaction que l'insertion : deux
       * facturations concurrentes ne peuvent pas produire de trou ni de
       * doublon dans la séquence légale.
       */
      async create(invoice, year) {
        return db.$transaction(async (tx) => {
          const counter = await tx.invoiceCounter.upsert({
            where: { year },
            create: { year, sequence: 1 },
            update: { sequence: { increment: 1 } },
          });
          const sequence = Number(counter.sequence);
          const row = await tx.invoice.create({
            data: {
              ...fromInvoice(invoice),
              id: `inv_${year}_${sequence}`,
              number: formatInvoiceNumber(year, sequence),
            },
          });
          return toInvoice(row);
        });
      },
      async findById(id) {
        const row = await db.invoice.findUnique({ where: { id } });
        return row ? toInvoice(row) : null;
      },
      async listByEstablishment(establishmentId) {
        const rows = await db.invoice.findMany({
          where: { establishmentId },
          orderBy: { issuedAt: 'desc' },
        });
        return rows.map(toInvoice);
      },
      async listAll() {
        const rows = await db.invoice.findMany({});
        return rows.map(toInvoice);
      },
      async listOverdue(now) {
        const rows = await db.invoice.findMany({
          where: { status: 'open', dueAt: { lt: new Date(now) } },
        });
        return rows.map(toInvoice);
      },
      async update(id, patch) {
        const row = await db.invoice.update({
          where: { id },
          data: stripUndefined({
            status: patch.status,
            paidAt: patch.paidAt ? new Date(patch.paidAt) : undefined,
            paymentReference: patch.paymentReference,
            remindersSent: patch.remindersSent,
          }),
        });
        return toInvoice(row);
      },
    },

    push: {
      async subscribe(record) {
        const data = {
          managerId: record.managerId,
          p256dh: record.p256dh,
          auth: record.auth,
          userAgent: record.userAgent ?? null,
        };
        const row = await db.pushSubscription.upsert({
          where: { endpoint: record.endpoint },
          create: { id: record.id, endpoint: record.endpoint, ...data },
          update: data,
        });
        return toPushSubscription(row);
      },
      async listByManager(managerId) {
        const rows = await db.pushSubscription.findMany({ where: { managerId } });
        return rows.map(toPushSubscription);
      },
      async unsubscribe(endpoint) {
        await db.pushSubscription.deleteMany({ where: { endpoint } });
      },
      async queue(record) {
        const row = await db.pendingPush.create({
          data: {
            id: record.id,
            managerId: record.managerId,
            title: record.title,
            body: record.body,
            url: record.url ?? null,
            sendAt: new Date(record.sendAt),
            createdAt: new Date(record.createdAt),
          },
        });
        return toPendingPush(row);
      },
      async listQueued(now) {
        const rows = await db.pendingPush.findMany({
          where: { sentAt: null, sendAt: { lte: new Date(now) } },
        });
        return rows.map(toPendingPush);
      },
      async markSent(id, at) {
        await db.pendingPush.update({ where: { id }, data: { sentAt: new Date(at) } });
      },
    },

    notificationPreferences: {
      async get(establishmentId) {
        const row = await db.notificationPreference.findUnique({ where: { establishmentId } });
        return row ? toPreferences(row) : null;
      },
      async upsert(value) {
        const data = {
          channels: value.channels,
          quietHoursStart: value.quietHours?.start ?? null,
          quietHoursEnd: value.quietHours?.end ?? null,
          utcOffsetHours: value.utcOffsetHours,
        };
        const row = await db.notificationPreference.upsert({
          where: { establishmentId: value.establishmentId },
          create: { establishmentId: value.establishmentId, ...data },
          update: data,
        });
        return toPreferences(row);
      },
    },

    pos: {
      async findTicket(establishmentId, externalId) {
        const row = await db.posTicket.findUnique({
          where: { establishmentId_externalId: { establishmentId, externalId } },
        });
        return row ? toPosTicket(row) : null;
      },
      async createTicket(ticket) {
        const row = await db.posTicket.create({
          data: {
            id: ticket.id,
            establishmentId: ticket.establishmentId,
            externalId: ticket.externalId,
            closedAt: new Date(ticket.closedAt),
            totalCents: ticket.totalCents,
            contactHash: ticket.contactHash ?? null,
            contactChannel: ticket.contactChannel ?? null,
            reference: ticket.reference ?? null,
            invitedAt: ticket.invitedAt ? new Date(ticket.invitedAt) : null,
            createdAt: new Date(ticket.createdAt),
          },
        });
        return toPosTicket(row);
      },
      async listTickets(establishmentId, since) {
        const rows = await db.posTicket.findMany({
          where: {
            establishmentId,
            ...(since ? { closedAt: { gte: new Date(since) } } : {}),
          },
          orderBy: { closedAt: 'desc' },
        });
        return rows.map(toPosTicket);
      },
      async markInvited(id, at) {
        await db.posTicket.update({ where: { id }, data: { invitedAt: new Date(at) } });
      },
      async lastInvitedAt(establishmentId, contactHash) {
        const row = await db.posTicket.findFirst({
          where: { establishmentId, contactHash, invitedAt: { not: null } },
          orderBy: { invitedAt: 'desc' },
        });
        return row?.invitedAt ? iso(row.invitedAt) : undefined;
      },
      async getCredential(establishmentId) {
        const row = await db.posCredential.findUnique({ where: { establishmentId } });
        return row ? toPosCredential(row) : null;
      },
      async upsertCredential(credential) {
        const data = { vendor: credential.vendor, secretHash: credential.secretHash };
        const row = await db.posCredential.upsert({
          where: { establishmentId: credential.establishmentId },
          create: { establishmentId: credential.establishmentId, ...data },
          update: data,
        });
        return toPosCredential(row);
      },
      async touchCredential(establishmentId, at) {
        await db.posCredential.update({
          where: { establishmentId },
          data: { lastUsedAt: new Date(at) },
        });
      },
    },

    googleConnections: {
      async get(establishmentId) {
        const row = await db.googleConnection.findUnique({ where: { establishmentId } });
        return row ? toGoogleConnection(row) : null;
      },
      async upsert(record) {
        const data = {
          refreshTokenSealed: record.refreshTokenSealed,
          scope: record.scope,
          locationName: record.locationName ?? null,
          locationTitle: record.locationTitle ?? null,
          authorizedBy: record.authorizedBy ?? null,
          connectedAt: new Date(record.connectedAt),
          lastSyncAt: record.lastSyncAt ? new Date(record.lastSyncAt) : null,
          lastError: record.lastError ?? null,
        };
        const row = await db.googleConnection.upsert({
          where: { establishmentId: record.establishmentId },
          create: { establishmentId: record.establishmentId, ...data },
          update: data,
        });
        return toGoogleConnection(row);
      },
      async update(establishmentId, patch) {
        const row = await db.googleConnection.update({
          where: { establishmentId },
          data: stripUndefined({
            refreshTokenSealed: patch.refreshTokenSealed,
            scope: patch.scope,
            // `null` est significatif ici : il efface la sélection ou l'erreur.
            locationName: 'locationName' in patch ? (patch.locationName ?? null) : undefined,
            locationTitle: 'locationTitle' in patch ? (patch.locationTitle ?? null) : undefined,
            lastSyncAt: patch.lastSyncAt ? new Date(patch.lastSyncAt) : undefined,
            lastError: 'lastError' in patch ? (patch.lastError ?? null) : undefined,
          }),
        });
        return toGoogleConnection(row);
      },
      async remove(establishmentId) {
        await db.googleConnection.deleteMany({ where: { establishmentId } });
      },
      async listAll() {
        return (await db.googleConnection.findMany()).map(toGoogleConnection);
      },
    },

    rateLimit: {
      async hit(key, expiresAt) {
        // Un `upsert` Prisma ferait un SELECT puis un INSERT/UPDATE : deux
        // requêtes concurrentes liraient le même compteur et n'en
        // enregistreraient qu'une. `ON CONFLICT DO UPDATE` règle l'incrément
        // dans le moteur, en une seule instruction atomique.
        const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(
          `INSERT INTO rate_counters (key, count, "expiresAt")
           VALUES ($1, 1, $2)
           ON CONFLICT (key) DO UPDATE SET count = rate_counters.count + 1
           RETURNING count`,
          key,
          new Date(expiresAt),
        );
        const count = Number(rows[0]?.count ?? 1);

        // Balayage opportuniste des fenêtres périmées : une fois sur deux
        // cents, ce qui suffit à borner la table sans tâche planifiée.
        if (Math.random() < 0.005) {
          await db
            .$executeRawUnsafe(`DELETE FROM rate_counters WHERE "expiresAt" < NOW()`)
            .catch(() => 0);
        }
        return count;
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
    role: (row.role as Manager['role']) ?? 'owner',
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
    source: (row.source as Review['source']) ?? 'sync',
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
    source: review.source ?? 'sync',
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

function toSubscription(row: Row): Subscription {
  const subscription: Subscription = {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    plan: row.plan as Subscription['plan'],
    addons: (row.addons as Subscription['addons']) ?? [],
    extraPlatforms: Number(row.extraPlatforms ?? 0),
    tags: Number(row.tags ?? 1),
    committed12Months: Boolean(row.committed12Months),
    status: row.status as Subscription['status'],
    startedAt: iso(row.startedAt),
    currentPeriodStart: iso(row.currentPeriodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
  };
  const trialEndsAt = optionalIso(row.trialEndsAt);
  if (trialEndsAt) subscription.trialEndsAt = trialEndsAt;
  const cancelAt = optionalIso(row.cancelAt);
  if (cancelAt) subscription.cancelAt = cancelAt;
  const canceledAt = optionalIso(row.canceledAt);
  if (canceledAt) subscription.canceledAt = canceledAt;
  return subscription;
}

const fromSubscription = (subscription: Subscription): Row => ({
  id: subscription.id,
  establishmentId: subscription.establishmentId,
  plan: subscription.plan,
  addons: subscription.addons,
  extraPlatforms: subscription.extraPlatforms,
  tags: subscription.tags,
  committed12Months: subscription.committed12Months,
  status: subscription.status,
  startedAt: new Date(subscription.startedAt),
  currentPeriodStart: new Date(subscription.currentPeriodStart),
  currentPeriodEnd: new Date(subscription.currentPeriodEnd),
  trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
  cancelAt: subscription.cancelAt ? new Date(subscription.cancelAt) : null,
  canceledAt: subscription.canceledAt ? new Date(subscription.canceledAt) : null,
});

function toInvoice(row: Row): Invoice {
  const invoice: Invoice = {
    id: String(row.id),
    number: String(row.number),
    establishmentId: String(row.establishmentId),
    subscriptionId: String(row.subscriptionId),
    status: row.status as Invoice['status'],
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    issuedAt: iso(row.issuedAt),
    dueAt: iso(row.dueAt),
    lines: (row.lines as Invoice['lines']) ?? [],
    subtotalCents: Number(row.subtotalCents ?? 0),
    vatCents: Number(row.vatCents ?? 0),
    totalCents: Number(row.totalCents ?? 0),
    remindersSent: Number(row.remindersSent ?? 0),
  };
  const paidAt = optionalIso(row.paidAt);
  if (paidAt) invoice.paidAt = paidAt;
  if (row.paymentReference) invoice.paymentReference = String(row.paymentReference);
  return invoice;
}

const fromInvoice = (invoice: Omit<Invoice, 'id' | 'number'>): Row => ({
  establishmentId: invoice.establishmentId,
  subscriptionId: invoice.subscriptionId,
  status: invoice.status,
  periodStart: new Date(invoice.periodStart),
  periodEnd: new Date(invoice.periodEnd),
  issuedAt: new Date(invoice.issuedAt),
  dueAt: new Date(invoice.dueAt),
  paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
  lines: invoice.lines,
  subtotalCents: invoice.subtotalCents,
  vatCents: invoice.vatCents,
  totalCents: invoice.totalCents,
  paymentReference: invoice.paymentReference ?? null,
  remindersSent: invoice.remindersSent,
});

function toPushSubscription(row: Row): PushSubscriptionRecord {
  return {
    id: String(row.id),
    managerId: String(row.managerId),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    ...(row.userAgent ? { userAgent: String(row.userAgent) } : {}),
    createdAt: iso(row.createdAt),
    ...(row.lastUsedAt ? { lastUsedAt: iso(row.lastUsedAt) } : {}),
  };
}

function toPendingPush(row: Row): PendingPushRecord {
  return {
    id: String(row.id),
    managerId: String(row.managerId),
    title: String(row.title),
    body: String(row.body),
    ...(row.url ? { url: String(row.url) } : {}),
    sendAt: iso(row.sendAt),
    ...(row.sentAt ? { sentAt: iso(row.sentAt) } : {}),
    createdAt: iso(row.createdAt),
  };
}

function toPreferences(row: Row): NotificationPreferences {
  const start = row.quietHoursStart;
  const end = row.quietHoursEnd;
  return {
    establishmentId: String(row.establishmentId),
    channels: row.channels as NotificationPreferences['channels'],
    quietHours:
      start == null || end == null ? null : { start: Number(start), end: Number(end) },
    utcOffsetHours: Number(row.utcOffsetHours ?? 2),
  };
}

function toPosTicket(row: Row): PosTicketRecord {
  return {
    id: String(row.id),
    establishmentId: String(row.establishmentId),
    externalId: String(row.externalId),
    closedAt: iso(row.closedAt),
    totalCents: Number(row.totalCents ?? 0),
    ...(row.contactHash ? { contactHash: String(row.contactHash) } : {}),
    ...(row.contactChannel
      ? { contactChannel: row.contactChannel as 'email' | 'sms' }
      : {}),
    ...(row.reference ? { reference: String(row.reference) } : {}),
    ...(row.invitedAt ? { invitedAt: iso(row.invitedAt) } : {}),
    createdAt: iso(row.createdAt),
  };
}

function toGoogleConnection(row: Row): GoogleConnectionRecord {
  return {
    establishmentId: String(row.establishmentId),
    refreshTokenSealed: String(row.refreshTokenSealed),
    scope: String(row.scope ?? ''),
    ...(row.locationName ? { locationName: String(row.locationName) } : {}),
    ...(row.locationTitle ? { locationTitle: String(row.locationTitle) } : {}),
    ...(row.authorizedBy ? { authorizedBy: String(row.authorizedBy) } : {}),
    connectedAt: iso(row.connectedAt),
    ...(row.lastSyncAt ? { lastSyncAt: iso(row.lastSyncAt) } : {}),
    ...(row.lastError ? { lastError: String(row.lastError) } : {}),
  };
}

function toPosCredential(row: Row): PosCredentialRecord {
  return {
    establishmentId: String(row.establishmentId),
    vendor: String(row.vendor ?? 'generic'),
    secretHash: String(row.secretHash),
    createdAt: iso(row.createdAt),
    ...(row.lastUsedAt ? { lastUsedAt: iso(row.lastUsedAt) } : {}),
  };
}

const stripUndefined = (obj: Row): Row =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
