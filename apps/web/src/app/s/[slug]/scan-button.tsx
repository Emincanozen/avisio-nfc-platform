'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';

/**
 * Bouton unique du parcours NFC.
 *
 * Le scan est enregistré au moment du tap — pas à l'affichage — pour que le
 * taux de conversion scan → avis mesure une intention réelle. La redirection
 * utilise `location.assign` afin que le retour arrière ramène sur cette page
 * plutôt que de boucler sur la plateforme d'avis.
 */
export function ScanButton({
  slug,
  label,
  redirectingLabel,
  errorLabel,
}: {
  slug: string;
  label: string;
  redirectingLabel: string;
  errorLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const go = async (): Promise<void> => {
    setState('loading');
    try {
      const response = await fetch(`${API_URL}/public/tag/${slug}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error('scan refusé');
      const body = (await response.json()) as { redirectUrl: string };
      window.location.assign(body.redirectUrl);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <button
        type="button"
        className="btn btn-primary cta"
        onClick={() => void go()}
        disabled={state === 'loading'}
      >
        {state === 'loading' ? redirectingLabel : label}
      </button>
      {state === 'error' && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }} role="alert">
          {errorLabel}
        </p>
      )}
    </div>
  );
}
