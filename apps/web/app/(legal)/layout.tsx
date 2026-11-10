import type { ReactNode } from 'react';
import { AppShell } from '@/components/Shell';
import { Sidebar } from '@/components/Sidebar';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <AppShell side={<Sidebar />}>{children}</AppShell>;
}
