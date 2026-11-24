import {readFile, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const output = new URL('../../outputs/练习资源/', import.meta.url);
const katex = new URL('./node_modules/katex/dist/', import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('reader.mjs', import.meta.url))],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  legalComments: 'eof'
});
await writeFile(new URL('reader.js', output), bundle.outputFiles[0].contents);

const css = await readFile(new URL('katex.min.css', katex), 'utf8');
const urls = /url\(fonts\/([\w-]+\.woff2)\)\s*format\(["']?woff2["']?\)[^;}]+/g;
let offline = css;
for (const [declaration, filename] of css.matchAll(urls)) {
  const font = await readFile(new URL('fonts/' + filename, katex));
  offline = offline.replace(declaration, 'url(data:font/woff2;base64,' + font.toString('base64') + ') format("woff2")');
}
if (!offline.includes('data:font/woff2') || offline.includes('url(fonts/')) {
  throw new Error('KaTeX font declarations changed; review the offline font build.');
}
const layout = '.katex-display{overflow-x:auto;overflow-y:hidden;padding:.15em 0}.katex{font-size:1.1em}';
await writeFile(new URL('practice-math.css', output), offline + '\n' + layout + '\n');
