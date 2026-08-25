'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function NavClient() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === '/login') return null;

  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/upload', label: 'Upload' },
    { href: '/reports', label: 'Reports' },
  ];

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  }

  return (
    <header>
      <Link href="/" className="brand">Plant Analytics</Link>
      <nav>
        {links.map(l => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>{l.label}</Link>
        ))}
        <button className="logout-btn" onClick={logout}>Logout</button>
      </nav>
    </header>
  );
}
