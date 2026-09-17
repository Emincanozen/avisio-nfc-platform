/**
 * Adaptateur mémoire.
 *
 * Sert deux usages : la démonstration commerciale (jeu de données chargé au
 * démarrage) et les tests d'intégration de l'API, qui tournent sans Docker.
 * Les données sont perdues au redémarrage — c'est assumé et annoncé au boot.
 */

import type {
  Alert,
  Establishment,
  LoyaltyMember,
  Manager,
  NfcTag,
  PlatformId,
  PlatformLink,
  Review,
  ScanEvent,
} from '@avisio/core';
import { buildDemoDataset } from '../demo-data.js';
import type { Repository, ReviewQuery } from './types.js';

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
      async create(manager) {
        managers.set(manager.id, manager);
        return manager;
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
    .filter((r) => (since == null ? true : new Date(r.publishedAt).getTime() >= since))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, query.limit ?? 200);
}

const linkKey = (establishmentId: string, platform: PlatformId): string =>
  `${establishmentId}:${platform}`;

const extKey = (review: Review): string =>
  `${review.establishmentId}:${review.platform}:${review.externalId}`;
