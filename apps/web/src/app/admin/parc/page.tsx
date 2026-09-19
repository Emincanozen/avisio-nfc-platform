'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Empty, Stars, formatDate, num } from '@/components/ui';

interface Row {
  id: string;
  name: string;
  sector: string;
  postalCode: string;
  plan: string;
  addons: string[];
  status: string;
  mrrCents: number;
  mrrLabel: string;
  startedAt: string;
  commitmentEndsAt: string | null;
  overdueInvoices: number;
  reviews: number;
  averageRating: number;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'badge-positive',
  trialing: 'badge-accent',
  past_due: 'badge-warning',
  suspended: 'badge-critical',
  canceled: 'badge-neutral',
  none: 'badge-neutral',
};

const PLANS = ['essentiel', 'pro', 'premium'] as const;
const ADDONS = ['negative_reviews', 'extra_platform', 'analytics', 'loyalty'] as const;

export default function ParcPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await api<Row[]>('/admin/establishments'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Empty>{error}</Empty>;
  if (!rows) return <Empty>Chargement…</Empty>;

  const totalMrr = rows.reduce((acc, row) => acc + row.mrrCents, 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          {rows.length} établissement(s) · {(totalMrr / 100).toFixed(2).replace('.', ',')} € de MRR
        </p>
        <Link href="/admin/nouveau" className="btn btn-dark" style={{ padding: '9px 14px', fontSize: 14 }}>
          Nouvel établissement
        </Link>
      </div>

      {message && (
        <p className="card" style={{ fontSize: 14, margin: 0 }} role="status">
          {message}
        </p>
      )}

      {rows.map((row) => (
        <div key={row.id} className="card">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: 16 }}>{row.name}</strong>
                <span className={`badge ${STATUS_BADGE[row.status] ?? 'badge-neutral'}`}>
                  {row.status}
                </span>
                <span className="badge badge-accent">{row.plan}</span>
                {row.overdueInvoices > 0 && (
                  <span className="badge badge-critical">
                    {row.overdueInvoices} impayé(s)
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                {row.sector} · {row.postalCode} · client depuis le {formatDate(row.startedAt)}
                {row.commitmentEndsAt && ` · engagé jusqu’au ${formatDate(row.commitmentEndsAt)}`}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <Stars rating={row.averageRating} />
                <span className="muted" style={{ fontSize: 13 }}>
                  {num(row.averageRating)}/5 sur {row.reviews} avis
                </span>
              </div>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <strong style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
                {row.mrrLabel}
              </strong>
              <Link
                href={`/dashboard/${row.id}`}
                className="btn btn-ghost"
                style={{ padding: '8px 13px', fontSize: 13.5 }}
              >
                Ouvrir
              </Link>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '8px 13px', fontSize: 13.5 }}
                onClick={() => setEditing(editing === row.id ? null : row.id)}
              >
                Offre
              </button>
            </div>
          </div>

          {editing === row.id && (
            <PlanEditor
              row={row}
              onDone={async (text) => {
                setMessage(text);
                setEditing(null);
                await load();
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PlanEditor({ row, onDone }: { row: Row; onDone: (message: string) => void }) {
  const [plan, setPlan] = useState(row.plan);
  const [addons, setAddons] = useState<string[]>(row.addons);
  const [busy, setBusy] = useState(false);

  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      // L'abonnement est retrouvé par l'établissement : le back-office ne
      // manipule jamais d'identifiant technique à la main.
      const info = await api<{ subscription: { id: string } }>(
        `/establishments/${row.id}/subscription`,
      );
      const result = await api<{ prorationLabel: string; monthlyLabel: string }>(
        `/admin/subscriptions/${info.subscription.id}`,
        { method: 'PATCH', body: JSON.stringify({ plan, addons }) },
      );
      onDone(
        `${row.name} : offre ${plan}, ${result.monthlyLabel}/mois. Prorata sur la prochaine facture : ${result.prorationLabel}.`,
      );
    } catch (err) {
      onDone(err instanceof Error ? err.message : 'Changement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="stack"
      style={{ gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}
    >
      <div className="row" style={{ gap: 8 }}>
        {PLANS.map((value) => (
          <button
            key={value}
            type="button"
            className={`btn ${plan === value ? 'btn-dark' : 'btn-ghost'}`}
            style={{ padding: '7px 13px', fontSize: 13.5 }}
            onClick={() => setPlan(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 12 }}>
        {ADDONS.map((addon) => (
          <label key={addon} className="row" style={{ gap: 6, fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={addons.includes(addon)}
              onChange={() =>
                setAddons((current) =>
                  current.includes(addon)
                    ? current.filter((a) => a !== addon)
                    : [...current, addon],
                )
              }
            />
            <span>{addon}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '9px 15px', fontSize: 14 }}
          disabled={busy}
          onClick={() => void apply()}
        >
          {busy ? 'Application…' : 'Appliquer avec prorata'}
        </button>
      </div>
    </div>
  );
}
