import type { Metadata } from 'next';
import { DeskApp } from '@/components/desk/app';
import './desk.css';

export const metadata: Metadata = {
  title: 'Devin Hacks Kochi — Build Desk',
  description:
    'A fair look at every build. Continuous project evaluation and thoughtful hackathon shortlisting.',
  robots: { index: false, follow: false },
};

export default function DeskPage() {
  return <DeskApp />;
}
