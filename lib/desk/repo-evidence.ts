import { gunzipSync } from 'node:zlib';
import type { ReviewCoverage, ReviewSource } from './repo-judge-types';

const COMPRESSED_LIMIT = 12 * 1024 * 1024;
const EXPANDED_LIMIT = 64 * 1024 * 1024;
export const SOURCE_CHARACTER_LIMIT = 720000;
export type SourceFile = ReviewSource & { text: string };
export type RepositoryBundle = {
  fullName: string;
  sha: string;
  sinceSha?: string;
  sources: ReviewSource[];
  batches: SourceFile[][];
  inventory: string[];
  changedPaths: string[];
  diff: string;
  coverage: ReviewCoverage;
};

async function boundedBytes(response: Response, maximum: number) {
  if (!response.ok)
    throw new Error(`Repository source unavailable (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Repository source was empty.');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum)
        throw new Error('Repository exceeds the source inspection size limit.');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}

function paxFields(bytes: Buffer) {
  const fields: Record<string, string> = {};
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(32, at);
    if (space < at) break;
    const length = Number(bytes.subarray(at, space).toString());
    if (
      !Number.isSafeInteger(length) ||
      length <= space - at + 1 ||
      at + length > bytes.length
    )
      break;
    const field = bytes.subarray(space + 1, at + length - 1).toString('utf8');
    const equal = field.indexOf('=');
    if (equal > 0) fields[field.slice(0, equal)] = field.slice(equal + 1);
    at += length;
  }
  return fields;
}

// Read regular tar members in memory; never extract, execute, or follow symlinks.
export function readRepositoryTar(tar: Buffer) {
  if (tar.length > EXPANDED_LIMIT)
    throw new Error('Expanded repository is too large.');
  const files: { path: string; bytes: Buffer }[] = [];
  let nextPath: string | undefined;
  for (let offset = 0, members = 0; offset + 512 <= tar.length; members++) {
    if (members > 50000)
      throw new Error('Repository has too many archive members.');
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .split('\0')[0];
    const sizeField = field(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeField))
      throw new Error('Unsupported archive size.');
    const size = Number.parseInt(sizeField, 8);
    const expectedChecksum = Number.parseInt(field(148, 8).trim(), 8);
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== expectedChecksum || offset + 512 + size > tar.length)
      throw new Error('Repository archive is corrupt or incomplete.');
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = field(156, 1);
    if (type === 'x') {
      nextPath = paxFields(body).path;
      continue;
    }
    if (type === 'L') {
      nextPath = body.toString('utf8').split('\0')[0];
      continue;
    }
    if (type === 'g') continue;
    const name =
      nextPath || [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    nextPath = undefined;
    if (type !== '' && type !== '0') continue;
    const parts = name.split('/');
    if (
      parts.length < 2 ||
      parts.some((p) => p === '..' || p === '.') ||
      name.startsWith('/') ||
      name.includes('\\')
    )
      continue;
    const path = parts.slice(1).join('/');
    if (!path || path.length > 500) continue;
    files.push({ path, bytes: body });
  }
  return files;
}

function eligible(path: string) {
  if (
    /(?:^|\/)(?:node_modules|vendor|\.git|\.next|dist|build|coverage|\.venv|venv|Pods|__pycache__|\.dart_tool)(?:\/|$)/i.test(
      path,
    )
  )
    return false;
  if (
    /(?:^|\/)(?:\.env(?:\..*)?|credentials[^/]*|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|lock|map|min\.js)$/i.test(
      path,
    )
  )
    return false;
  if (
    /(?:package-lock|pnpm-lock|yarn\.lock|bun\.lock|composer\.lock)/i.test(path)
  )
    return false;
  return (
    /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|kts|swift|dart|rb|php|cs|cpp|cc|c|h|vue|svelte|html|css|scss|sql|graphql|prisma|proto|sh|md|mdx|rst|txt|toml|ya?ml|json|xml)$/i.test(
      path,
    ) || /(?:^|\/)(?:Dockerfile|Makefile|Gemfile|Procfile)$/i.test(path)
  );
}
function kind(path: string): ReviewSource['kind'] {
  if (
    /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|\.)|\.(?:test|spec)\./i.test(path)
  )
    return 'test';
  if (/\.(?:md|mdx|rst|txt)$/i.test(path)) return 'documentation';
  if (
    /\.(?:json|toml|ya?ml|xml)$/i.test(path) ||
    /(?:Dockerfile|Makefile|Gemfile|Procfile)$/.test(path)
  )
    return 'configuration';
  return 'code';
}
function priority(path: string) {
  if (
    /^(?:README(?:\.md)?|package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pubspec\.yaml|requirements\.txt)$/i.test(
      path,
    )
  )
    return 0;
  if (
    /(?:^|\/)(?:routes?|pages?|controllers?|screens?)(?:\/|\.)|(?:^|\/)(?:main|index|app|server)\./i.test(
      path,
    )
  )
    return 1;
  if (kind(path) === 'test') return 3;
  if (kind(path) === 'documentation') return 4;
  return 2;
}
function redactCredentials(text: string) {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      (match) =>
        '[private key omitted]' + '\n'.repeat(match.split('\n').length - 1),
    )
    .replace(
      /\b(?:sk-(?:proj-)?[\w-]{20,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g,
      '[credential omitted]',
    );
}

export function selectRepositorySources(
  entries: { path: string; bytes: Buffer }[],
): { files: SourceFile[]; batches: SourceFile[][]; coverage: ReviewCoverage } {
  const eligibleEntries = entries.filter(
    (e) => eligible(e.path) && !e.bytes.includes(0),
  );
  const candidates = eligibleEntries
    .filter((e) => e.bytes.length <= 180000)
    .sort(
      (a, b) =>
        priority(a.path) - priority(b.path) || a.path.localeCompare(b.path),
    );
  const files: SourceFile[] = [];
  const omittedFiles: string[] = eligibleEntries
    .filter((e) => e.bytes.length > 180000)
    .map((e) => e.path);
  const truncatedFiles: string[] = [];
  let characters = 0;
  for (const entry of candidates) {
    const content = redactCredentials(entry.bytes.toString('utf8'));
    if (files.length >= 160 || characters >= SOURCE_CHARACTER_LIMIT) {
      omittedFiles.push(entry.path);
      continue;
    }
    let text = content.slice(0, SOURCE_CHARACTER_LIMIT - characters);
    if (text.length < content.length) {
      text = text.slice(0, text.lastIndexOf('\n') + 1);
      truncatedFiles.push(entry.path);
    }
    if (!text.trim()) continue;
    files.push({
      id: `F${files.length + 1}`,
      path: entry.path,
      kind: kind(entry.path),
      lines: content.split('\n').length,
      inspectedLines: text.split('\n').length,
      text,
    });
    characters += text.length;
  }
  const batches: SourceFile[][] = [];
  for (const file of files) {
    let batch = batches.at(-1);
    if (
      !batch ||
      batch.reduce((n, f) => n + f.text.length, 0) + file.text.length > 120000
    ) {
      batch = [];
      batches.push(batch);
    }
    batch.push(file);
  }
  return {
    files,
    batches,
    coverage: {
      archiveFiles: entries.length,
      eligibleFiles: eligibleEntries.length,
      inspectedFiles: files.length,
      inspectedCharacters: characters,
      omittedFiles,
      truncatedFiles,
      diffAvailable: false,
    } satisfies ReviewCoverage,
  };
}

async function treeSources(
  fullName: string,
  sha: string,
  request: typeof fetch,
) {
  const deadline = AbortSignal.timeout(70000);
  const headers: Record<string, string> = {
    'User-Agent': 'Build-Desk-Repository-Judge',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const tree: unknown = JSON.parse(
    (
      await boundedBytes(
        await request(
          `https://api.github.com/repos/${fullName}/git/trees/${sha}?recursive=1`,
          {
            headers,
            redirect: 'error',
            signal: AbortSignal.any([deadline, AbortSignal.timeout(12000)]),
          },
        ),
        6000000,
      )
    ).toString('utf8'),
  );
  if (
    !tree ||
    typeof tree !== 'object' ||
    !('tree' in tree) ||
    !Array.isArray(tree.tree)
  )
    throw new Error('Repository file tree was unavailable.');
  const files = (
    tree.tree as {
      path?: unknown;
      type?: unknown;
      mode?: unknown;
      size?: unknown;
    }[]
  )
    .filter(
      (e) =>
        e.type === 'blob' &&
        ['100644', '100755'].includes(String(e.mode)) &&
        typeof e.path === 'string' &&
        e.path.length < 500 &&
        !e.path.startsWith('/') &&
        !e.path.includes('\\') &&
        !e.path.split('/').some((p) => p === '..' || p === '.'),
    )
    .map((e) => ({
      path: e.path as string,
      size: typeof e.size === 'number' ? e.size : Infinity,
    }));
  const eligibleFiles = files.filter((e) => eligible(e.path));
  const candidates = eligibleFiles
    .filter((e) => e.size <= 180000)
    .sort(
      (a, b) =>
        priority(a.path) - priority(b.path) || a.path.localeCompare(b.path),
    )
    .slice(0, 160);
  const entries: { path: string; bytes: Buffer }[] = [];
  const received = new Set<string>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < candidates.length && !deadline.aborted) {
        const item = candidates[cursor++];
        try {
          const encoded = item.path
            .split('/')
            .map(encodeURIComponent)
            .join('/');
          const bytes = await boundedBytes(
            await request(
              `https://raw.githubusercontent.com/${fullName}/${sha}/${encoded}`,
              {
                redirect: 'error',
                signal: AbortSignal.any([deadline, AbortSignal.timeout(12000)]),
              },
            ),
            180000,
          );
          entries.push({ path: item.path, bytes });
          received.add(item.path);
        } catch {
          /* Preserve failed files as explicit omissions; never infer missing features. */
        }
      }
    }),
  );
  const selected = selectRepositorySources(entries);
  selected.coverage.archiveFiles = files.length;
  selected.coverage.eligibleFiles = eligibleFiles.length;
  selected.coverage.omittedFiles = [
    ...new Set([
      ...eligibleFiles.filter((e) => !received.has(e.path)).map((e) => e.path),
      ...selected.coverage.omittedFiles,
    ]),
  ];
  selected.coverage.sourceMethod = 'github-tree';
  selected.coverage.inventoryTruncated =
    'truncated' in tree && tree.truncated === true;
  return { selected, inventory: eligibleFiles.map((e) => e.path) };
}

export async function collectRepositoryEvidence(
  fullName: string,
  sha: string,
  sinceSha?: string,
  request: typeof fetch = fetch,
): Promise<RepositoryBundle> {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(fullName) ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    (sinceSha && !/^[a-f0-9]{40}$/.test(sinceSha))
  )
    throw new Error('Invalid pinned repository.');
  let selected: ReturnType<typeof selectRepositorySources>, inventory: string[];
  try {
    const response = await request(
      `https://codeload.github.com/${fullName}/tar.gz/${sha}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'Build-Desk-Repository-Judge' },
      },
    );
    const archive = await boundedBytes(response, COMPRESSED_LIMIT);
    const entries = readRepositoryTar(
      gunzipSync(archive, { maxOutputLength: EXPANDED_LIMIT }),
    );
    selected = selectRepositorySources(entries);
    selected.coverage.sourceMethod = 'archive';
    inventory = entries.filter((e) => eligible(e.path)).map((e) => e.path);
  } catch {
    ({ selected, inventory } = await treeSources(fullName, sha, request));
  }
  if (!selected.files.some((f) => f.kind === 'code'))
    throw new Error(
      'No inspectable application source was found in this revision.',
    );
  let diff = '';
  try {
    const path = sinceSha
      ? `compare/${sinceSha}...${sha}.diff`
      : `commit/${sha}.diff`;
    diff = redactCredentials(
      (
        await boundedBytes(
          await request(`https://github.com/${fullName}/${path}`, {
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Build-Desk-Repository-Judge' },
          }),
          400000,
        )
      ).toString('utf8'),
    );
    selected.coverage.diffAvailable = true;
  } catch {
    /* Full pinned source remains usable; the report must disclose the missing diff. */
  }
  const changedPaths = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)]
    .map((m) => m[1])
    .filter(eligible);
  const inspected = new Set(selected.files.map((f) => f.path));
  const safeDiff = diff
    .split(/(?=^diff --git )/m)
    .filter((section) => {
      const path =
        section.match(/^\+\+\+ b\/(.+)$/m)?.[1] ||
        section.match(/^--- a\/(.+)$/m)?.[1];
      return !!path && eligible(path) && inspected.has(path);
    })
    .join('')
    .slice(0, 60000);
  return {
    fullName,
    sha,
    sinceSha,
    sources: selected.files.map(({ text: _text, ...meta }) => meta),
    batches: selected.batches,
    inventory: inventory.slice(0, 2000),
    changedPaths: [...new Set(changedPaths)],
    diff: safeDiff,
    coverage: selected.coverage,
  };
}
