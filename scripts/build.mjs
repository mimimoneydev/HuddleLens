import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'logic.mjs', 'manifest.webmanifest', 'runtime-config.js']) {
  await cp(`src/${file}`, `dist/${file}`);
}
const vegaAssets = 'fire-tv-vega/assets';
await mkdir(vegaAssets, {recursive: true});
for (const file of ['index.html', 'styles.css', 'app.js', 'logic.mjs', 'manifest.webmanifest']) {
  await cp(`dist/${file}`, `${vegaAssets}/${file}`);
}
const simulatorApi = process.env.HUDDLELENS_API_BASE_URL || 'http://10.0.2.2:4173';
await writeFile(`${vegaAssets}/runtime-config.js`, `window.HUDDLELENS_CONFIG = {apiBaseUrl: ${JSON.stringify(simulatorApi)}};\n`);
console.log(`Built HuddleLens to dist/ and ${vegaAssets}/ (API: ${simulatorApi})`);
