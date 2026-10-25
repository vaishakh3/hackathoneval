'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Flag,
  FolderKanban,
  GitBranch,
  LayoutGrid,
  Layers2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { DeskState } from '@/lib/desk/types';
import { Auth } from './auth';
import {
  Coverage,
  HelpDesk,
  Overview,
  Projects,
  Settings,
  Shortlist,
} from './organizer';
import { Participant } from './participant';
import { MentorQueue, ReviewSession } from './mentor';
import { ProjectDetail } from './project-detail';
import { GithubTrackerView } from './github-tracker';
import { Modal, request, type Action } from './ui';

const organizerNav = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'github', label: 'GitHub tracker', icon: GitBranch },
  { id: 'reviews', label: 'Mentor reviews', icon: ClipboardCheck },
  { id: 'shortlist', label: 'Shortlist', icon: Flag },
];
const mentorNav = [
  { id: 'queue', label: 'Your review queue', icon: ClipboardCheck },
  { id: 'help', label: 'Support desk', icon: CircleHelp },
];
const participantNav = [
  { id: 'workspace', label: 'Your project', icon: FolderKanban },
];

export function DeskApp() {
  const requestEpoch = useRef(0);
  const [data, setData] = useState<DeskState | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState('');
  const [view, setView] = useState('overview');
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [menu, setMenu] = useState(false);
  const [guide, setGuide] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [refreshing, setRefreshing] = useState(false);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const go = useCallback((next: string) => {
    setView(next);
    setMenu(false);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  const ready = useCallback(
    (next: DeskState) => {
      setData(next);
      setSelected(null);
      setReview(null);
      go(
        next.user.role === 'organizer'
          ? 'overview'
          : next.user.role === 'mentor'
            ? 'queue'
            : 'workspace',
      );
    },
    [go],
  );
  const load = useCallback(async () => {
    const epoch = requestEpoch.current;
    try {
      const next = await request();
      if (epoch !== requestEpoch.current) return;
      setData((current) =>
        current &&
        next.user &&
        current.user.id === next.user.id &&
        current.event.revision > next.event.revision
          ? current
          : next.user
            ? next
            : null,
      );
      setInitialError('');
    } catch (error) {
      setInitialError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);
  useEffect(() => {
    const listener = () => setView(window.location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', listener);
    queueMicrotask(listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const signedIn = !!data;
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(
      () => {
        if (!document.hidden) void load();
      },
      initialError ? 60000 : 30000,
    );
    const wake = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [signedIn, load, initialError]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const act: Action = useCallback(
    async (action, args, success) => {
      const epoch = ++requestEpoch.current;
      try {
        const next = await request(action, args);
        if (epoch === requestEpoch.current)
          setData((current) =>
            current &&
            next.user &&
            current.user.id === next.user.id &&
            current.event.revision > next.event.revision
              ? current
              : next.user
                ? next
                : null,
          );
        if (success) notify(success);
        return next;
      } catch (error) {
        notify((error as Error).message, true);
        throw error;
      }
    },
    [notify],
  );
  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menu]);
  async function signOut(create = false) {
    try {
      await act('logout');
      setAuthMode(create ? 'create' : 'login');
      setSelected(null);
      setReview(null);
    } catch {}
  }
  if (loading)
    return (
      <div className="desk d-loading">
        <span className="d-brand-mark">
          <Layers2 size={22} />
        </span>
        <p>Opening your workspace…</p>
      </div>
    );
  if (!data)
    return (
      <div className="desk">
        {initialError && (
          <div className="d-connection-error" role="alert">
            {initialError}
            <button onClick={load}>Try again</button>
          </div>
        )}
        <Auth onReady={ready} initialMode={authMode} />
      </div>
    );
  const { event, user } = data;
  const nav =
    user.role === 'organizer'
      ? organizerNav
      : user.role === 'mentor'
        ? mentorNav
        : participantNav;
  const openHelp = event.help.filter((h) => h.status !== 'resolved').length;
  const selectedCount = event.projects.filter((p) => p.shortlisted).length;
  const currentNav = [
    ...nav,
    { id: 'help', label: 'Support desk' },
    { id: 'settings', label: 'Event settings' },
  ].find((n) => n.id === view);
  const props = { data, act, openProject: setSelected, go };
  const reviewProject = event.projects.find((p) => p.id === review);
  let content;
  if (user.role === 'participant') content = <Participant {...props} />;
  else if (view === 'help') content = <HelpDesk {...props} />;
  else if (user.role === 'mentor')
    content = <MentorQueue {...props} onReview={setReview} />;
  else if (view === 'projects') content = <Projects {...props} />;
  else if (view === 'github') content = <GithubTrackerView {...props} />;
  else if (view === 'reviews') content = <Coverage {...props} />;
  else if (view === 'shortlist') content = <Shortlist {...props} />;
  else if (view === 'settings') content = <Settings {...props} />;
  else content = <Overview {...props} />;
  return (
    <div className="desk d-app">
      {menu && (
        <button
          className="d-mobile-backdrop"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`d-sidebar ${menu ? 'is-open' : ''}`}>
        <Link href="/desk" className="d-wordmark">
          <span className="d-brand-mark">
            <Layers2 size={20} strokeWidth={1.7} />
          </span>
          Build Desk
          <span className="d-mobile-close">
            <X size={16} />
          </span>
        </Link>
        <div className="d-event-switch">
          <span className="d-event-monogram">
            D<span>·</span>
          </span>
          <div>
            <strong>{event.name}</strong>
            <small>{event.venue || 'Your event workspace'}</small>
          </div>
          <span className="d-event-dot" title="Active event" />
        </div>
        <span className="d-nav-label">Workspace</span>
        <nav className="d-nav" aria-label="Workspace navigation">
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={
                currentNav?.id === item.id ||
                (!currentNav && item.id === nav[0].id)
                  ? 'is-active'
                  : ''
              }
              onClick={() => {
                setView(item.id);
                setMenu(false);
              }}
            >
              <item.icon size={17} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === 'shortlist' && <small>{selectedCount}</small>}
              {item.id === 'help' && openHelp > 0 && <small>{openHelp}</small>}
            </a>
          ))}
        </nav>
        {user.role === 'organizer' && (
          <>
            <span className="d-nav-label d-nav-secondary">
              Event management
            </span>
            <nav className="d-nav" aria-label="Event management">
              <a
                href="#help"
                className={view === 'help' ? 'is-active' : ''}
                onClick={() => go('help')}
              >
                <CircleHelp size={17} strokeWidth={1.7} />
                <span>Support desk</span>
                {openHelp > 0 && (
                  <small className="d-help-count">{openHelp}</small>
                )}
              </a>
              <a
                href="#settings"
                className={view === 'settings' ? 'is-active' : ''}
                onClick={() => go('settings')}
              >
                <Settings2 size={17} strokeWidth={1.7} />
                <span>Event settings</span>
              </a>
            </nav>
          </>
        )}
        <div className="d-sidebar-bottom">
          <div className="d-event-status">
            <span className="d-live-dot" />
            <div>
              <strong>
                {event.stage === 'shortlisted'
                  ? 'Lineup approved'
                  : 'The build is on'}
              </strong>
              <small>{event.checkpoints[event.currentCheckpoint].title}</small>
            </div>
          </div>
          <button className="d-help-guide" onClick={() => setGuide(true)}>
            <CircleHelp size={15} />A quick field guide
            <ArrowUpRight size={13} />
          </button>
          <div className="d-user">
            <span className="d-avatar">
              {user.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <button
              className="d-icon-btn"
              onClick={() => signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="d-main-column">
        <header className="d-topbar">
          <button
            className="d-icon-btn d-mobile-menu"
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="d-breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={12} />
            <span>{event.name}</span>
            <ChevronRight size={12} />
            <strong>{currentNav?.label || nav[0].label}</strong>
          </div>
          <div className="d-top-actions">
            {user.role === 'organizer' && (
              <button
                className="d-header-search"
                onClick={() => {
                  go('projects');
                  setTimeout(
                    () =>
                      document
                        .querySelector<HTMLInputElement>(
                          'input[aria-label="Search projects"]',
                        )
                        ?.focus(),
                    100,
                  );
                }}
                aria-label="Search projects"
              >
                <Search size={16} />
              </button>
            )}
            <button
              className="d-icon-btn"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              aria-label="Refresh event"
            >
              <RefreshCw size={15} className={refreshing ? 'd-spin' : ''} />
            </button>
            <span className="d-top-divider" />
            {event.demo ? (
              <label className="d-role-select">
                <span className="d-sr-only">Preview role</span>
                <select
                  value={user.role}
                  onChange={async (e) => {
                    try {
                      ready(await act('demo-role', { role: e.target.value }));
                    } catch {}
                  }}
                >
                  <option value="organizer">Organizer view</option>
                  <option value="mentor">Mentor view</option>
                  <option value="participant">Participant view</option>
                </select>
                <ChevronDown size={12} />
              </label>
            ) : (
              <span className="d-role-label">{user.role} workspace</span>
            )}
          </div>
        </header>
        {event.demo && (
          <div className="d-sample-bar">
            <span>
              <span className="d-sample-label">Sample event</span>
              <span className="d-sample-description">
                Fictional projects. Your own sandbox. Live AI runs in real
                events.
              </span>
            </span>
            <button onClick={() => signOut(true)}>
              Create your event
              <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {initialError && (
          <div className="d-connection-error" role="alert">
            Connection interrupted. Your last saved view is shown.{' '}
            <button onClick={load}>Try again</button>
          </div>
        )}
        <main className="d-content">{content}</main>
      </div>
      {selected && event.projects.some((p) => p.id === selected) && (
        <ProjectDetail
          key={selected}
          {...props}
          projectId={selected}
          onClose={() => setSelected(null)}
          onReview={(id) => {
            setSelected(null);
            setReview(id);
          }}
        />
      )}
      {reviewProject && (
        <ReviewSession
          key={`${reviewProject.id}-${reviewProject.submissions.at(-1)?.id}`}
          data={data}
          act={act}
          project={reviewProject}
          onClose={() => setReview(null)}
        />
      )}
      {guide && (
        <Modal
          title="A quick field guide"
          subtitle="Keep the process clear. Give every builder a fair look."
          onClose={() => setGuide(false)}
        >
          <div className="d-form-body d-guide">
            <section>
              <span>01</span>
              <div>
                <h3>Capture the work as it happens</h3>
                <p>
                  Builders submit three checkpoints. Each submission preserves
                  its project details and evidence, and starts an AI assessment.
                </p>
              </div>
            </section>
            <section>
              <span>02</span>
              <div>
                <h3>Let people form their own view</h3>
                <p>
                  Mentors see project facts first. AI ratings unlock after an
                  independent review. Conflicts exclude a mentor’s scores, even
                  if declared later.
                </p>
              </div>
            </section>
            <section>
              <span>03</span>
              <div>
                <h3>Bring the standouts to the panel</h3>
                <p>
                  Organizers choose 5–10 demos. Every selected project needs two
                  independent final reviews and a selection reason. Every
                  submitted project needs at least one final review.
                </p>
              </div>
            </section>
            <Link className="d-back-community" href="/">
              <ArrowLeft size={14} />
              Back to Codex Kochi
            </Link>
          </div>
        </Modal>
      )}
      <div
        className={`d-toast ${toast ? 'is-visible' : ''} ${toast?.error ? 'is-error' : ''}`}
        role={toast?.error ? 'alert' : 'status'}
        aria-live={toast?.error ? 'assertive' : 'polite'}
      >
        {toast && (
          <>
            {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
            <span>{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
