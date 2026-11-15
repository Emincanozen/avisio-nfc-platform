'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Bar, Empty, Kpi, percent } from '@/components/ui';

interface AdminOverview {
  activeSubscriptions: number;
  mrrCents: number;
  mrrLabel: string;
  arrLabel: string;
  arpuLabel: string;
  overdueCount: number;
  overdueLabel: string;
  byPlan: Record<string, number>;
  establishments: number;
  signupsThisMonth: number;
  churn: { churned: number; atStart: number; rate: number };
  reviewsTotal: number;
  importedReviews: number;
  unansweredNegatives: number;
  googleConnections: number;
  /** Consommation du modèle de langage sur l'heure en cours. */
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    failures: number;
    throttled: number;
    windowStartedAt: string;
  };
  capabilities: { push: boolean };
}

const JOBS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'billing', label: 'Facturation', hint: 'Émet les factures des périodes échues.' },
  { id: 'dunning', label: 'Relances', hint: 'Relance les impayés, suspend au-delà de 30 jours.' },
  { id: 'ingest', label: 'Ingestion des avis', hint: 'Interroge les plateformes connectées.' },
  { id: 'trends', label: 'Tendances', hint: 'Recalcule les tendances thématiques.' },
  { id: 'reports', label: 'Rapports mensuels', hint: 'Envoie le rapport aux offres éligibles.' },
  { id: 'push', label: 'Push différés', hint: 'Vide la file retenue par les heures calmes.' },
];

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await api<AdminOverview>('/admin/overview'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (job: string, label: string): Promise<void> => {
    setRunning(job);
    try {
      const result = await api<Record<string, unknown>>(`/admin/ops/${job}`, { method: 'POST' });
      setLog((current) => [`${label} : ${summarise(result)}`, ...current].slice(0, 8));
      await load();
    } catch (err) {
      setLog((current) =>
        [`${label} : ${err instanceof Error ? err.message : 'échec'}`, ...current].slice(0, 8),
      );
    } finally {
      setRunning('');
    }
  };

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Chargement…</Empty>;

  const totalPlans = Object.values(data.byPlan).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="kpi">
        <Kpi label="MRR" value={data.mrrLabel} hint={`ARR ${data.arrLabel}`} tone="positive" />
        <Kpi
          label="Établissements actifs"
          value={String(data.activeSubscriptions)}
          hint={`${data.signupsThisMonth} signature(s) ce mois`}
        />
        <Kpi label="Revenu moyen" value={data.arpuLabel} hint="par établissement et par mois" />
        <Kpi
          label="Impayés"
          value={data.overdueLabel}
          hint={`${data.overdueCount} facture(s) échue(s)`}
          tone={data.overdueCount > 0 ? 'critical' : 'positive'}
        />
        <Kpi
          label="Attrition du mois"
          value={data.churn.atStart === 0 ? '—' : percent(data.churn.rate)}
          hint={`${data.churn.churned} sur ${data.churn.atStart} en début de mois`}
          tone={data.churn.rate > 0.04 ? 'critical' : 'neutral'}
        />
        <Kpi
          label="Avis négatifs sans réponse"
          value={String(data.unansweredNegatives)}
          hint={`${data.reviewsTotal} avis suivis au total`}
          tone={data.unansweredNegatives > 5 ? 'warning' : 'neutral'}
        />
      </section>

      {/*
        Consommation du modèle de langage et provenance des avis.
        Deux chiffres qu'on ne peut pas piloter sans les voir : un plafond
        qu'on ne regarde jamais est réglé au hasard, et un parc dont on ignore
        la part d'avis importés ne dit pas où en est l'accès aux plateformes.
      */}
      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Coûts et sources</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Appels au modèle de langage sur l’heure en cours. Le dépassement du
          plafond ne fait échouer personne : il bascule sur le moteur
          heuristique local.
        </p>
        <div className="kpi" style={{ marginTop: 12 }}>
          <Kpi
            label="Appels au modèle (1 h)"
            value={String(data.llm.calls)}
            hint={`${data.llm.inputTokens + data.llm.outputTokens} jetons`}
          />
          <Kpi
            label="Appels plafonnés"
            value={String(data.llm.throttled)}
            hint={
              data.llm.throttled > 0
                ? 'emballement, ou plafond trop bas'
                : 'aucun — cas normal'
            }
            tone={data.llm.throttled > 0 ? 'warning' : 'positive'}
          />
          <Kpi
            label="Échecs d’appel"
            value={String(data.llm.failures)}
            hint="repli sur le moteur local"
            tone={data.llm.failures > 0 ? 'warning' : 'neutral'}
          />
          <Kpi
            label="Fiches Google connectées"
            value={String(data.googleConnections)}
            hint={`${data.establishments} établissement(s) au parc`}
          />
          <Kpi
            label="Avis importés à la main"
            value={String(data.importedReviews)}
            hint={`sur ${data.reviewsTotal} avis suivis`}
          />
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Répartition du parc</h2>
          <div className="stack" style={{ gap: 14 }}>
            {Object.entries(data.byPlan).map(([plan, count]) => (
              <div key={plan}>
                <div className="spread" style={{ fontSize: 14, marginBottom: 5 }}>
                  <span style={{ textTransform: 'capitalize' }}>{plan}</span>
                  <span className="muted">{count} établissement(s)</span>
                </div>
                <Bar share={(count / totalPlans) * 100} />
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Traitements de fond</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Ces tâches tournent automatiquement. Le déclenchement manuel sert au
            support et à la démonstration.
          </p>
          <div className="row" style={{ gap: 8 }}>
            {JOBS.map((job) => (
              <button
                key={job.id}
                type="button"
                className="btn btn-ghost"
                style={{ padding: '8px 13px', fontSize: 13.5 }}
                title={job.hint}
                disabled={running !== ''}
                onClick={() => void run(job.id, job.label)}
              >
                {running === job.id ? '…' : job.label}
              </button>
            ))}
          </div>

          {log.length > 0 && (
            <div className="stack" style={{ gap: 4, marginTop: 14 }}>
              {log.map((line, index) => (
                <div
                  key={index}
                  className="muted"
                  style={{ fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {!data.capabilities.push && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
              Clés VAPID absentes : les notifications push sont journalisées au lieu
              d’être envoyées.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Résume la sortie d'un traitement en une ligne lisible. */
function summarise(result: Record<string, unknown>): string {
  const parts = Object.entries(result)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => `${key} ${String(value)}`);
  const errors = Array.isArray(result.errors) ? (result.errors as string[]) : [];
  if (errors.length > 0) parts.push(`erreurs : ${errors.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : 'terminé';
}
