/**
 * Builds the offline, self-hosted code studio bundles: the CodeMirror editor and the
 * xterm.js terminal (loaded only when a terminal opens). All bundled third-party
 * packages are MIT licensed; exact copyright/license texts from installed
 * packages are preserved at the end of each distributed file.
 */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundles = [
  { entry: 'tools/assets/learning-editor-entry.mjs', output: 'source/js/learning-editor.js', banner: 'Learning IDE editor: CodeMirror 6' },
  { entry: 'tools/assets/learning-terminal-entry.mjs', output: 'source/js/learning-terminal.js', banner: 'Learning IDE terminal: xterm.js' }
];
for (const bundle of bundles) {
  const outfile = join(root, bundle.output);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [bundle.entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'inline',
    loader: { '.css': 'text' },
    metafile: true,
    write: false,
    banner: { js: '/*! ' + bundle.banner + '. Rebuild with npm run build:learning-editor. */' }
  });

  const packageRoots = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packageRoots.add(join(root, 'node_modules', match[1]));
  }
  const notices = new Map();
  for (const packageRoot of [...packageRoots].sort()) {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.license !== 'MIT') throw new Error('Review license before distribution: ' + manifest.name);
    let license;
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
      try { license = (await readFile(join(packageRoot, name), 'utf8')).trim(); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license) throw new Error('Missing license: ' + manifest.name);
    const packages = notices.get(license) || [];
    packages.push(manifest.name + '@' + manifest.version);
    notices.set(license, packages);
  }
  const licenses = [...notices].map(([license, packages]) => packages.join(', ') + '\n\n' + license).join('\n\n===== Third-party license =====\n\n');
  const source = result.outputFiles[0].text + '\n/*! Bundled third-party licenses\n\n' + licenses.replaceAll('*/', '* /') + '\n*/\n';
  new Script(source, { filename: outfile });
  await writeFile(outfile, source);
  console.log('Built ' + outfile + ' (' + (Buffer.byteLength(source) / 1024).toFixed(1) + ' KiB); preserved ' + packageRoots.size + ' MIT dependency notices.');
}
