'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api, clearToken } from '@/lib/api';
import type { Establishment } from '@/lib/types';
import { Empty } from '@/components/ui';

const PLAN_LABELS: Record<string, string> = {
  essentiel: 'Essentiel',
  pro: 'Pro',
  premium: 'Premium',
};

export default function DashboardHome() {
  const router = useRouter();
  const [establishments, setEstablishments] = useState<Establishment[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Establishment[]>('/establishments')
      .then(setEstablishments)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Chargement impossible.');
      });

    // Le back-office n'est proposé qu'aux comptes qui y ont droit ; l'API
    // refuse de toute façon les autres.
    api<{ manager: { role: string } }>('/auth/me')
      .then((result) => setIsAdmin(result.manager.role === 'admin'))
      .catch(() => setIsAdmin(false));
  }, [router]);

  return (
    <main className="container" style={{ padding: '32px 16px 64px' }}>
      <div className="spread" style={{ marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Avisio</div>
          <h1 style={{ fontSize: 26 }}>Vos établissements</h1>
        </div>
        <div className="row">
          {isAdmin && (
            <Link href="/admin" className="btn btn-dark">
              Back-office
            </Link>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              clearToken();
              router.replace('/login');
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>

      {error && <Empty>{error}</Empty>}
      {!establishments && !error && <Empty>Chargement…</Empty>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {establishments?.map((establishment) => (
          <Link
            key={establishment.id}
            href={`/dashboard/${establishment.id}`}
            className="card"
            style={{ textDecoration: 'none' }}
          >
            <div className="spread">
              <strong style={{ fontSize: 17 }}>{establishment.name}</strong>
              <span className="badge badge-accent">{PLAN_LABELS[establishment.plan]}</span>
            </div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
              {establishment.sector} · {establishment.postalCode}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
