import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { DialogsProvider } from '~/features/shell/dialogs';
import { useNewCallShortcut } from '~/features/shell/NewCallMenu';
import { Sidebar } from '~/features/shell/Sidebar';
import { requireAccount } from '~/lib/guards';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: AppShell
});

function AppShell() {
  useNewCallShortcut();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <DialogsProvider>
      <div className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)] max-[900px]:grid-cols-1">
        <Sidebar />
        <motion.main key={path.split('/').slice(0, 2).join('/')} className="min-w-0 px-[clamp(24px,3.4vw,56px)] pb-24 pt-[30px]"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 0.8, 0.24, 1] }}>
          <div className="mx-auto max-w-[1240px]"><Outlet /></div>
        </motion.main>
      </div>
    </DialogsProvider>
  );
}
