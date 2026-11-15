/**
 * Connexion Google d'un établissement, et import manuel d'avis.
 *
 * Les deux vivent ensemble parce qu'ils répondent à la même question : comment
 * les vrais avis entrent-ils dans Avisio. Le chemin normal est le consentement
 * Google ; l'import est le chemin praticable tant que Google n'a pas approuvé
 * l'accès, et il reste utile après pour les plateformes sans API ouverte.
 *
 * Ils ne sont jamais présentés comme équivalents : un avis importé porte
 * `source: 'import'` et le reste, du tableau de bord au rapport mensuel.
 */

import {
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE_HEADER,
  PLATFORM_LABELS,
  describeImport,
  generateId,
  importedToReview,
  parseReviewImport,
  shouldAlert,
  type Alert,
  type PlatformId,
  type Review,
} from '@avisio/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertAccess, httpError } from '../app.js';
import { capabilities, env } from '../env.js';
import {
  GOOGLE_SCOPE,
  GoogleOAuthError,
  authorizationUrl,
  exchangeCode,
  listLocations,
  oauthConfigured,
  redirectUri,
  refreshAccessToken,
  revokeToken,
} from '../services/google-oauth.js';
import { open, seal } from '../services/secrets.js';

const idParam = z.object({ id: z.string().min(3) });

/**
 * Durée de validité du jeton d'état OAuth.
 *
 * Court : cet état autorise à rattacher une fiche Google à un établissement,
 * et il transite par le navigateur. Dix minutes couvrent largement un
 * consentement, y compris avec une connexion à faire.
 */
const STATE_TTL = '10m';

export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  const { repo, googleTokens, llm, notifier } = app.ctx;
  const protectedRoute = { onRequest: [app.authenticate] };

  // ---- État de la connexion ---------------------------------------------

  app.get('/establishments/:id/google', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const connection = await repo.googleConnections.get(id);
    return {
      /** L'application OAuth est-elle configurée côté Avisio ? */
      available: oauthConfigured(),
      connected: connection != null,
      /** Une fiche a-t-elle été choisie ? Sans elle, rien ne peut être lu. */
      locationSelected: Boolean(connection?.locationName),
      ...(connection
        ? {
            locationName: connection.locationName ?? null,
            locationTitle: connection.locationTitle ?? null,
            authorizedBy: connection.authorizedBy ?? null,
            connectedAt: connection.connectedAt,
            lastSyncAt: connection.lastSyncAt ?? null,
            lastError: connection.lastError ?? null,
          }
        : {}),
      scope: GOOGLE_SCOPE,
      redirectUri: redirectUri(),
    };
  });

  // ---- Consentement ------------------------------------------------------

  /**
   * Prépare le consentement.
   *
   * L'état renvoyé à Google est un JWT court signé avec le secret de
   * l'application : c'est lui qui garantit, au retour, que la fiche autorisée
   * est rattachée à l'établissement qui l'a demandé — et pas à un autre. Un
   * état opaque non signé laisserait n'importe qui provoquer ce rattachement.
   */
  app.post('/establishments/:id/google/authorize', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    if (!oauthConfigured()) {
      throw httpError(
        409,
        "La connexion Google n'est pas configurée sur cette instance (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET).",
      );
    }

    const state = app.jwt.sign(
      { purpose: 'google-oauth', establishmentId: id, managerId: request.managerId },
      { expiresIn: STATE_TTL },
    );

    return { url: authorizationUrl(state), scope: GOOGLE_SCOPE, expiresIn: STATE_TTL };
  });

  /**
   * Retour de Google.
   *
   * Route publique par nécessité : c'est le navigateur du client qui y arrive,
   * redirigé par Google, sans en-tête d'autorisation. La preuve n'est donc pas
   * une session mais l'état signé, vérifié ici.
   *
   * Elle répond par une redirection vers l'interface, jamais par du JSON :
   * c'est un être humain qui la reçoit, au milieu d'un parcours.
   */
  app.get('/integrations/google/callback', async (request, reply) => {
    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(request.query);

    const back = (establishmentId: string | null, params: Record<string, string>): string => {
      const target = establishmentId
        ? `${env.webUrl}/dashboard/${establishmentId}/sources`
        : `${env.webUrl}/dashboard`;
      return `${target}?${new URLSearchParams(params).toString()}`;
    };

    // Le client a cliqué « Annuler » sur l'écran Google : ce n'est pas une
    // erreur, c'est une décision. On le ramène sans rien écrire.
    if (query.error) {
      return reply.redirect(back(null, { google: 'annule' }));
    }
    if (!query.code || !query.state) {
      return reply.redirect(back(null, { google: 'erreur', motif: 'reponse-incomplete' }));
    }

    let claims: { establishmentId: string; managerId: string; purpose: string };
    try {
      claims = app.jwt.verify(query.state);
    } catch {
      // État expiré ou forgé. Le consentement est à refaire depuis l'interface.
      return reply.redirect(back(null, { google: 'erreur', motif: 'etat-invalide' }));
    }
    if (claims.purpose !== 'google-oauth') {
      return reply.redirect(back(null, { google: 'erreur', motif: 'etat-invalide' }));
    }

    const establishmentId = claims.establishmentId;

    try {
      const tokens = await exchangeCode(query.code);
      if (!tokens.refreshToken) {
        // Sans jeton de rafraîchissement, l'accès s'éteindrait au bout d'une
        // heure sans prévenir. Mieux vaut refuser la connexion tout de suite.
        return reply.redirect(
          back(establishmentId, { google: 'erreur', motif: 'sans-jeton-durable' }),
        );
      }

      const existing = await repo.googleConnections.get(establishmentId);
      await repo.googleConnections.upsert({
        establishmentId,
        refreshTokenSealed: seal(tokens.refreshToken),
        scope: tokens.scope,
        connectedAt: new Date().toISOString(),
        authorizedBy: claims.managerId,
        // Une reconnexion conserve la fiche déjà choisie : le client ne
        // devrait pas avoir à la resélectionner après avoir simplement
        // renouvelé son autorisation.
        ...(existing?.locationName ? { locationName: existing.locationName } : {}),
        ...(existing?.locationTitle ? { locationTitle: existing.locationTitle } : {}),
      });
      googleTokens.forget(establishmentId);

      return reply.redirect(back(establishmentId, { google: 'connecte' }));
    } catch (error) {
      request.log.warn({ err: error }, 'Échange du code Google en échec');
      return reply.redirect(back(establishmentId, { google: 'erreur', motif: 'echange-refuse' }));
    }
  });

  // ---- Choix de la fiche -------------------------------------------------

  app.get('/establishments/:id/google/locations', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const accessToken = await googleTokens.accessTokenFor(id);
    if (!accessToken) {
      throw httpError(409, "Cet établissement n'a pas d'autorisation Google valide.");
    }

    try {
      return { locations: await listLocations(accessToken) };
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw httpError(error.status, error.message);
      throw error;
    }
  });

  /**
   * Rattache une fiche Google à l'établissement.
   *
   * Le nom de la fiche est écrit à deux endroits : sur la connexion, et comme
   * `externalId` du lien de plateforme, qui est ce que lit l'ingestion.
   */
  app.put('/establishments/:id/google/location', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const body = z
      .object({
        locationName: z.string().min(3).max(200),
        locationTitle: z.string().max(200).optional(),
      })
      .parse(request.body);

    const connection = await repo.googleConnections.get(id);
    if (!connection) throw httpError(409, 'Connectez d’abord le compte Google.');

    // On vérifie que la fiche fait bien partie de celles que ce compte gère :
    // sans ce contrôle, un identifiant saisi à la main pointerait la fiche
    // d'un tiers, et l'ingestion irait lire des avis qui ne lui appartiennent
    // pas — quand bien même Google finirait par le refuser.
    const accessToken = await googleTokens.accessTokenFor(id);
    if (!accessToken) throw httpError(409, "L'autorisation Google doit être redonnée.");

    const locations = await listLocations(accessToken).catch(() => null);
    if (locations && !locations.some((l) => l.name === body.locationName)) {
      throw httpError(403, "Cette fiche n'est pas gérée par le compte Google autorisé.");
    }
    const matched = locations?.find((l) => l.name === body.locationName);

    const updated = await repo.googleConnections.update(id, {
      locationName: body.locationName,
      locationTitle: body.locationTitle ?? matched?.title ?? body.locationName,
      lastError: undefined,
    });

    const links = await repo.platformLinks.listByEstablishment(id);
    const existing = links.find((l) => l.platform === 'google');
    await repo.platformLinks.upsert({
      establishmentId: id,
      platform: 'google',
      reviewUrl: existing?.reviewUrl ?? `https://search.google.com/local/writereview`,
      externalId: body.locationName,
      enabled: existing?.enabled ?? true,
      reviewCount: existing?.reviewCount ?? 0,
      routedScans: existing?.routedScans ?? 0,
      ...(existing?.averageRating == null ? {} : { averageRating: existing.averageRating }),
    });

    return { connection: updated };
  });

  /**
   * Déconnecte Google.
   *
   * Révoque côté Google avant de supprimer en base. L'ordre compte : effacer
   * la ligne d'abord laisserait, en cas d'échec de la révocation, une
   * autorisation active dans le compte du client, invisible pour lui chez
   * nous. Mieux vaut échouer bruyamment que couper à moitié.
   */
  app.delete('/establishments/:id/google', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const connection = await repo.googleConnections.get(id);
    if (!connection) return { disconnected: true };

    const refreshToken = open(connection.refreshTokenSealed);
    if (refreshToken) await revokeToken(refreshToken);

    await repo.googleConnections.remove(id);
    googleTokens.forget(id);

    // Le lien de plateforme reste, mais sans identifiant de fiche : le routage
    // NFC continue d'envoyer les clients vers Google, seule la lecture des
    // avis s'arrête. Couper les deux punirait le client deux fois.
    const links = await repo.platformLinks.listByEstablishment(id);
    const link = links.find((l) => l.platform === 'google');
    if (link) {
      const { externalId: _dropped, ...rest } = link;
      await repo.platformLinks.upsert(rest);
    }

    return { disconnected: true };
  });

  /**
   * Test de bout en bout de la connexion.
   *
   * Utile parce que chaque maillon peut échouer pour une raison différente, et
   * que le client a besoin de savoir lequel : autorisation absente, jeton
   * révoqué, fiche non choisie, accès API non approuvé par Google.
   */
  app.post('/establishments/:id/google/test', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const connection = await repo.googleConnections.get(id);
    if (!connection) {
      return { ok: false, etape: 'autorisation', message: 'Aucune autorisation Google.' };
    }

    const refreshToken = open(connection.refreshTokenSealed);
    if (!refreshToken) {
      return {
        ok: false,
        etape: 'scellement',
        message: "Jeton illisible : l'autorisation doit être redonnée.",
      };
    }

    try {
      await refreshAccessToken(refreshToken);
    } catch (error) {
      return {
        ok: false,
        etape: 'jeton',
        message: error instanceof Error ? error.message : 'Renouvellement refusé.',
      };
    }

    if (!connection.locationName) {
      return { ok: false, etape: 'fiche', message: 'Aucune fiche sélectionnée.' };
    }

    const connector = app.ctx.connectors.get('google');
    if (!connector?.live) {
      return {
        ok: false,
        etape: 'connecteur',
        message: 'Connecteur Google simulé : cette instance ne lit pas les avis réels.',
      };
    }

    try {
      const reviews = await connector.fetchReviews(
        { establishmentId: id, externalId: connection.locationName },
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
      );
      return {
        ok: true,
        etape: 'lecture',
        message: `Connexion opérationnelle : ${reviews.length} avis sur les 7 derniers jours.`,
      };
    } catch (error) {
      return {
        ok: false,
        etape: 'lecture',
        message: error instanceof Error ? error.message : 'Lecture refusée.',
      };
    }
  });

  // ---- Import manuel -----------------------------------------------------

  app.get('/establishments/:id/reviews/import/template', protectedRoute, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const sample = [
      IMPORT_TEMPLATE_HEADER,
      'rev-001,Marie D.,5,"Accueil impeccable, je reviendrai.",2026-08-14,',
      'rev-002,Paul T.,2,"Trop d\'attente le samedi midi.",14/08/2026,"Merci pour votre retour."',
    ].join('\n');

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="avisio-modele-import.csv"')
      // BOM : sans lui, Excel en configuration française affiche les accents
      // en caractères parasites, et le client croit le fichier corrompu.
      .send(`﻿${sample}\n`);
  });

  /**
   * Import d'un export de plateforme.
   *
   * Deux passes : on analyse tout d'abord, on écrit ensuite. Le mode
   * `dryRun` s'arrête après la première — l'interface montre alors ce qui
   * serait importé et ce qui serait refusé, avant que quoi que ce soit ne
   * touche la base.
   */
  app.post('/establishments/:id/reviews/import', protectedRoute, async (request) => {
    const { id } = idParam.parse(request.params);
    assertAccess(request, id);

    const body = z
      .object({
        platform: z.enum(['google', 'tripadvisor', 'facebook', 'yelp', 'thefork']),
        // 4 Mo de CSV : très au-delà des 2 000 lignes acceptées, et assez bas
        // pour qu'un fichier aberrant soit refusé avant d'être analysé.
        csv: z.string().min(1).max(4_000_000),
        dryRun: z.boolean().default(false),
      })
      .parse(request.body);

    const establishment = await repo.establishments.findById(id);
    if (!establishment) throw httpError(404, 'Établissement introuvable.');

    const platform = body.platform as PlatformId;
    const parsed = parseReviewImport(body.csv);

    if (parsed.rows.length === 0) {
      return {
        dryRun: body.dryRun,
        summary: {
          platform,
          platformLabel: PLATFORM_LABELS[platform],
          read: 0,
          imported: 0,
          duplicates: 0,
          rejected: parsed.rejected,
        },
        message:
          parsed.rejected[0]?.reason ??
          `Aucune ligne exploitable. En-tête attendu : ${IMPORT_TEMPLATE_HEADER}`,
        columns: parsed.columns,
      };
    }

    if (body.dryRun) {
      const summary = {
        platform,
        platformLabel: PLATFORM_LABELS[platform],
        read: parsed.rows.length + parsed.rejected.length,
        imported: parsed.rows.length,
        duplicates: 0,
        rejected: parsed.rejected,
      };
      return {
        dryRun: true,
        summary,
        message: `${parsed.rows.length} avis prêts à être importés.`,
        columns: parsed.columns,
        preview: parsed.rows.slice(0, 5),
      };
    }

    const now = new Date().toISOString();
    const candidates: Review[] = parsed.rows.map((row) =>
      importedToReview(row, id, platform, generateId('rev'), now),
    );

    // Le dédoublonnage est celui de l'ingestion : même clé (établissement,
    // plateforme, identifiant externe). Le même fichier importé deux fois ne
    // crée donc rien la seconde fois.
    const created = await repo.reviews.upsertMany(candidates);

    const alerts: Alert[] = [];
    for (const review of created) {
      const analysis = await llm.analyze(review, establishment.sector);
      const stored = await repo.reviews.update(review.id, { analysis });

      // Un import rétroactif ne doit pas déclencher une avalanche d'alertes
      // sur des avis vieux de six mois : seuls les avis récents alertent.
      const recent =
        Date.now() - new Date(stored.publishedAt).getTime() < 14 * 86_400_000;
      if (recent && shouldAlert(stored)) {
        const alert = await repo.alerts.create({
          id: generateId('alr'),
          establishmentId: id,
          type: 'negative_review',
          severity: stored.rating <= 2 ? 'critical' : 'warning',
          title: `Avis ${stored.rating}★ sur ${PLATFORM_LABELS[platform]} (import)`,
          body: stored.comment.slice(0, 200),
          reviewId: stored.id,
          createdAt: now,
        });
        alerts.push(alert);
        for (const manager of await repo.managers.listByEstablishment(id)) {
          await notifier.alert(manager.email, establishment, alert, stored);
        }
      }
    }

    const summary = {
      platform,
      platformLabel: PLATFORM_LABELS[platform],
      read: parsed.rows.length + parsed.rejected.length,
      imported: created.length,
      duplicates: parsed.rows.length - created.length,
      rejected: parsed.rejected,
    };

    return {
      dryRun: false,
      summary,
      alertsCreated: alerts.length,
      message: describeImport(summary),
      columns: parsed.columns,
      maxRows: IMPORT_MAX_ROWS,
    };
  });
}

/** Réexporté pour la route `/health`, qui annonce le mode d'exécution. */
export const googleCapabilities = capabilities;
