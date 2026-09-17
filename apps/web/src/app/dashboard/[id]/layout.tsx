'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use } from 'react';

const TABS = [
  { href: '', label: 'Vue d’ensemble' },
  { href: '/avis', label: 'Avis & réponses' },
  { href: '/plaquettes', label: 'Plaquettes NFC' },
  { href: '/caisse', label: 'Caisse' },
  { href: '/factures', label: 'Abonnement & factures' },
  { href: '/notifications', label: 'Notifications' },
];

export default function EstablishmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname();
  const base = `/dashboard/${id}`;

  return (
    <main className="container" style={{ padding: '28px 16px 64px' }}>
      <Link
        href="/dashboard"
        className="muted"
        style={{ fontSize: 13.5, textDecoration: 'none' }}
      >
        ← Tous les établissements
      </Link>

      <nav className="nav" style={{ marginTop: 16 }}>
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          return (
            <Link key={tab.href} href={href} className={pathname === href ? 'active' : ''}>
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </main>
  );
}
