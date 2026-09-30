// `npm run dev`: start the DropToApp server (accounts API, login page) and
// Vite (the editor, with hot reload) together. Stop both with Ctrl+C.
import { spawn } from 'node:child_process';

const procs = [
  ['server', 'node --disable-warning=ExperimentalWarning --import tsx --watch server/index.ts'],
  ['vite  ', 'npx vite'],
].map(([name, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const tag = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join('\n') + '\n';
  p.stdout.on('data', (c) => process.stdout.write(tag(c)));
  p.stderr.on('data', (c) => process.stderr.write(tag(c)));
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code}); stopping.`);
    procs.forEach((q) => q !== p && q.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill('SIGINT')));
