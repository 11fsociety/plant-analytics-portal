'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
  }

  return (
    <button onClick={toggle} className="logout-btn" style={{ marginLeft: 8 }} aria-label="Toggle theme">
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
