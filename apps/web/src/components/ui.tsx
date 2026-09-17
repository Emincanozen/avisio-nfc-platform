/** Primitives d'affichage partagées par le tableau de bord. */

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating} sur 5`}>
      {'★'.repeat(full)}
      <span style={{ opacity: 0.3 }}>{'★'.repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}) {
  const color =
    tone === 'positive'
      ? 'var(--positive)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'critical'
          ? 'var(--critical)'
          : 'var(--text)';
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Micro-histogramme des scans par jour.
 * Rendu en CSS pur : une librairie de graphiques pour 30 barres coûterait plus
 * en poids de page qu'elle n'apporte.
 */
export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="sparkline" aria-hidden>
      {values.map((value, index) => (
        <span key={index} style={{ height: `${Math.max(3, (value / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function Bar({ share, tone }: { share: number; tone?: string }) {
  return (
    <div className="bar-track">
      <div
        className="bar-fill"
        style={{ width: `${Math.min(100, Math.max(2, share))}%`, background: tone }}
      />
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: 'info' | 'warning' | 'critical' }) {
  const map = {
    info: ['badge-neutral', 'Information'],
    warning: ['badge-warning', 'À surveiller'],
    critical: ['badge-critical', 'Critique'],
  } as const;
  const [className, label] = map[severity];
  return <span className={`badge ${className}`}>{label}</span>;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  return formatDate(iso);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}
