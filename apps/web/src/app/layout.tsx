import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Avisio — collecte et pilotage des avis clients',
  description:
    "Plaquette NFC, alertes sur les avis négatifs, routage multi-plateformes et analytics de réputation pour les commerces de proximité.",
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  // L'espace gérant s'installe sur l'écran d'accueil : c'est ce qui permet de
  // recevoir les alertes push sans application native.
  appleWebApp: { capable: true, title: 'Avisio', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#17171a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
