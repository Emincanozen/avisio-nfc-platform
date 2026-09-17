'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, clearToken } from '@/lib/api';
import { Empty, relativeDays } from '@/components/ui';

interface Tag {
  id: string;
  label: string;
  slug: string;
  material: 'sticker' | 'chevalet' | 'premium';
  scanCount: number;
  lastScanAt?: string;
  url: string;
  fitsOnNtag213: boolean;
}

const MATERIALS: Record<Tag['material'], string> = {
  sticker: 'Sticker',
  chevalet: 'Chevalet',
  premium: 'Premium personnalisé',
};

export default function TagsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [tags, setTags] = useState<Tag[] | null>(null);
  const [label, setLabel] = useState('');
  const [material, setMaterial] = useState<Tag['material']>('sticker');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      setTags(await api<Tag[]>(`/establishments/${id}/tags`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (label.trim().length < 2) return;
    try {
      await api<Tag>(`/establishments/${id}/tags`, {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), material }),
      });
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
    }
  };

  if (error) return <Empty>{error}</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Nouvelle plaquette</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Chaque plaquette porte une URL unique : les scans sont comptés par
          emplacement, ce qui permet de savoir où la plaquette fonctionne.
        </p>
        <form className="row" onSubmit={create}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Emplacement (comptoir, terrasse, addition…)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <select
            className="input"
            style={{ width: 220 }}
            value={material}
            onChange={(event) => setMaterial(event.target.value as Tag['material'])}
          >
            {Object.entries(MATERIALS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-dark">
            Créer
          </button>
        </form>
      </section>

      {!tags && <Empty>Chargement…</Empty>}

      {tags?.map((tag) => (
        <div key={tag.id} className="card">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong style={{ fontSize: 16 }}>{tag.label}</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {MATERIALS[tag.material]} · {tag.scanCount} scans
                {tag.lastScanAt && ` · dernier ${relativeDays(tag.lastScanAt)}`}
              </div>
            </div>
            <span className={`badge ${tag.fitsOnNtag213 ? 'badge-positive' : 'badge-critical'}`}>
              {tag.fitsOnNtag213 ? 'Encodable NTAG213' : 'URL trop longue'}
            </span>
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <code
              style={{
                flex: 1,
                minWidth: 220,
                background: 'var(--surface-2)',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13.5,
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {tag.url}
            </code>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '9px 14px', fontSize: 14 }}
              onClick={() => {
                void navigator.clipboard?.writeText(tag.url);
                setCopied(tag.id);
                setTimeout(() => setCopied(''), 1800);
              }}
            >
              {copied === tag.id ? 'Copié' : 'Copier'}
            </button>
            <a
              className="btn btn-ghost"
              style={{ padding: '9px 14px', fontSize: 14 }}
              href={tag.url}
              target="_blank"
              rel="noreferrer"
            >
              Tester
            </a>
          </div>
        </div>
      ))}

      <p className="muted" style={{ fontSize: 13 }}>
        Encodage : écrire cette URL sur une puce NTAG213 en enregistrement NDEF de
        type URI, puis verrouiller la puce en lecture seule avant la pose.
      </p>
    </div>
  );
}
