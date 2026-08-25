'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Login failed');
        return;
      }
      router.push(params.get('next') || '/');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <h1>Plant Analytics</h1>
      {error && <div className="error-msg">{error}</div>}
      <label>Email</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
      <label>Password</label>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button className="btn" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-shell">
      <Suspense fallback={<div className="login-card"><h1>Plant Analytics</h1></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
