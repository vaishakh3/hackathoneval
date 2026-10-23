import type {
  Criterion,
  DeskEvent,
  Evaluation,
  Project,
  ProjectSignal,
  Review,
} from './types';

export function totalScore(
  scores: Record<string, number | null>,
  rubric: Criterion[],
): number | null {
  if (rubric.some((c) => scores[c.id] == null)) return null;
  return (
    Math.round(
      rubric.reduce(
        (sum, c) => sum + (Number(scores[c.id]) / 5) * c.weight,
        0,
      ) * 10,
    ) / 10
  );
}

export function validReviews(event: DeskEvent, project: Project): Review[] {
  const latest = project.submissions.at(-1);
  return event.reviews.filter(
    (r) =>
      r.projectId === project.id &&
      r.kind === 'final' &&
      r.submissionId === latest?.id &&
      !event.conflicts.some(
        (c) => c.projectId === project.id && c.mentorId === r.mentorId,
      ),
  );
}

export function latestEvaluation(
  event: DeskEvent,
  project: Project,
): Evaluation | undefined {
  return event.evaluations.find(
    (e) => e.submissionId === project.submissions.at(-1)?.id,
  );
}

export function signals(event: DeskEvent): ProjectSignal[] {
  return event.projects.map((project) => {
    const latest = project.submissions.at(-1);
    const evaluation = latestEvaluation(event, project);
    const finals = validReviews(event, project);
    const totals = finals
      .map((r) => totalScore(r.scores, event.rubric))
      .filter((n): n is number => n != null);
    const humanScore = totals.length
      ? totals.reduce((a, b) => a + b, 0) / totals.length
      : null;
    const aiScore = evaluation?.assessment
      ? totalScore(
          Object.fromEntries(
            evaluation.assessment.criteria.map((c) => [c.id, c.score]),
          ),
          evaluation.rubric,
        )
      : null;
    const attention: string[] = [];
    if (!latest || latest.checkpoint < event.currentCheckpoint)
      attention.push('Update due');
    if (latest && !finals.length && event.stage !== 'building')
      attention.push('Review needed');
    if (
      aiScore != null &&
      humanScore != null &&
      Math.abs(aiScore - humanScore) >= 15
    )
      attention.push('AI–human disagreement');
    if (totals.length > 1 && Math.max(...totals) - Math.min(...totals) >= 20)
      attention.push('Reviewer disagreement');
    if (evaluation?.status === 'failed') attention.push('AI retry needed');
    if (project.needsReview) attention.push('Second look requested');
    if (
      event.help.some(
        (h) => h.projectId === project.id && h.status !== 'resolved',
      )
    )
      attention.push('Needs support');
    return {
      project,
      latest,
      evaluation,
      humanScore,
      aiScore,
      finalReviews: finals.length,
      checkins: event.reviews.filter(
        (r) => r.projectId === project.id && r.kind === 'check-in',
      ).length,
      attention,
    };
  });
}

export function rankedSignals(event: DeskEvent): ProjectSignal[] {
  return signals(event).sort(
    (a, b) =>
      (b.humanScore ?? -1) - (a.humanScore ?? -1) ||
      a.project.number - b.project.number,
  );
}

export function queueFor(event: DeskEvent, mentorId: string): ProjectSignal[] {
  const ranked = rankedSignals(event).filter((s) => s.humanScore != null);
  const cutoff = ranked[event.shortlistTarget - 1]?.humanScore;
  const spread = (projectId: string) => {
    let hash = 2166136261;
    for (const char of `${mentorId}:${projectId}`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    hash ^= hash >>> 16;
    return hash >>> 0;
  };
  return signals(event)
    .filter(
      (s) =>
        s.latest &&
        !event.conflicts.some(
          (c) => c.mentorId === mentorId && c.projectId === s.project.id,
        ),
    )
    .filter(
      (s) =>
        !event.reviews.some(
          (r) =>
            r.projectId === s.project.id &&
            r.mentorId === mentorId &&
            r.submissionId === s.latest?.id &&
            r.kind === (event.stage === 'building' ? 'check-in' : 'final'),
        ),
    )
    .sort((a, b) => {
      const priority = (s: ProjectSignal) =>
        (s.project.needsReview ? 50 : 0) +
        ((
          event.stage === 'building'
            ? !event.reviews.some(
                (r) =>
                  r.projectId === s.project.id &&
                  r.submissionId === s.latest?.id &&
                  r.kind === 'check-in',
              )
            : s.finalReviews === 0
        )
          ? 40
          : 0) +
        (s.project.shortlisted && s.finalReviews < 2 ? 45 : 0) +
        (cutoff != null &&
        s.humanScore != null &&
        Math.abs(s.humanScore - cutoff) <= 5
          ? 15
          : 0) +
        (s.attention.some((a) => a.includes('disagreement')) ? 30 : 0) -
        (event.reviews.some(
          (r) => r.projectId === s.project.id && r.mentorId === mentorId,
        )
          ? 100
          : 0);
      return (
        priority(b) - priority(a) || spread(a.project.id) - spread(b.project.id)
      );
    });
}

export function addAudit(event: DeskEvent, actor: string, text: string) {
  event.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor,
    text,
  });
  event.audit = event.audit.slice(0, 1000);
}

export function shortlistProblems(event: DeskEvent): string[] {
  const selected = event.projects.filter((p) => p.shortlisted);
  const problems: string[] = [];
  if (selected.length !== event.shortlistTarget)
    problems.push(
      `Select exactly ${event.shortlistTarget} projects before approving.`,
    );
  for (const project of selected) {
    if (!project.submissions.some((s) => s.checkpoint === 2))
      problems.push(`${project.title} needs a final submission.`);
    if (validReviews(event, project).length < 2)
      problems.push(
        `${project.title} needs two independent final reviews of its latest submission.`,
      );
    if (!project.shortlistReason.trim())
      problems.push(`${project.title} needs a selection reason.`);
  }
  const unreviewed = event.projects.filter(
    (p) =>
      p.submissions.some((s) => s.checkpoint === 2) &&
      !validReviews(event, p).length,
  );
  if (unreviewed.length)
    problems.push(
      `${unreviewed.length} submitted projects still need their first final review.`,
    );
  return problems;
}

export function csvCell(value: string | number | boolean | null | undefined) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
