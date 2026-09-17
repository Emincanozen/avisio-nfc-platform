import Link from 'next/link';
import { PLANS, type Feature, type PlanId } from '@avisio/core';
import { QuoteSimulator } from '@/components/quote-simulator';

const FEATURE_LABELS: Record<Feature, string> = {
  nfc_google_direct: 'Plaquette NFC vers Google',
  realtime_notifications: 'Notification à chaque nouvel avis',
  site_widget: 'Widget avis sur votre site',
  negative_alerts: 'Alerte immédiate sur les avis 1-3★',
  ai_reply_suggestions: 'Réponse rédigée par l’IA, validée par vous',
  multi_platform: 'Routage multi-plateformes',
  multi_platform_unlimited: 'Plateformes illimitées',
  analytics_basic: 'Tableau de bord de réputation',
  analytics_advanced: 'Analyses avancées et export mensuel',
  nlp_themes: 'Thèmes récurrents extraits des avis',
  competitive_benchmark: 'Benchmark sectoriel anonymisé',
  loyalty: 'Programme de fidélité',
  custom_tag_design: 'Plaquette personnalisée à votre marque',
  pos_integration: 'Intégration caisse / POS',
};

const AXES = [
  {
    title: 'Aucun avis négatif ne passe entre les mailles',
    body: "Alerte dès qu'un avis 1-3★ est publié, réponse suggérée dans votre ton de marque, validée en un clic. Le taux et le délai de réponse deviennent des indicateurs suivis.",
  },
  {
    title: 'Une plaquette, la bonne plateforme',
    body: "Le même support envoie vers Google, TripAdvisor, Facebook, Yelp ou TheFork — vers celle où vous êtes le moins présent. Un client, une plateforme, pas de dispersion.",
  },
  {
    title: 'Ce que disent vraiment vos clients',
    body: "Les thèmes récurrents sont extraits automatiquement : attente, accueil, propreté, prix. Une alerte part quand un sujet monte, avant que la note ne bouge.",
  },
  {
    title: 'Le scan qui fidélise',
    body: 'Points de fidélité accordés pour le dépôt d’un avis — jamais pour sa note — et page traduite dans la langue du téléphone du client.',
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="container" style={{ padding: '72px 16px 48px', maxWidth: 820 }}>
        <div className="eyebrow">Avisio</div>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 46px)', margin: '12px 0 16px' }}>
          Vos clients satisfaits partent sans rien dire.
          <br />
          Une plaquette suffit à changer ça.
        </h1>
        <p style={{ fontSize: 18, color: 'var(--text-muted)', maxWidth: 620 }}>
          Avisio transforme le passage en caisse en avis publié, puis vous donne les
          outils pour répondre vite et comprendre ce qui revient. Conforme aux
          règles Google et à la réglementation française : aucun avis n’est
          filtré, trié ni retardé.
        </p>
        <div className="row" style={{ marginTop: 28 }}>
          <Link href="/login" className="btn btn-primary">
            Voir la démonstration
          </Link>
          <Link href="#tarifs" className="btn btn-ghost">
            Tarifs
          </Link>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 56 }}>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
        >
          {AXES.map((axis) => (
            <div key={axis.title} className="card">
              <h2 style={{ fontSize: 17, marginBottom: 8 }}>{axis.title}</h2>
              <p className="muted" style={{ fontSize: 14.5, margin: 0 }}>
                {axis.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="container" id="tarifs" style={{ paddingBottom: 56 }}>
        <h2 style={{ fontSize: 26, marginBottom: 8 }}>Trois offres, par établissement</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          Mise en service offerte avec un engagement 12 mois, sinon 49 € une fois.
        </p>

        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
        >
          {(Object.keys(PLANS) as PlanId[]).map((planId) => {
            const plan = PLANS[planId];
            const highlighted = planId === 'pro';
            return (
              <div
                key={planId}
                className="card"
                style={
                  highlighted
                    ? { borderColor: 'var(--accent)', borderWidth: 2 }
                    : undefined
                }
              >
                <div className="spread">
                  <strong style={{ fontSize: 18 }}>{plan.name}</strong>
                  {highlighted && <span className="badge badge-accent">Le plus choisi</span>}
                </div>
                <div style={{ fontSize: 34, fontWeight: 600, margin: '8px 0 2px' }}>
                  {plan.monthlyCents / 100} €
                  <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>
                    {' '}
                    / mois HT
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                  {plan.tagline}
                </p>
                <p style={{ fontSize: 14, margin: '12px 0 8px' }}>
                  <strong>{plan.includedTags}</strong> plaquette{plan.includedTags > 1 ? 's' : ''}{' '}
                  incluse{plan.includedTags > 1 ? 's' : ''}
                  {planId === 'premium' && ' + design personnalisé'}
                </p>
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: 14.5, lineHeight: 1.7 }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{FEATURE_LABELS[feature]}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 72 }}>
        <h2 style={{ fontSize: 22, marginBottom: 12 }}>Simulateur de devis</h2>
        <QuoteSimulator />
      </section>

      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '24px 16px',
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        <div className="container">
          Avisio lit les avis déjà publiés via les API officielles des plateformes.
          Le produit ne s’interpose jamais entre un client et la plateforme d’avis,
          et n’accorde aucune contrepartie conditionnée à une note.
        </div>
      </footer>
    </main>
  );
}
