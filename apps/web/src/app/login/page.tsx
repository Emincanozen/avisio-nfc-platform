'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, setToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@avisio.fr');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setToken(result.token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <form className="card" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="eyebrow">Avisio</div>
        <h1 style={{ fontSize: 22, margin: '6px 0 18px' }}>Espace gérant</h1>

        <div className="stack">
          <label className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 13.5 }} className="muted">
              E-mail
            </span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="stack" style={{ gap: 6 }}>
            <span style={{ fontSize: 13.5 }} className="muted">
              Mot de passe
            </span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && (
            <p style={{ color: 'var(--critical)', fontSize: 14, margin: 0 }} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-dark" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>

        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 16 }}>
          Compte de démonstration pré-rempli : demo@avisio.fr / demo1234
        </p>
      </form>
    </main>
  );
}
