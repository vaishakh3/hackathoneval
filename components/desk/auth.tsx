'use client';

import Link from 'next/link';
import { useEffect, useState, type SubmitEvent } from 'react';
import { ArrowRight, ArrowUpRight, Layers2, ShieldCheck } from 'lucide-react';
import type { DeskState } from '@/lib/desk/types';
import { Button, Field, request } from './ui';

export function Auth({
  onReady,
  initialMode = 'login',
}: {
  onReady: (data: DeskState) => void;
  initialMode?: string;
}) {
  const [mode, setMode] = useState(initialMode);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [template, setTemplate] = useState<Record<string, unknown> | null>(
    null,
  );
  const [templateName, setTemplateName] = useState('');
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get('join');
    if (invite)
      queueMicrotask(() => {
        setCode(invite);
        setMode('join');
      });
  }, []);
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(mode);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      onReady(
        await request(mode, {
          ...values,
          ...(mode === 'create' && template ? { template } : {}),
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function sample() {
    setBusy('demo');
    setError('');
    try {
      onReady(await request('demo'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <main className="d-auth">
      <section className="d-auth-story">
        <Link href="/" className="d-wordmark">
          <span className="d-brand-mark">
            <Layers2 size={20} strokeWidth={1.7} />
          </span>
          Build Desk<span className="d-byline">by Codex Kochi</span>
        </Link>
        <div className="d-auth-pitch">
          <p className="d-eyebrow">Devin Hacks Kochi</p>
          <h1>
            A fair look at
            <br />
            every build.
          </h1>
          <p>
            Keep up with the room. Give thoughtful feedback.
            <br className="d-desktop" /> Find the projects ready for their
            moment.
          </p>
          <div className="d-auth-preview">
            <div className="d-preview-heading">
              <span className="d-live-dot" />
              The build, in perspective<span>100 solo projects</span>
            </div>
            {[
              [
                '01',
                'Every project has a story',
                'A timeline from first idea to working demo.',
              ],
              [
                '02',
                'Two independent perspectives',
                'AI evidence and human judgment, side by side.',
              ],
              [
                '03',
                'A shortlist you can stand behind',
                '5–10 demos. A clear reason for every selection.',
              ],
            ].map(([n, title, text]) => (
              <div className="d-auth-step" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <footer className="d-auth-footer">
          <span>Kochi, Kerala</span>
          <span>Built for people who build.</span>
        </footer>
      </section>
      <section className="d-auth-form-wrap">
        <div className="d-auth-form">
          <div
            className="d-auth-tabs"
            role="tablist"
            aria-label="Account options"
          >
            {[
              ['login', 'Sign in'],
              ['create', 'Create event'],
              ['join', 'Join event'],
            ].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="d-eyebrow">Your workspace awaits</p>
          <h2>
            {mode === 'create'
              ? 'Bring the room together.'
              : mode === 'join'
                ? 'You’re in the right place.'
                : 'Welcome back.'}
          </h2>
          <p className="d-auth-subtitle">
            {mode === 'create'
              ? 'Set up your event. Invite your builders and mentors.'
              : mode === 'join'
                ? 'Use the invitation from your event organizer.'
                : 'Sign in to pick up where you left off.'}
          </p>
          <form key={mode} onSubmit={submit}>
            {mode !== 'login' && (
              <Field label="Your name">
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Full name"
                />
              </Field>
            )}
            {mode === 'create' && (
              <>
                <Field label="Event name">
                  <input
                    name="eventName"
                    required
                    minLength={3}
                    maxLength={100}
                    defaultValue="Devin Hacks Kochi"
                    placeholder="Event name"
                  />
                </Field>
                {process.env.NODE_ENV === 'production' && (
                  <Field
                    label="Organizer access code"
                    hint="Provided by the deployment owner. Participants and mentors should use Join event."
                  >
                    <input
                      name="organizerCode"
                      type="password"
                      autoComplete="off"
                      required
                      maxLength={200}
                    />
                  </Field>
                )}
                <details className="d-template-import">
                  <summary>Reuse an event setup</summary>
                  <Field
                    label="Event template"
                    hint={
                      templateName ||
                      'Optional. Import a saved schedule and rubric; invitations and projects start fresh.'
                    }
                  >
                    <input
                      type="file"
                      accept="application/json,.json"
                      aria-label="Import event template"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        setTemplate(null);
                        setTemplateName('');
                        setError('');
                        if (!file) return;
                        try {
                          if (file.size > 50000)
                            throw new Error(
                              'Choose a template smaller than 50 KB.',
                            );
                          const value: unknown = JSON.parse(await file.text());
                          if (
                            !value ||
                            typeof value !== 'object' ||
                            Array.isArray(value)
                          )
                            throw new Error('Choose a valid event template.');
                          setTemplate(value as Record<string, unknown>);
                          setTemplateName(`${file.name} · ready to use`);
                        } catch (error) {
                          setError(
                            error instanceof SyntaxError
                              ? 'That file is not valid JSON.'
                              : (error as Error).message,
                          );
                        }
                      }}
                    />
                  </Field>
                </details>
              </>
            )}
            {mode === 'join' && (
              <Field
                label="Invite code"
                hint="Your code determines your participant or mentor access."
              >
                <input
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="BUILD-XXXXXXXX"
                />
              </Field>
            )}
            <Field label="Email address">
              <input
                name="email"
                autoComplete="email"
                type="email"
                required
                maxLength={200}
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label="Password"
              hint={mode !== 'login' ? 'At least 10 characters.' : undefined}
            >
              <input
                name="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                type="password"
                required
                minLength={mode === 'login' ? 1 : 10}
                maxLength={128}
                placeholder={
                  mode === 'login'
                    ? 'Your password'
                    : 'Create a strong password'
                }
              />
            </Field>
            {error && (
              <p className="d-form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              primary
              type="submit"
              busy={busy === mode}
              disabled={!!busy}
              className="d-full"
            >
              {mode === 'create'
                ? 'Create your event'
                : mode === 'join'
                  ? 'Join the event'
                  : 'Sign in'}
              <ArrowRight size={16} />
            </Button>
          </form>
          {process.env.NODE_ENV !== 'production' && (
            <>
              <div className="d-auth-divider">
                <span>Take a look around first</span>
              </div>
              <Button
                className="d-full"
                onClick={sample}
                busy={busy === 'demo'}
                disabled={!!busy}
              >
                Explore a sample event
                <ArrowUpRight size={15} />
              </Button>
              <p className="d-auth-note">
                <ShieldCheck size={14} />
                100 fictional projects. All three perspectives. Your own
                sandbox.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
