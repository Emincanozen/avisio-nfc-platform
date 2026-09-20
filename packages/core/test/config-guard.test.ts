/**
 * Contrôle de configuration au démarrage.
 *
 * Chacun des cas refusés ici produisait un serveur qui **démarre et a l'air de
 * fonctionner**. C'est la raison d'être du module : un mode dégradé annoncé
 * dans un journal que personne ne lit n'est pas un avertissement, c'est une
 * panne différée.
 */

import { describe, expect, it } from 'vitest';
import {
  DEMO_JWT_SECRET,
  formatConfigRefusal,
  productionConfigProblems,
  productionConfigWarnings,
  type RuntimeConfig,
} from '../src/config-guard.js';

const saine = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  nodeEnv: 'production',
  databaseUrl: 'postgresql://avisio:motdepasse@db.interne:5432/avisio',
  jwtSecret: 'un-secret-de-production-suffisamment-long-0123',
  secretsKey: 'une-cle-de-scellement-distincte-et-longue-4567',
  webUrl: 'https://app.avisio.fr',
  apiUrl: 'https://api.avisio.fr',
  demoMode: false,
  providers: { anthropic: true, googleOAuth: true, email: true, push: true },
  ...over,
});

const causes = (config: RuntimeConfig): string[] =>
  productionConfigProblems(config).map((p) => p.setting);

describe('hors production', () => {
  it('ne bloque rien en développement', () => {
    // Le mode dégradé est la bonne propriété ici : démonstration sur un
    // portable, sans base, sans réseau, sans configuration.
    expect(
      productionConfigProblems({
        ...saine(),
        nodeEnv: 'development',
        databaseUrl: '',
        jwtSecret: DEMO_JWT_SECRET,
        webUrl: 'http://localhost:3000',
        apiUrl: 'http://localhost:4000',
        demoMode: true,
      }),
    ).toEqual([]);
  });

  it('ne bloque rien en test', () => {
    expect(productionConfigProblems({ ...saine(), nodeEnv: 'test', databaseUrl: '' })).toEqual([]);
  });
});

describe('en production', () => {
  it('accepte une configuration complète', () => {
    expect(productionConfigProblems(saine())).toEqual([]);
  });

  it("refuse l'absence de base de données", () => {
    // Sans elle, l'API sert l'adaptateur mémoire — donc le jeu de
    // démonstration, avec des identifiants publiés dans ce dépôt, et une
    // perte totale au premier redémarrage.
    const problemes = productionConfigProblems(saine({ databaseUrl: '' }));
    expect(problemes.map((p) => p.setting)).toContain('DATABASE_URL');
    expect(problemes[0]!.reason).toContain('mémoire');
  });

  it('refuse le secret de démonstration', () => {
    // Publié dans .env.example : quiconque a lu le dépôt peut forger un jeton
    // de session, rôle administrateur compris.
    expect(causes(saine({ jwtSecret: DEMO_JWT_SECRET }))).toContain('JWT_SECRET');
  });

  it('refuse un secret absent', () => {
    expect(causes(saine({ jwtSecret: '' }))).toContain('JWT_SECRET');
  });

  it('refuse un secret trop court', () => {
    expect(causes(saine({ jwtSecret: 'trop-court' }))).toContain('JWT_SECRET');
  });

  it('refuse une clé de scellement identique au secret de session', () => {
    // Confondus, faire tourner le secret des sessions — opération banale —
    // rendrait illisibles tous les jetons Google des clients.
    const secret = 'un-seul-secret-pour-les-deux-usages-0123456789';
    expect(causes(saine({ jwtSecret: secret, secretsKey: secret }))).toContain('SECRETS_KEY');
  });

  it('refuse des URLs publiques en clair', () => {
    const problemes = causes(
      saine({ webUrl: 'http://app.avisio.fr', apiUrl: 'http://api.avisio.fr' }),
    );
    expect(problemes).toContain('PUBLIC_WEB_URL');
    expect(problemes).toContain('PUBLIC_API_URL');
  });

  it('explique pourquoi HTTPS n’est pas négociable', () => {
    const [probleme] = productionConfigProblems(saine({ webUrl: 'http://app.avisio.fr' }));
    expect(probleme!.reason).toContain('push');
  });

  it('refuse des URLs publiques absentes', () => {
    expect(causes(saine({ webUrl: '', apiUrl: '' }))).toContain('PUBLIC_WEB_URL');
  });

  it('refuse le mode démonstration', () => {
    // C'est lui qui autorise les connecteurs simulés. Activé sur une vraie
    // base, il y écrit de faux avis et fausse les métriques vendues.
    const problemes = productionConfigProblems(saine({ demoMode: true }));
    expect(problemes.map((p) => p.setting)).toContain('AVISIO_DEMO_MODE');
    expect(problemes.find((p) => p.setting === 'AVISIO_DEMO_MODE')!.reason).toContain('faux avis');
  });

  it('cumule les causes plutôt que de s’arrêter à la première', () => {
    // Corriger une variable pour découvrir la suivante au redémarrage suivant
    // ferait perdre une demi-journée.
    const problemes = causes(saine({ databaseUrl: '', jwtSecret: '', webUrl: 'http://x.fr' }));
    expect(problemes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('avertissements', () => {
  it("signale un fournisseur manquant sans bloquer", () => {
    // Exploiter sans e-mail transactionnel est une décision commerciale, pas
    // une faute de configuration.
    const config = saine({ providers: { anthropic: true, googleOAuth: true, email: false, push: true } });
    expect(productionConfigProblems(config)).toEqual([]);
    expect(productionConfigWarnings(config).map((w) => w.setting)).toContain('RESEND_API_KEY');
  });

  it('dit ce que le client ne recevra pas', () => {
    const config = saine({ providers: { anthropic: true, googleOAuth: true, email: false, push: false } });
    const textes = productionConfigWarnings(config).map((w) => w.reason).join(' ');
    expect(textes).toContain('ne recevra rien');
    expect(textes).toContain('push');
  });

  it('ne dit rien quand tout est branché', () => {
    expect(productionConfigWarnings(saine())).toEqual([]);
  });
});

describe('message de refus', () => {
  it('nomme chaque variable et son motif', () => {
    const texte = formatConfigRefusal(productionConfigProblems(saine({ databaseUrl: '' })));
    expect(texte).toContain('DÉMARRAGE REFUSÉ');
    expect(texte).toContain('DATABASE_URL');
    expect(texte).toContain('docs/deploiement.md');
  });
});
