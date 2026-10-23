'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react';
import type { DeskState, Project } from '@/lib/desk/types';

export type Action = (
  action: string,
  args?: Record<string, unknown>,
  success?: string,
) => Promise<DeskState>;
export type WorkspaceProps = {
  data: DeskState;
  act: Action;
  openProject: (id: string) => void;
  go: (view: string) => void;
};

export async function request(
  action?: string,
  args?: Record<string, unknown>,
): Promise<DeskState & { user: DeskState['user'] | null }> {
  const res = await fetch(
    '/api/desk',
    action
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, args }),
        }
      : { cache: 'no-store' },
  );
  const result = (await res.json()) as DeskState & { error?: string };
  if (!res.ok)
    throw new Error(
      result.error || 'Could not reach the event. Please try again.',
    );
  return result;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'purple' | 'amber' | 'red';
}) {
  return <span className={`d-badge d-badge-${tone}`}>{children}</span>;
}
export function Button({
  children,
  onClick,
  busy,
  primary,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      {...props}
      onClick={onClick}
      className={`d-btn ${primary ? 'd-btn-primary' : ''} ${className}`}
      disabled={busy || props.disabled}
    >
      {busy && <LoaderCircle size={15} className="d-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function ProjectMark({
  project,
  small = false,
}: {
  project: Project;
  small?: boolean;
}) {
  return (
    <span
      className={`d-project-mark ${small ? 'd-project-mark-small' : ''}`}
      style={{ '--mark-color': project.color } as React.CSSProperties}
      aria-hidden="true"
    >
      {project.title.slice(0, 1)}
    </span>
  );
}
export function Score({
  value,
  subdued,
}: {
  value: number | null;
  subdued?: boolean;
}) {
  return value == null ? (
    <span className="d-muted">—</span>
  ) : (
    <span className={`d-score ${subdued ? 'd-score-subdued' : ''}`}>
      {value.toFixed(value % 1 ? 2 : 0)}
      <span>/100</span>
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="d-empty">
      <span className="d-empty-mark" aria-hidden="true">
        <Check size={22} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="d-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`d-modal ${wide ? 'd-modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="d-modal-inner">
        <header className="d-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="d-icon-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="d-inline-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  );
}
export function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function dateTime(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function useDraft<T>(
  key: string,
  initial: T,
): [T, (value: T) => void, () => void] {
  const [value, setValue] = useState(initial);
  const initialRef = useRef(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      setValue(saved ? JSON.parse(saved) : initialRef.current);
    } catch {
      setValue(initialRef.current);
    }
  }, [key]);
  const save = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Form remains usable if browser storage is full. */
      }
    },
    [key],
  );
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [key]);
  return [value, save, clear];
}
