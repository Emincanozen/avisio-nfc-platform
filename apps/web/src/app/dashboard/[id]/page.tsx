'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, ApiError, api, clearToken, getToken } from '@/lib/api';
import type { Alert, EstablishmentDetail, Overview } from '@/lib/types';
import {
  Bar,
  Empty,
  Kpi,
  SeverityBadge,
  Sparkline,
  delta as signed,
  num,
  percent,
  relativeDays,
} from '@/components/ui';

interface Benchmark {
  scope: string;
  peerCount: number;
  averageRating: { self: number; peerMedian: number; peerP25: number; peerP75: number };
  ratingPercentile: number;
  summary: string;
}

export default function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<EstablishmentDetail | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [benchmarkNote, setBenchmarkNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const [overviewData, detailData, alertData] = await Promise.all([
          api<Overview>(`/establishments/${id}/overview`),
          api<EstablishmentDetail>(`/establishments/${id}`),
          api<Alert[]>(`/establishments/${id}/alerts?limit=6`),
        ]);
        if (cancelled) return;
        setOverview(overviewData);
        setDetail(detailData);
        setAlerts(alertData);

        if (detailData.features.benchmark) {
          try {
            setBenchmark(await api<Benchmark>(`/establishments/${id}/benchmark`));
          } catch (err) {
            // Le refus pour cause d'anonymat est une information utile, pas une
            // erreur : on l'affiche telle quelle au gérant.
            setBenchmarkNote(err instanceof Error ? err.message : '');
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace('/login');
          return;
        }
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chargement impossible.');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (error) return <Empty>{error}</Empty>;
  if (!overview || !detail) return <Empty>Chargement…</Empty>;

  const { metrics, rating } = overview;
  const openAlerts = alerts.filter((a) => !a.readAt);
  const delta = rating.delta;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="spread">
        <div>
          <h1 style={{ fontSize: 24 }}>{detail.establishment.name}</h1>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {detail.establishment.sector} · {detail.establishment.postalCode} · offre{' '}
            {detail.establishment.plan}
          </div>
        </div>
      </div>

      {openAlerts.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 15 }}>Alertes ouvertes</h2>
          {openAlerts.map((alert) => (
            <div
              key={alert.id}
              className="card"
              style={{
                borderLeft: `3px solid ${
                  alert.severity === 'critical' ? 'var(--critical)' : 'var(--warning)'
                }`,
              }}
            >
              <div className="spread">
                <strong style={{ fontSize: 15 }}>{alert.title}</strong>
                <SeverityBadge severity={alert.severity} />
              </div>
              <p className="muted" style={{ fontSize: 14, margin: '6px 0 0' }}>
                {alert.body}
              </p>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                {relativeDays(alert.createdAt)}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="kpi">
        <Kpi
          label={`Note moyenne (${overview.windowDays} j)`}
          value={num(metrics.averageRating)}
          hint={
            delta === 0
              ? 'stable sur la période précédente'
              : `${signed(delta)} vs période précédente`
          }
          tone={delta < -0.1 ? 'critical' : delta > 0.1 ? 'positive' : 'neutral'}
        />
        <Kpi label="Avis reçus" value={String(metrics.total)} hint={`${metrics.negativeCount} négatifs`} />
        <Kpi
          label="Réponses aux avis négatifs"
          value={percent(metrics.negativeReplyRate)}
          tone={metrics.negativeReplyRate >= 0.8 ? 'positive' : 'warning'}
          hint={
            metrics.overdueCount > 0
              ? `${metrics.overdueCount} au-delà de 24 h`
              : 'aucun retard'
          }
        />
        <Kpi
          label="Délai médian de réponse"
          value={metrics.medianReplyDelayHours == null ? '—' : `${metrics.medianReplyDelayHours} h`}
          hint="objectif : moins de 24 h"
        />
        <Kpi label="Scans NFC" value={String(overview.scans.total)} hint={`${overview.loyaltyMembers} membres fidélité`} />
        <Kpi
          label="Conversion scan → avis"
          value={
            overview.scanToReviewRate == null ? '—' : percent(overview.scanToReviewRate)
          }
          hint="avis publiés rapportés aux scans"
        />
      </section>

      {overview.trends.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Tendances détectées</h2>
          <div className="stack">
            {overview.trends.map((trend) => (
              <div key={trend.theme} className="spread" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: 14.5 }}>{trend.label}</strong>
                  <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
                    {trend.message}
                  </p>
                </div>
                <SeverityBadge severity={trend.severity} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Thèmes cités</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Extraits automatiquement du texte des avis.
          </p>
          {overview.themes.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>
              Pas encore assez d’avis analysés.
            </p>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {overview.themes.slice(0, 6).map((theme) => (
                <div key={theme.theme}>
                  <div className="spread" style={{ fontSize: 14, marginBottom: 5 }}>
                    <span>{theme.label}</span>
                    <span className="muted">
                      {theme.mentions} avis · {num(theme.averageRating, 1)}/5
                    </span>
                  </div>
                  <Bar
                    share={theme.share * 100}
                    tone={
                      theme.sentiment === 'negative'
                        ? 'var(--critical)'
                        : theme.sentiment === 'neutral'
                          ? 'var(--warning)'
                          : 'var(--positive)'
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Répartition par plateforme</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Le routage NFC envoie chaque client vers la plateforme la plus en retard.
          </p>
          <div className="stack" style={{ gap: 14 }}>
            {overview.platforms.map((platform) => (
              <div key={platform.platform}>
                <div className="spread" style={{ fontSize: 14, marginBottom: 5 }}>
                  <span>{platform.label}</span>
                  <span className="muted">
                    {platform.reviewCount} avis
                    {platform.averageRating != null && ` · ${num(platform.averageRating, 1)}/5`}
                  </span>
                </div>
                <Bar share={platform.share} />
                {platform.routedScans > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {platform.routedScans} scans routés depuis la dernière synchronisation
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 15 }}>Scans par jour</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {overview.scans.total} sur {overview.windowDays} jours
          </span>
        </div>
        <Sparkline values={overview.scans.byDay.map((d) => d.count)} />
      </section>

      {detail.features.analytics && (
        <section className="card">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 15, marginBottom: 4 }}>Rapport mensuel</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
                Envoyé automatiquement le 1er de chaque mois. Vous pouvez le
                télécharger à tout moment pour le transmettre à votre équipe.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '9px 14px', fontSize: 14 }}
              onClick={async () => {
                // Le PDF est servi derrière le jeton : on le récupère puis on
                // ouvre l'objet local plutôt qu'un simple lien.
                const response = await fetch(`${API_URL}/establishments/${id}/report.pdf`, {
                  headers: { authorization: `Bearer ${getToken() ?? ''}` },
                });
                if (!response.ok) return;
                const url = URL.createObjectURL(await response.blob());
                window.open(url, '_blank', 'noopener');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }}
            >
              Télécharger le PDF
            </button>
          </div>
        </section>
      )}

      {detail.features.benchmark && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Benchmark sectoriel</h2>
          {benchmark ? (
            <>
              <p style={{ fontSize: 14.5, margin: '0 0 12px' }}>{benchmark.summary}</p>
              <div className="row" style={{ gap: 24 }}>
                <div>
                  <div className="kpi-label">Vous</div>
                  <div className="kpi-value">{num(benchmark.averageRating.self)}</div>
                </div>
                <div>
                  <div className="kpi-label">Médiane des pairs</div>
                  <div className="kpi-value">{num(benchmark.averageRating.peerMedian)}</div>
                </div>
                <div>
                  <div className="kpi-label">Établissements comparés</div>
                  <div className="kpi-value">{benchmark.peerCount}</div>
                </div>
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              {benchmarkNote || 'Calcul en cours…'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
