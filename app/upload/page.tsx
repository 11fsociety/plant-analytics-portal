'use client';
import { useState } from 'react';
import { upload } from '@vercel/blob/client';

type IngestLog = { filename: string; kind: string; inserted: number; skipped: number; at: string };

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<IngestLog[]>([]);

  async function loadLog() {
    const d = await fetch('/api/data').then(r => r.json()).catch(() => null);
    if (d?.ingest_log) setLog(d.ingest_log);
  }

  useState(() => { loadLog(); return undefined; });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setProgress(2);
    setStatus('Requesting upload token...');
    setResult(null);

    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        onUploadProgress: p => {
          setProgress(Math.max(5, Math.round(p.percentage * 0.85)));
          setStatus(`Uploading (${Math.round(p.percentage)}%)`);
        },
      });
      setProgress(92);
      setStatus('Uploaded. Waiting for server to parse and merge...');
      // The onUploadCompleted webhook runs the ingest. Poll /api/data to see counts refresh.
      const before = log[0]?.at || '';
      let done = false;
      for (let i = 0; i < 30 && !done; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const d = await fetch('/api/data').then(r => r.json());
        const latest = d.ingest_log?.[0];
        if (latest && latest.at !== before && latest.filename.endsWith(file.name)) {
          setResult(latest);
          setLog(d.ingest_log);
          done = true;
          break;
        }
      }
      if (!done) setStatus('Uploaded but ingest confirmation timed out. Refresh in a moment.');
      else { setStatus('Done'); setProgress(100); }
    } catch (err: any) {
      setStatus('Failed: ' + (err.message || String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Upload new Excel</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Auto-detects production / downtime / scrap files. Re-uploading the same file is safe (content-hash dedup).
        Direct-to-Blob upload bypasses Vercel's 4.5 MB serverless body limit.
      </p>

      <form className="upload-box" onSubmit={handleUpload}>
        <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} required />
        <br /><br />
        <button className="btn" type="submit" disabled={!file || busy}>{busy ? 'Uploading...' : 'Upload & ingest'}</button>
      </form>

      {progress > 0 && (
        <div className="progress-wrap">
          <div className="progress-msg">{status}</div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{progress}%</div>
        </div>
      )}

      {result && (
        <div className="insight-block">
          <h3>Ingest result</h3>
          <div>Kind: <strong>{result.kind || 'unrecognized'}</strong></div>
          <div>Inserted: <strong>{result.inserted}</strong></div>
          <div>Skipped as duplicate: <strong>{result.skipped}</strong></div>
        </div>
      )}

      <h2>Ingest log</h2>
      <table>
        <thead><tr><th>Time</th><th>File</th><th>Kind</th><th className="num">Inserted</th><th className="num">Skipped</th></tr></thead>
        <tbody>
          {log.length === 0 ? <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No uploads yet.</td></tr> :
            log.map((l, i) => (
              <tr key={i}>
                <td>{l.at?.slice(0, 19).replace('T', ' ')}</td>
                <td>{l.filename}</td>
                <td>{l.kind}</td>
                <td className="num">{l.inserted}</td>
                <td className="num">{l.skipped}</td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </>
  );
}
