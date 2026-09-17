import { describe, expect, it } from 'vitest';
import {
  buildAnalysisPrompt,
  buildReplyPrompt,
  heuristicAnalysis,
  parseAnalysis,
  replyWarnings,
  sanitizeReply,
} from '../src/nlp.js';

describe('parseAnalysis', () => {
  it('lit un JSON propre', () => {
    const analysis = parseAnalysis(
      '{"sentiment":"negative","score":-0.8,"themes":["attente","service"],"keywords":["attente"],"language":"fr"}',
    );
    expect(analysis?.sentiment).toBe('negative');
    expect(analysis?.themes).toEqual(['attente', 'service']);
    expect(analysis?.engine).toBe('llm');
  });

  it('extrait le JSON d’un bloc de code', () => {
    const analysis = parseAnalysis('Voici :\n```json\n{"sentiment":"positive","score":0.9,"themes":["accueil"],"keywords":[],"language":"fr"}\n```');
    expect(analysis?.sentiment).toBe('positive');
  });

  it('écarte les thèmes inventés par le modèle', () => {
    const analysis = parseAnalysis(
      '{"sentiment":"neutral","score":0,"themes":["parking","attente"],"keywords":[],"language":"fr"}',
    );
    expect(analysis?.themes).toEqual(['attente']);
  });

  it('retombe sur « autre » si aucun thème valide', () => {
    const analysis = parseAnalysis(
      '{"sentiment":"neutral","score":0,"themes":["parking"],"keywords":[],"language":"fr"}',
    );
    expect(analysis?.themes).toEqual(['autre']);
  });

  it('renvoie null sur un JSON invalide ou un sentiment inconnu', () => {
    expect(parseAnalysis('pas du json')).toBeNull();
    expect(parseAnalysis('{"sentiment":"furieux"}')).toBeNull();
  });

  it('borne le score dans [-1, 1]', () => {
    const analysis = parseAnalysis(
      '{"sentiment":"negative","score":-42,"themes":["prix"],"keywords":[],"language":"fr"}',
    );
    expect(analysis?.score).toBe(-1);
  });
});

describe('heuristicAnalysis', () => {
  it('détecte le thème attente sur un avis négatif', () => {
    const analysis = heuristicAnalysis('45 minutes d’attente pour un plat froid, service lent', 1);
    expect(analysis.sentiment).toBe('negative');
    expect(analysis.themes).toContain('attente');
    expect(analysis.engine).toBe('heuristic');
  });

  it('reste positive sur un avis élogieux', () => {
    const analysis = heuristicAnalysis('Accueil chaleureux, plats délicieux, je recommande', 5);
    expect(analysis.sentiment).toBe('positive');
    expect(analysis.themes).toContain('accueil');
  });

  it('ne confond pas un mot du lexique avec l’intérieur d’un autre mot', () => {
    // Régression : « excellente » contient « lent ». Une recherche de
    // sous-chaîne classait cet avis 5★ dans le thème « temps d'attente ».
    const analysis = heuristicAnalysis(
      'Excellente cuisine, produits frais et accueil très chaleureux.',
      5,
    );
    expect(analysis.themes).not.toContain('attente');
    expect(analysis.themes).toContain('qualite_produit');
  });

  it('accepte les dérivations du lexique', () => {
    expect(heuristicAnalysis('Service lentement assuré', 2).themes).toContain('attente');
    expect(heuristicAnalysis('Une longue attente', 2).themes).toContain('attente');
  });

  it('gère un commentaire vide sans planter', () => {
    const analysis = heuristicAnalysis('', 3);
    expect(analysis.themes).toEqual(['autre']);
    expect(analysis.sentiment).toBe('neutral');
  });

  it('ignore les accents et la casse', () => {
    const a = heuristicAnalysis('PROPRETE douteuse', 2);
    const b = heuristicAnalysis('propreté douteuse', 2);
    expect(a.themes).toEqual(b.themes);
  });
});

describe('sanitizeReply', () => {
  it('retire markdown et guillemets', () => {
    expect(sanitizeReply('« **Merci** pour votre retour. »')).toBe('Merci pour votre retour.');
  });

  it('tronque proprement sur une fin de phrase', () => {
    const long = 'Merci beaucoup. '.repeat(40);
    const result = sanitizeReply(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('.')).toBe(true);
  });

  it('laisse un texte court intact', () => {
    expect(sanitizeReply('Merci !')).toBe('Merci !');
  });
});

describe('replyWarnings', () => {
  it('signale une demande de suppression d’avis', () => {
    expect(replyWarnings('Pourriez-vous supprimer votre avis ?')).toHaveLength(1);
  });

  it('signale une contrepartie conditionnée à la note', () => {
    expect(replyWarnings('Un dessert offert si vous mettez 5 étoiles').length).toBeGreaterThan(0);
  });

  it('signale une mise en cause du client', () => {
    expect(replyWarnings('Ceci est un faux avis, vous mentez').length).toBeGreaterThan(0);
  });

  it('ne signale rien sur une réponse conforme', () => {
    expect(
      replyWarnings(
        'Merci de votre retour. Nous sommes navrés pour l’attente et avons renforcé l’équipe du samedi.',
      ),
    ).toEqual([]);
  });
});

describe('prompts', () => {
  it('impose un format JSON dans le prompt d’analyse', () => {
    const prompt = buildAnalysisPrompt({ comment: 'Trop long', rating: 2, sector: 'restaurant' });
    expect(prompt).toContain('UNIQUEMENT par un objet JSON');
    expect(prompt).toContain('restaurant');
  });

  it('interdit explicitement les formulations non conformes', () => {
    const prompt = buildReplyPrompt({
      establishmentName: 'Chez Marius',
      brandTone: 'chaleureux, tutoiement proscrit',
      review: { author: 'Léa', rating: 2, comment: 'Trop d’attente', platform: 'google' },
    });
    expect(prompt).toContain('Chez Marius');
    expect(prompt).toContain('jamais demander au client de retirer');
    expect(prompt).toContain("Ne propose aucun geste commercial");
  });

  it('mentionne le geste commercial quand il est autorisé', () => {
    const prompt = buildReplyPrompt({
      establishmentName: 'Chez Marius',
      brandTone: 'sobre',
      review: { author: 'Léa', rating: 1, comment: 'Plat froid', platform: 'google' },
      gesture: 'un dessert offert à la prochaine visite',
    });
    expect(prompt).toContain('dessert offert');
  });
});
