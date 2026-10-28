import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const included = new Set(['package.json', 'LICENSE', 'desktop', 'skills']);
const outputs = await packager({
  dir: root, name: 'Tidewatch', platform: 'win32', arch: 'x64',
  out: path.join(root, 'release'), overwrite: true, asar: false, prune: false,
  icon: path.join(root, 'skills/tidewatch/assets/tidewatch.ico'),
  ignore: relative => {
    const first = relative.replaceAll('\\', '/').split('/').filter(Boolean)[0];
    return !!first && !included.has(first);
  },
});
for (const output of outputs) console.log(output);
