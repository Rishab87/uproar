import type { Metadata } from 'next';
import { NotificationsScreen } from '@/components/NotificationsScreen';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };

export default function NotificationsPage() {
  return <NotificationsScreen />;
}
