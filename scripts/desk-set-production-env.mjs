import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
process.loadEnvFile('.env.local');
const team = 'team_nC5rrnpOuiWBRfA6TYMALVSw';
if (!process.env.OPENAI_API_KEY)
  throw new Error('The local OpenAI credential is missing.');
let code = process.env.ORGANIZER_SETUP_CODE;
if (!code) {
  code = randomBytes(24).toString('base64url');
  fs.appendFileSync('.env.local', `\nORGANIZER_SETUP_CODE=${code}\n`, {
    mode: 0o600,
  });
}
fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync(
  'outputs/organizer-access.txt',
  `Devin Hacks Kochi\n\nChoose Create event in the deployed workspace.\nOrganizer access code: ${code}\n\nUse your own name, email, and password. Participant and mentor invitation links will be available in Event settings after creating the event. Keep this organizer code private.\n`,
  { mode: 0o600 },
);
for (const [key, value] of [
  ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
  ['ORGANIZER_SETUP_CODE', code],
]) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      'vercel',
      ['env', 'add', key, 'production', '--sensitive', '--scope', team],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.stdin.end(value);
    child.on('error', reject);
    child.on('exit', (status) =>
      status === 0
        ? resolve()
        : reject(new Error(`Could not configure ${key}`)),
    );
  });
}
console.log(
  'Production credentials saved securely. Organizer access instructions: outputs/organizer-access.txt',
);
