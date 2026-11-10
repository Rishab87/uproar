import type { ReactNode } from 'react';
import { AppShell } from '@/components/Shell';
import { Sidebar } from '@/components/Sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell side={<Sidebar />}>{children}</AppShell>;
}
