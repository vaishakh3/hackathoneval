import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Use Vercel's authenticated client for protected staging; never extract or print its bypass credential.
export async function deploymentFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (process.env.DESK_TEST_PROTECTED !== '1') return fetch(input, init);
  const request = new Request(input, init);
  const url = new URL(input);
  const directory = await mkdtemp(path.join(tmpdir(), 'desk-http-'));
  const headersFile = path.join(directory, 'request-headers');
  const responseHeaders = path.join(directory, 'response-headers');
  const responseBody = path.join(directory, 'response-body');
  try {
    await writeFile(
      headersFile,
      [...request.headers].map(([k, v]) => `${k}: ${v}`).join('\n'),
      { mode: 0o600 },
    );
    const args = [
      'curl',
      url.pathname + url.search,
      '--deployment',
      url.origin,
      '--scope',
      'team_nC5rrnpOuiWBRfA6TYMALVSw',
      '--',
      '--silent',
      '--show-error',
      '--max-time',
      '120',
      '--request',
      request.method,
      '--header',
      `@${headersFile}`,
      '--dump-header',
      responseHeaders,
      '--output',
      responseBody,
    ];
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : Buffer.from(await request.arrayBuffer());
    if (body) args.push('--data-binary', '@-');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('vercel', args, {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      child.stderr.resume();
      child.stdin.end(body);
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Authenticated deployment request failed.')),
      );
    });
    const text = await readFile(responseHeaders, 'utf8');
    const blocks = text.trim().split(/\r?\n\r?\n/);
    const block = blocks.at(-1)!;
    const lines = block.split(/\r?\n/);
    const status = Number(lines.shift()!.split(' ')[1]);
    const headers = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon > 0)
        headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    return new Response(await readFile(responseBody), { status, headers });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
