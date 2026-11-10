import type { Metadata } from 'next';
import { AdminConsole } from '@/components/AdminConsole';

export const metadata: Metadata = { title: 'Operator console', robots: { index: false } };

export default function AdminPage() {
  return <AdminConsole />;
}
