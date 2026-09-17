'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api, clearToken } from '@/lib/api';
import { Empty } from '@/components/ui';

const TABS = [
  { href: '/admin', label: 'Vue d’ensemble' },
  { href: '/admin/parc', label: 'Parc' },
  { href: '/admin/factures', label: 'Factures' },
  { href: '/admin/nouveau', label: 'Nouvel établissement' },
  { href: '/admin/comptes', label: 'Comptes' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking');

  useEffect(() => {
    // Le rôle est vérifié côté serveur à chaque appel ; ce contrôle évite
    // simplement d'afficher une coquille vide à un gérant qui tape l'URL.
    api<{ manager: { role: string } }>('/auth/me')
      .then((result) => setState(result.manager.role === 'admin' ? 'allowed' : 'denied'))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace('/login');
          return;
        }
        setState('denied');
      });
  }, [router]);

  if (state === 'checking') {
    return (
      <main className="container" style={{ padding: '28px 16px' }}>
        <Empty>Vérification du compte…</Empty>
      </main>
    );
  }

  if (state === 'denied') {
    return (
      <main className="container" style={{ padding: '28px 16px' }}>
        <Empty>
          Cet espace est réservé aux comptes d’exploitation.{' '}
          <Link href="/dashboard">Retour à votre tableau de bord</Link>.
        </Empty>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: '28px 16px 64px' }}>
      <div className="spread" style={{ marginBottom: 4 }}>
        <div>
          <div className="eyebrow">Avisio · exploitation</div>
          <h1 style={{ fontSize: 24, marginTop: 4 }}>Back-office</h1>
        </div>
        <div className="row">
          <Link href="/dashboard" className="btn btn-ghost" style={{ padding: '9px 14px', fontSize: 14 }}>
            Espace gérant
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '9px 14px', fontSize: 14 }}
            onClick={() => {
              clearToken();
              router.replace('/login');
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>

      <nav className="nav" style={{ marginTop: 16 }}>
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className={pathname === tab.href ? 'active' : ''}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}
