import { describe, expect, it } from 'vitest';
import {
  assertCompliant,
  checkLandingConfig,
  checkLoyaltyRule,
  landingDisclosure,
} from '../src/compliance.js';
import { balanceMessage, earnPoints, nextReward } from '../src/loyalty.js';
import { negotiateLocale, t } from '../src/i18n.js';
import { fitsOnNtag213, generateSlug, isValidSlug, tagUrl } from '../src/ids.js';

describe('checkLandingConfig', () => {
  it('accepte un parcours sans tri par note', () => {
    expect(checkLandingConfig({})).toEqual([]);
  });

  it('rejette la demande de note avant redirection', () => {
    const issues = checkLandingConfig({ askRatingBeforeRedirect: true });
    expect(issues[0]?.code).toBe('rating_gate_before_redirect');
  });

  it('rejette le routage différencié selon une note pré-saisie', () => {
    expect(checkLandingConfig({ routeByPrefilledRating: true })).toHaveLength(1);
  });

  it('rejette le détournement des mécontents vers un formulaire privé', () => {
    expect(checkLandingConfig({ privateFeedbackInsteadOfPublic: true })).toHaveLength(1);
  });

  it('ne duplique pas le même code de violation', () => {
    expect(
      checkLandingConfig({ askRatingBeforeRedirect: true, routeByPrefilledRating: true }),
    ).toHaveLength(1);
  });
});

describe('checkLoyaltyRule', () => {
  it('accepte des points inconditionnels', () => {
    expect(checkLoyaltyRule({ pointsPerReview: 10 })).toEqual([]);
  });

  it('rejette une note minimale pour la récompense', () => {
    expect(checkLoyaltyRule({ pointsPerReview: 10, minimumRatingForReward: 4 })).toHaveLength(1);
  });

  it('rejette un bonus indexé sur la note', () => {
    expect(
      checkLoyaltyRule({ pointsPerReview: 10, bonusPointsByRating: { '5': 20 } }),
    ).toHaveLength(1);
  });

  it('assertCompliant lève une ComplianceError', () => {
    expect(() => assertCompliant(checkLandingConfig({ askRatingBeforeRedirect: true }))).toThrow(
      /review gating/,
    );
    expect(() => assertCompliant([])).not.toThrow();
  });
});

describe('landingDisclosure', () => {
  it('mentionne la contrepartie quand la fidélité est active', () => {
    expect(landingDisclosure(true)).toContain('quelle que soit la note');
    expect(landingDisclosure(false)).toContain('sans relecture');
  });
});

describe('earnPoints', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('crédite un nouveau membre', () => {
    const outcome = earnPoints({ points: 0 }, now);
    expect(outcome.credited).toBe(true);
    if (outcome.credited) expect(outcome.balance).toBe(10);
  });

  it('bloque un second crédit dans la période de carence', () => {
    const outcome = earnPoints(
      { points: 10, lastEarnedAt: new Date(now.getTime() - 3_600_000).toISOString() },
      now,
    );
    expect(outcome.credited).toBe(false);
    if (!outcome.credited) {
      expect(outcome.reason).toBe('cooldown');
      expect(new Date(outcome.nextEligibleAt).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('crédite à nouveau après la carence', () => {
    const outcome = earnPoints(
      { points: 20, lastEarnedAt: new Date(now.getTime() - 30 * 3_600_000).toISOString() },
      now,
    );
    expect(outcome.credited).toBe(true);
  });

  it('signale le palier franchi', () => {
    const outcome = earnPoints({ points: 25 }, now);
    if (outcome.credited) expect(outcome.unlocked?.points).toBe(30);
  });

  it('ne dépend d’aucune note : la signature ne l’accepte pas', () => {
    const outcome = earnPoints({ points: 0 }, now);
    expect(JSON.stringify(outcome)).not.toMatch(/rating|note/i);
  });

  it('calcule le prochain palier', () => {
    expect(nextReward(35)?.reward.points).toBe(60);
    expect(nextReward(500)).toBeNull();
    expect(balanceMessage(35)).toContain('25');
  });
});

describe('negotiateLocale', () => {
  it('prend la langue de plus fort q', () => {
    expect(negotiateLocale('it-IT,it;q=0.9,en;q=0.8')).toBe('it');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
  });

  it('retombe sur la langue par défaut', () => {
    expect(negotiateLocale(null)).toBe('fr');
    expect(negotiateLocale('ja-JP,ja;q=0.9', 'es')).toBe('es');
    expect(negotiateLocale('*')).toBe('fr');
  });

  it('respecte l’ordre de priorité même désordonné', () => {
    expect(negotiateLocale('de;q=0.2,es;q=0.9')).toBe('es');
  });

  it('interpole les variables des messages', () => {
    expect(t('fr', 'cta', { platform: 'Google' })).toBe('Laisser un avis sur Google');
    expect(t('en', 'subtitle', { establishment: 'Chez Marius' })).toContain('Chez Marius');
  });
});

describe('identifiants de plaquette', () => {
  it('génère un slug valide sans caractères ambigus', () => {
    for (let i = 0; i < 200; i += 1) {
      const slug = generateSlug();
      expect(isValidSlug(slug)).toBe(true);
      expect(slug).not.toMatch(/[01lio]/);
    }
  });

  it('construit une URL qui tient sur une puce NTAG213', () => {
    const url = tagUrl('https://avis.io', generateSlug());
    expect(url).toMatch(/^https:\/\/avis\.io\/s\/[a-z2-9]{8}$/);
    expect(fitsOnNtag213(url)).toBe(true);
  });

  it('refuse une URL trop longue pour la puce', () => {
    expect(fitsOnNtag213(`https://avis.io/s/${'a'.repeat(200)}`)).toBe(false);
  });

  it('est déterministe avec une source aléatoire injectée', () => {
    expect(generateSlug(4, () => 0)).toBe('2222');
  });
});
