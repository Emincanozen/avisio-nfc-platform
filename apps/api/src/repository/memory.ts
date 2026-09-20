/**
 * Adaptateur mémoire.
 *
 * Sert deux usages : la démonstration commerciale (jeu de données chargé au
 * démarrage) et les tests d'intégration de l'API, qui tournent sans Docker.
 * Les données sont perdues au redémarrage — c'est assumé et annoncé au boot.
 */

import {
  formatInvoiceNumber,
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
import { buildDemoDataset } from '../demo-data.js';
import type {
  GoogleConnectionRecord,
  PendingPushRecord,
  PosCredentialRecord,
  PosTicketRecord,
  PushSubscriptionRecord,
  Repository,
  ReviewQuery,
} from './types.js';

export function createMemoryRepository(options: { seed?: boolean } = {}): Repository {
  const managers = new Map<string, Manager>();
  const establishments = new Map<string, Establishment>();
  const platformLinks = new Map<string, PlatformLink>(); // clé: estId:platform
  const tags = new Map<string, NfcTag>();
  const slugIndex = new Map<string, string>();
  const scans: ScanEvent[] = [];
  const reviews = new Map<string, Review>();
  const externalIndex = new Set<string>(); // clé: estId:platform:externalId
  const alerts: Alert[] = [];
  const loyalty = new Map<string, LoyaltyMember>();
  const subscriptions = new Map<string, Subscription>();
  const invoices = new Map<string, Invoice>();
  const invoiceCounters = new Map<number, number>();
  const pushSubscriptions = new Map<string, PushSubscriptionRecord>(); // clé: endpoint
  const pendingPushes = new Map<string, PendingPushRecord>();
  const preferences = new Map<string, NotificationPreferences>();
  const posTickets = new Map<string, PosTicketRecord>(); // clé: estId:externalId
  const posCredentials = new Map<string, PosCredentialRecord>();
  const googleConnections = new Map<string, GoogleConnectionRecord>();
  const rateCounters = new Map<string, { count: number; expiresAtMs: number }>();

  // Les identifiants générés à l'exécution doivent rester hors de portée de
  // ceux du jeu de démonstration (`inv_1`, `inv_2`…), sinon une facture créée
  // pendant la démo écrase silencieusement une facture amorcée.
  let sequence = 10_000;
  const nextId = (prefix: string): string => `${prefix}_${(sequence += 1)}`;

  if (options.seed !== false) {
    const demo = buildDemoDataset();
    for (const m of demo.managers) managers.set(m.id, m);
    for (const e of demo.establishments) establishments.set(e.id, e);
    for (const l of demo.platformLinks) platformLinks.set(linkKey(l.establishmentId, l.platform), l);
    for (const t of demo.tags) {
      tags.set(t.id, t);
      slugIndex.set(t.slug, t.id);
    }
    scans.push(...demo.scans);
    for (const r of demo.reviews) {
      reviews.set(r.id, r);
      externalIndex.add(extKey(r));
    }
    alerts.push(...demo.alerts);
    for (const m of demo.loyalty) loyalty.set(m.id, m);
    for (const s of demo.subscriptions) subscriptions.set(s.id, s);
    for (const i of demo.invoices) {
      invoices.set(i.id, i);
      const year = new Date(i.issuedAt).getUTCFullYear();
      const parsed = Number(i.number.slice(-6));
      invoiceCounters.set(year, Math.max(invoiceCounters.get(year) ?? 0, parsed));
    }
    for (const p of demo.preferences) preferences.set(p.establishmentId, p);
    for (const t of demo.posTickets) posTickets.set(ticketKey(t.establishmentId, t.externalId), t);
    for (const c of demo.posCredentials) posCredentials.set(c.establishmentId, c);
  }

  return {
    kind: 'memory',

    managers: {
      async findByEmail(email) {
        const normalized = email.trim().toLowerCase();
        return [...managers.values()].find((m) => m.email.toLowerCase() === normalized) ?? null;
      },
      async findById(id) {
        return managers.get(id) ?? null;
      },
      async listByEstablishment(establishmentId) {
        return [...managers.values()].filter((m) =>
          m.establishmentIds.includes(establishmentId),
        );
      },
      async listAll() {
        return [...managers.values()];
      },
      async create(manager) {
        managers.set(manager.id, manager);
        return manager;
      },
      async update(id, patch) {
        const current = managers.get(id);
        if (!current) throw new Error(`Gérant inconnu : ${id}`);
        const next = { ...current, ...patch, id };
        managers.set(id, next);
        return next;
      },
    },

    establishments: {
      async create(establishment) {
        establishments.set(establishment.id, establishment);
        return establishment;
      },
      async findById(id) {
        return establishments.get(id) ?? null;
      },
      async listByIds(ids) {
        return ids.map((id) => establishments.get(id)).filter((e): e is Establishment => Boolean(e));
      },
      async listAll() {
        return [...establishments.values()];
      },
      async update(id, patch) {
        const current = establishments.get(id);
        if (!current) throw new Error(`Établissement inconnu : ${id}`);
        const next = { ...current, ...patch, id };
        establishments.set(id, next);
        return next;
      },
    },

    platformLinks: {
      async listByEstablishment(establishmentId) {
        return [...platformLinks.values()].filter((l) => l.establishmentId === establishmentId);
      },
      async upsert(link) {
        platformLinks.set(linkKey(link.establishmentId, link.platform), link);
        return link;
      },
      async incrementRoutedScans(establishmentId, platform) {
        const key = linkKey(establishmentId, platform);
        const link = platformLinks.get(key);
        if (link) platformLinks.set(key, { ...link, routedScans: link.routedScans + 1 });
      },
      async syncCounts(establishmentId, platform, counts) {
        const key = linkKey(establishmentId, platform);
        const link = platformLinks.get(key);
        if (!link) return;
        platformLinks.set(key, {
          ...link,
          reviewCount: counts.reviewCount,
          // Les scans routés sont absorbés par le nouveau compteur officiel.
          routedScans: 0,
          ...(counts.averageRating == null ? {} : { averageRating: counts.averageRating }),
        });
      },
    },

    tags: {
      async findBySlug(slug) {
        const id = slugIndex.get(slug);
        return id ? (tags.get(id) ?? null) : null;
      },
      async listByEstablishment(establishmentId) {
        return [...tags.values()].filter((t) => t.establishmentId === establishmentId);
      },
      async create(tag) {
        tags.set(tag.id, tag);
        slugIndex.set(tag.slug, tag.id);
        return tag;
      },
      async recordScan(tagId, at) {
        const tag = tags.get(tagId);
        if (tag) tags.set(tagId, { ...tag, scanCount: tag.scanCount + 1, lastScanAt: at });
      },
    },

    scans: {
      async create(scan) {
        scans.push(scan);
        return scan;
      },
      async listByEstablishment(establishmentId, since) {
        const floor = since ? new Date(since).getTime() : 0;
        return scans.filter(
          (s) => s.establishmentId === establishmentId && new Date(s.createdAt).getTime() >= floor,
        );
      },
    },

    reviews: {
      async query(query) {
        return filterReviews([...reviews.values()], query);
      },
      async findById(id) {
        return reviews.get(id) ?? null;
      },
      async upsertMany(incoming) {
        const created: Review[] = [];
        for (const review of incoming) {
          const key = extKey(review);
          if (externalIndex.has(key)) continue;
          externalIndex.add(key);
          reviews.set(review.id, review);
          created.push(review);
        }
        return created;
      },
      async update(id, patch) {
        const current = reviews.get(id);
        if (!current) throw new Error(`Avis inconnu : ${id}`);
        const next = { ...current, ...patch, id };
        reviews.set(id, next);
        return next;
      },
      async listAll() {
        return [...reviews.values()];
      },
    },

    alerts: {
      async create(alert) {
        alerts.unshift(alert);
        return alert;
      },
      async findById(id) {
        return alerts.find((a) => a.id === id) ?? null;
      },
      async listByEstablishment(establishmentId, limit = 50) {
        return alerts
          .filter((a) => a.establishmentId === establishmentId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);
      },
      async markRead(id, at) {
        const index = alerts.findIndex((a) => a.id === id);
        if (index >= 0) alerts[index] = { ...alerts[index]!, readAt: at };
      },
      async existsSince(establishmentId, type, title, since) {
        const floor = new Date(since).getTime();
        return alerts.some(
          (a) =>
            a.establishmentId === establishmentId &&
            a.type === type &&
            a.title === title &&
            new Date(a.createdAt).getTime() >= floor,
        );
      },
    },

    loyalty: {
      async findByContactHash(establishmentId, contactHash) {
        return (
          [...loyalty.values()].find(
            (m) => m.establishmentId === establishmentId && m.contactHash === contactHash,
          ) ?? null
        );
      },
      async create(member) {
        loyalty.set(member.id, member);
        return member;
      },
      async update(id, patch) {
        const current = loyalty.get(id);
        if (!current) throw new Error(`Membre inconnu : ${id}`);
        const next = { ...current, ...patch, id };
        loyalty.set(id, next);
        return next;
      },
      async countByEstablishment(establishmentId) {
        return [...loyalty.values()].filter((m) => m.establishmentId === establishmentId).length;
      },
    },

    subscriptions: {
      async create(subscription) {
        subscriptions.set(subscription.id, subscription);
        return subscription;
      },
      async findByEstablishment(establishmentId) {
        return (
          [...subscriptions.values()].find((s) => s.establishmentId === establishmentId) ?? null
        );
      },
      async findById(id) {
        return subscriptions.get(id) ?? null;
      },
      async listAll() {
        return [...subscriptions.values()];
      },
      async listDue(now) {
        const at = new Date(now).getTime();
        return [...subscriptions.values()].filter(
          (s) =>
            (s.status === 'active' || s.status === 'past_due' || s.status === 'trialing') &&
            new Date(s.currentPeriodEnd).getTime() <= at,
        );
      },
      async update(id, patch) {
        const current = subscriptions.get(id);
        if (!current) throw new Error(`Abonnement inconnu : ${id}`);
        const next = { ...current, ...patch, id };
        subscriptions.set(id, next);
        return next;
      },
    },

    invoices: {
      async create(invoice, year) {
        // Séquence sans trou : le compteur est incrémenté et consommé ici même.
        const next = (invoiceCounters.get(year) ?? 0) + 1;
        invoiceCounters.set(year, next);
        const created: Invoice = {
          ...invoice,
          id: nextId('inv'),
          number: formatInvoiceNumber(year, next),
        };
        invoices.set(created.id, created);
        return created;
      },
      /**
       * Équivalent mémoire de la contrainte `(subscriptionId, periodStart)`.
       *
       * JavaScript n'exécute qu'une chose à la fois et il n'y a pas d'`await`
       * entre la recherche et l'insertion : la séquence est donc atomique
       * pour les mêmes raisons qu'une transaction. Ce qui compte ici est que
       * la *règle* soit la même qu'en production — sans quoi le mode
       * démonstration facturerait autrement que la vraie base, et le défaut
       * ne se verrait qu'une fois chez le client.
       */
      async issueForPeriod(invoice, year, advance) {
        const existante = [...invoices.values()].find(
          (i) => i.subscriptionId === invoice.subscriptionId && i.periodStart === invoice.periodStart,
        );
        if (existante) return { invoice: existante, created: false };

        const next = (invoiceCounters.get(year) ?? 0) + 1;
        invoiceCounters.set(year, next);
        const created: Invoice = {
          ...invoice,
          id: nextId('inv'),
          number: formatInvoiceNumber(year, next),
        };
        invoices.set(created.id, created);

        const abonnement = subscriptions.get(advance.subscriptionId);
        if (abonnement) {
          subscriptions.set(advance.subscriptionId, {
            ...abonnement,
            currentPeriodStart: advance.periodStart,
            currentPeriodEnd: advance.periodEnd,
          });
        }

        return { invoice: created, created: true };
      },
      async findById(id) {
        return invoices.get(id) ?? null;
      },
      async listByEstablishment(establishmentId) {
        return [...invoices.values()]
          .filter((i) => i.establishmentId === establishmentId)
          .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
      },
      async listAll() {
        return [...invoices.values()];
      },
      async listOverdue(now) {
        const at = new Date(now).getTime();
        return [...invoices.values()].filter(
          (i) => i.status === 'open' && new Date(i.dueAt).getTime() < at,
        );
      },
      async update(id, patch) {
        const current = invoices.get(id);
        if (!current) throw new Error(`Facture inconnue : ${id}`);
        const next = { ...current, ...patch, id };
        invoices.set(id, next);
        return next;
      },
    },

    push: {
      async subscribe(record) {
        pushSubscriptions.set(record.endpoint, record);
        return record;
      },
      async findByEndpoint(endpoint) {
        return pushSubscriptions.get(endpoint) ?? null;
      },
      async listByManager(managerId) {
        return [...pushSubscriptions.values()].filter((s) => s.managerId === managerId);
      },
      async unsubscribe(endpoint) {
        pushSubscriptions.delete(endpoint);
      },
      async queue(record) {
        pendingPushes.set(record.id, record);
        return record;
      },
      async listQueued(now) {
        const at = new Date(now).getTime();
        return [...pendingPushes.values()].filter(
          (p) => !p.sentAt && new Date(p.sendAt).getTime() <= at,
        );
      },
      async markSent(id, at) {
        const current = pendingPushes.get(id);
        if (current) pendingPushes.set(id, { ...current, sentAt: at });
      },
    },

    notificationPreferences: {
      async get(establishmentId) {
        return preferences.get(establishmentId) ?? null;
      },
      async upsert(value) {
        preferences.set(value.establishmentId, value);
        return value;
      },
    },

    pos: {
      async findTicket(establishmentId, externalId) {
        return posTickets.get(ticketKey(establishmentId, externalId)) ?? null;
      },
      async createTicket(ticket) {
        posTickets.set(ticketKey(ticket.establishmentId, ticket.externalId), ticket);
        return ticket;
      },
      async listTickets(establishmentId, since) {
        const floor = since ? new Date(since).getTime() : 0;
        return [...posTickets.values()].filter(
          (t) =>
            t.establishmentId === establishmentId && new Date(t.closedAt).getTime() >= floor,
        );
      },
      async markInvited(id, at) {
        for (const [key, ticket] of posTickets) {
          if (ticket.id === id) posTickets.set(key, { ...ticket, invitedAt: at });
        }
      },
      async lastInvitedAt(establishmentId, contactHash) {
        return [...posTickets.values()]
          .filter(
            (t) =>
              t.establishmentId === establishmentId &&
              t.contactHash === contactHash &&
              Boolean(t.invitedAt),
          )
          .map((t) => t.invitedAt!)
          .sort()
          .pop();
      },
      async getCredential(establishmentId) {
        return posCredentials.get(establishmentId) ?? null;
      },
      async upsertCredential(credential) {
        posCredentials.set(credential.establishmentId, credential);
        return credential;
      },
      async touchCredential(establishmentId, at) {
        const current = posCredentials.get(establishmentId);
        if (current) posCredentials.set(establishmentId, { ...current, lastUsedAt: at });
      },
    },

    googleConnections: {
      async get(establishmentId) {
        return googleConnections.get(establishmentId) ?? null;
      },
      async upsert(record) {
        googleConnections.set(record.establishmentId, record);
        return record;
      },
      async update(establishmentId, patch) {
        const current = googleConnections.get(establishmentId);
        if (!current) throw new Error(`Aucune connexion Google sur ${establishmentId}`);
        const next = { ...current, ...patch, establishmentId };
        googleConnections.set(establishmentId, next);
        return next;
      },
      async remove(establishmentId) {
        googleConnections.delete(establishmentId);
      },
      async listAll() {
        return [...googleConnections.values()];
      },
    },

    rateLimit: {
      async hit(key, expiresAt) {
        // Balayage paresseux : sans lui, une instance qui tourne des semaines
        // accumulerait une entrée par fenêtre et par IP vue. Le coût est payé
        // par la requête qui déclenche le seuil, pas par un minuteur.
        if (rateCounters.size > 5_000) {
          const now = Date.now();
          for (const [k, entry] of rateCounters) {
            if (entry.expiresAtMs <= now) rateCounters.delete(k);
          }
        }
        const current = rateCounters.get(key);
        const count = (current?.count ?? 0) + 1;
        rateCounters.set(key, { count, expiresAtMs: new Date(expiresAt).getTime() });
        return count;
      },
      async reset(key) {
        rateCounters.delete(key);
      },
    },

    async close() {
      // rien à fermer
    },
  };
}

export function filterReviews(all: Review[], query: ReviewQuery): Review[] {
  const since = query.since ? new Date(query.since).getTime() : null;
  return all
    .filter((r) => r.establishmentId === query.establishmentId)
    .filter((r) => (query.status ? r.status === query.status : true))
    .filter((r) => (query.maxRating == null ? true : r.rating <= query.maxRating))
    .filter((r) => (query.platform ? r.platform === query.platform : true))
    .filter((r) => (since == null ? true : new Date(r.publishedAt).getTime() >= since))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, query.limit ?? 200);
}

const linkKey = (establishmentId: string, platform: PlatformId): string =>
  `${establishmentId}:${platform}`;

const extKey = (review: Review): string =>
  `${review.establishmentId}:${review.platform}:${review.externalId}`;

const ticketKey = (establishmentId: string, externalId: string): string =>
  `${establishmentId}:${externalId}`;
