'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Empty, formatDate } from '@/components/ui';

interface ManagerRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin';
  establishmentIds: string[];
  createdAt: string;
}

export default function AccountsPage() {
  const [managers, setManagers] = useState<ManagerRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'admin'>('admin');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setManagers(await api<ManagerRow[]>('/admin/managers'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/admin/managers', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role, establishmentIds: [] }),
      });
      setMessage(`Compte ${email} créé.`);
      setName('');
      setEmail('');
      setPassword('');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Empty>{error}</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Nouveau compte</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Un compte <strong>admin</strong> accède au back-office et à tout le parc.
          Un compte <strong>gérant</strong> ne voit que les établissements qui lui
          sont rattachés — pour en créer un, passez par l’onboarding.
        </p>
        <form className="row" onSubmit={create}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            placeholder="Nom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            style={{ width: 170 }}
            type="text"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <select
            className="input"
            style={{ width: 130 }}
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'admin')}
          >
            <option value="admin">Admin</option>
            <option value="owner">Gérant</option>
          </select>
          <button type="submit" className="btn btn-dark" disabled={busy}>
            {busy ? 'Création…' : 'Créer'}
          </button>
        </form>
      </section>

      {message && (
        <p className="card" style={{ fontSize: 14, margin: 0 }} role="status">
          {message}
        </p>
      )}

      {!managers && <Empty>Chargement…</Empty>}

      <section className="stack" style={{ gap: 8 }}>
        {managers?.map((manager) => (
          <div key={manager.id} className="card" style={{ padding: 14 }}>
            <div className="spread">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{manager.name}</strong>
                  <span
                    className={`badge ${manager.role === 'admin' ? 'badge-accent' : 'badge-neutral'}`}
                  >
                    {manager.role === 'admin' ? 'Admin' : 'Gérant'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                  {manager.email} · créé le {formatDate(manager.createdAt)}
                </div>
              </div>
              <span className="muted" style={{ fontSize: 13.5 }}>
                {manager.establishmentIds.length} établissement(s)
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
