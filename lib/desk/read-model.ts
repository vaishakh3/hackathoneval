import type { DeskEvent } from './types';

export function compactWorkspaceEvent(event: DeskEvent, includeTracker = true) {
  if (!includeTracker) delete event.githubTracker;
  else if (event.githubTracker) {
    for (const repo of Object.values(event.githubTracker.repositories)) {
      for (const judgment of repo.judgments || []) {
        delete judgment.assessment;
        delete judgment.sources;
        delete judgment.coverage;
      }
    }
  }
  return event;
}

// Project large review bodies out inside Postgres, before they cross the network.
export function workspaceEventSql(includeTracker = true) {
  const projection = includeTracker
    ? `CASE
    WHEN jsonb_typeof(e.data::jsonb #> '{githubTracker,repositories}') IS DISTINCT FROM 'object' THEN e.data::jsonb
    ELSE jsonb_set(e.data::jsonb, '{githubTracker,repositories}', COALESCE((
      SELECT jsonb_object_agg(repo.key, CASE
        WHEN jsonb_typeof(repo.value->'judgments') IS DISTINCT FROM 'array' THEN repo.value
        ELSE jsonb_set(repo.value, '{judgments}', COALESCE((
          SELECT jsonb_agg(job.value - 'assessment' - 'sources' - 'coverage' ORDER BY job.ordinality)
          FROM jsonb_array_elements(repo.value->'judgments') WITH ORDINALITY AS job(value, ordinality)
        ), '[]'::jsonb)) END)
      FROM jsonb_each(e.data::jsonb #> '{githubTracker,repositories}') AS repo(key,value)
    ), '{}'::jsonb)) END`
    : `(e.data::jsonb - 'githubTracker')`;
  return `SELECT (${projection})::text AS data FROM events e WHERE e.id=?`;
}

export const repositoryReadSql = `SELECT
  (data::jsonb #> ARRAY['githubTracker','repositories',?])::text AS data
  FROM events WHERE id=?`;
