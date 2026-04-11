import { Outlet } from 'react-router';
import { Suspense } from 'react';

export function RootLayout() {
  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-64 border-r border-zinc-800 bg-zinc-900 lg:block">
        <nav className="flex flex-col gap-1 p-4">
          <a href="/" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800">
            Dashboard
          </a>
          <a href="/events" className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800">
            Eventi
          </a>
          <a
            href="/settings"
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            Impostazioni
          </a>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-zinc-500">
              Caricamento...
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
