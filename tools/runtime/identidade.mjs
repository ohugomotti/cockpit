import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executable = path.resolve(process.argv[2] || '');
const relative = path.relative(path.join(root, 'artifacts'), executable);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(executable) !== 'Cockpit.exe') throw Error('Executável deve estar nos artefatos isolados deste projeto.');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'src/package.json')));
await rcedit(executable, {
  icon: path.join(root, 'src/assets/icon.ico'),
  'version-string': { ProductName: 'Cockpit', FileDescription: 'Cockpit', CompanyName: 'Cockpit', InternalName: 'Cockpit', OriginalFilename: 'Cockpit.exe' },
  'file-version': version,
  'product-version': version,
  'requested-execution-level': 'asInvoker',
});
console.log(JSON.stringify({ executable, productName: 'Cockpit', version, icon: 'src/assets/icon.ico' }));
