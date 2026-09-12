import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(projectRoot, 'dist');
const publicFiles = [
  'index.html',
  'assets/app.js',
  'assets/app.css'
];

const serverModules = [
  ['server/auth.js', 'auth.js'],
  ['server/login-page.js', 'login-page.js'],
  ['server/worker.js', 'worker.js'],
  ['server/index.js', 'runtime.js']
];

await mkdir(resolve(outputRoot, 'server'), { recursive: true });
await mkdir(resolve(outputRoot, '.openai'), { recursive: true });
await build({
  entryPoints: [resolve(projectRoot, 'src/react/main.jsx')],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  outdir: resolve(outputRoot, 'assets'),
  entryNames: 'app',
  assetNames: '[name]',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  sourcemap: false,
  logLevel: 'silent'
});
await writeFile(
  resolve(outputRoot, 'index.html'),
  await readFile(resolve(projectRoot, 'index.html'), 'utf8')
);

const assets = Object.fromEntries(await Promise.all(publicFiles.map(async (relativePath) => [
  `/${relativePath}`,
  await readFile(resolve(outputRoot, relativePath), 'utf8')
])));
const appSource = assets['/assets/app.js'];
const appSourceChunkSize = 300_000;
const appSourceChunks = Array.from(
  { length: Math.ceil(appSource.length / appSourceChunkSize) },
  (_, index) => appSource.slice(index * appSourceChunkSize, (index + 1) * appSourceChunkSize)
);
const appSourceExportNames = appSourceChunks.map((_, index) => `appSourcePart${index}`);

await Promise.all(serverModules.map(async ([sourcePath, outputPath]) => {
  await writeFile(resolve(outputRoot, 'server', outputPath), await readFile(resolve(projectRoot, sourcePath), 'utf8'));
}));
await Promise.all(appSourceChunks.map((source, index) => writeFile(
  resolve(outputRoot, 'server', `assets-app-${index}.js`),
  `export const ${appSourceExportNames[index]} = ${JSON.stringify(source)};\n`
)));
await writeFile(
  resolve(outputRoot, 'server', 'assets.js'),
  `${appSourceExportNames.map((name, index) => `import { ${name} } from './assets-app-${index}.js';`).join('\n')}

export const assets = {
  ${JSON.stringify('/index.html')}: ${JSON.stringify(assets['/index.html'])},
  ${JSON.stringify('/assets/app.js')}: ${appSourceExportNames.join(' + ')},
  ${JSON.stringify('/assets/app.css')}: ${JSON.stringify(assets['/assets/app.css'])}
};
`
);
await writeFile(
  resolve(outputRoot, 'server', 'index.js'),
  "import { assets } from './assets.js';\nimport { createProductionWorker } from './runtime.js';\n\nexport default createProductionWorker(assets);\n"
);
await writeFile(
  resolve(outputRoot, '.openai', 'hosting.json'),
  await readFile(resolve(projectRoot, '.openai', 'hosting.json'), 'utf8')
);
