// Fail a build before old private source data can be published again.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkPrivateContent(root = process.cwd()) {
  const forbidden = [
    'source/_data/schedule.json', 'source/_data/nanaly-journal.json',
    'source/_data/noimpty-profile.md', 'source/_data/nanaly-usage.json'
  ];
  const present = forbidden.filter(file => fs.existsSync(path.join(root, file)));
  if (present.length) throw new Error('Private source data must stay outside the public repository: ' + present.join(', '));
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { checkPrivateContent(); console.log('Private source publication guard passed.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
