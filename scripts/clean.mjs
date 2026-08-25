import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));

if (dirname(outputDirectory) !== projectRoot.replace(/\/$/, '')) {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`);
}

rmSync(outputDirectory, { recursive: true, force: true });
