'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';

/**
 * Inscription au programme de fidélité.
 *
 * Le formulaire ne demande ni le nom, ni la note, ni rien d'autre qu'un moyen
 * de retrouver le compte. Le contact est haché côté serveur avant stockage.
 * Aucun champ ne porte sur l'avis : les points sont dus au dépôt, pas au sens.
 */
export function LoyaltyForm({
  slug,
  intro,
  cta,
  placeholder,
}: {
  slug: string;
  intro: string;
  cta: string;
  placeholder: string;
}) {
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (contact.trim().length < 5) return;
    setState('loading');
    try {
      const response = await fetch(`${API_URL}/public/tag/${slug}/loyalty`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact: contact.trim(),
          channel: contact.includes('@') ? 'email' : 'sms',
        }),
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'refus');
      setMessage(body.message ?? '');
      setState('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '');
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div
        className="card"
        style={{ marginTop: 20, background: 'var(--positive-soft)', borderColor: 'transparent' }}
      >
        <strong style={{ color: 'var(--positive)' }}>{message}</strong>
      </div>
    );
  }

  return (
    <form className="card" style={{ marginTop: 20, textAlign: 'left' }} onSubmit={submit}>
      <div style={{ fontSize: 14, fontWeight: 550, marginBottom: 10 }}>{intro}</div>
      <input
        className="input"
        type="text"
        inputMode="email"
        autoComplete="email"
        placeholder={placeholder}
        value={contact}
        onChange={(event) => setContact(event.target.value)}
      />
      <button
        type="submit"
        className="btn btn-ghost"
        style={{ width: '100%', marginTop: 10 }}
        disabled={state === 'loading'}
      >
        {cta}
      </button>
      {state === 'error' && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }} role="alert">
          {message || 'Enregistrement impossible pour le moment.'}
        </p>
      )}
    </form>
  );
}
