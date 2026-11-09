import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface Route { path: string; parts: string[]; query: URLSearchParams }
const Ctx = createContext<{ route: Route; go: (to: string) => void }>({ route: parse('/'), go: () => {} });

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q] = raw.split('?');
  return { path: p, parts: p.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((to: string) => {
    location.hash = to;
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }, []);
  return <Ctx.Provider value={{ route, go }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);
