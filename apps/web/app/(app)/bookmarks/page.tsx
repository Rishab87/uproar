import type { Metadata } from 'next';
import { BookmarksScreen } from '@/components/BookmarksScreen';

export const metadata: Metadata = { title: 'Bookmarks', robots: { index: false } };

export default function BookmarksPage() {
  return <BookmarksScreen />;
}
