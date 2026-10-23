import { randomUUID } from 'node:crypto';
import { get, put, del } from '@vercel/blob';
import { db, schemaName, usesPostgres, transaction } from './database';
import { getEvent, requireThat } from './store';

export type EvidenceFile = {
  id: string;
  event_id: string;
  project_id: string;
  mime: string;
  content: Uint8Array | null;
  blob_path: string | null;
};
export async function evidenceFile(
  id: string,
  eventId: string,
  projectId?: string,
) {
  return (await db()
    .prepare(
      `SELECT * FROM files WHERE id=? AND event_id=?${projectId ? ' AND project_id=?' : ''}`,
    )
    .get(id, eventId, ...(projectId ? [projectId] : []))) as
    | EvidenceFile
    | undefined;
}
export async function evidenceContent(file: EvidenceFile) {
  if (file.content) return new Uint8Array(file.content);
  requireThat(file.blob_path, 'Evidence not found.', 404);
  const result = await get(file.blob_path, { access: 'private' });
  requireThat(result?.statusCode === 200, 'Evidence not found.', 404);
  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  requireThat(bytes.length <= 2000000, 'Evidence exceeds the image limit.');
  return bytes;
}
export async function storeEvidence(
  eventId: string,
  projectId: string,
  mime: string,
  content: Uint8Array,
) {
  const id = randomUUID();
  let pathname: string | null = null;
  if (usesPostgres()) {
    const blob = await put(
      `${schemaName()}/${eventId}/${projectId}/${id}`,
      Buffer.from(content),
      { access: 'private', addRandomSuffix: false, contentType: mime },
    );
    pathname = blob.pathname;
  }
  try {
    await transaction(async () => {
      const event = await getEvent(eventId);
      requireThat(
        event.stage !== 'shortlisted',
        'Evidence uploads are closed.',
      );
      const count = (await db()
        .prepare('SELECT count(*) AS n FROM files WHERE project_id=?')
        .get(projectId)) as { n: number | string };
      requireThat(
        Number(count.n) < 30,
        'This project has reached its 30-image limit.',
      );
      await db()
        .prepare(
          'INSERT INTO files(id,event_id,project_id,mime,content,blob_path) VALUES(?,?,?,?,?,?)',
        )
        .run(id, eventId, projectId, mime, pathname ? null : content, pathname);
    }, `event:${eventId}`);
  } catch (error) {
    if (pathname) await del(pathname).catch(() => {});
    throw error;
  }
  return id;
}
