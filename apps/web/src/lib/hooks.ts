import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type Theme = 'light' | 'dark' | 'system';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem('erp.theme');
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      return 'system';
    }
  });
  const apply = (t: Theme) => {
    setTheme(t);
    try {
      if (t === 'system') {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('erp.theme');
      } else {
        document.documentElement.dataset.theme = t;
        localStorage.setItem('erp.theme', t);
      }
    } catch {
      /* noop */
    }
  };
  return [theme, apply];
}
