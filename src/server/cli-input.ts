import type { Readable } from 'node:stream';

export class CliInputError extends Error {}

export async function readJsonStdin(stream: Readable): Promise<unknown> {
  if ('isTTY' in stream && stream.isTTY === true) {
    throw new CliInputError('Provide a JSON request on stdin.');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += bytes.length;
    if (length > 64 * 1024) throw new CliInputError('The stdin request exceeds 64 KiB.');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new CliInputError('Stdin must contain one JSON request.');
  }
}
