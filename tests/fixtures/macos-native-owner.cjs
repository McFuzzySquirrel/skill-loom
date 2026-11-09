const { spawn } = require('node:child_process');

const broker = spawn('/usr/bin/sudo', ['-n', ...process.argv.slice(2)], {
  stdio: ['pipe', process.stdout, process.stderr],
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
});
broker.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
  process.stdin.pause();
});
broker.stdin.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
process.stdin.on('data', (data) => broker.stdin.write(data));
process.stdin.on('end', () => broker.stdin.end());
broker.on('exit', (code, signal) => {
  process.exitCode = signal === null ? (code ?? 1) : 1;
  process.stdin.pause();
});
