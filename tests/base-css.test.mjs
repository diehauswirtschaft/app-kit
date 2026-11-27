import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const name = '@diehauswirtschaft/app-kit';
const root = new URL('../', import.meta.url);

test('the JS base CSS export is the shared Python asset and ships in npm pack', () => {
  const asset = 'src/app_kit/assets/app-kit.css';
  const url = import.meta.resolve(`${name}/base.css`);
  assert.equal(url, new URL(asset, root).href);
  const css = readFileSync(new URL(url), 'utf8');
  assert.match(css, /html\s*\{[^}]*background:\s*var\(--dhw-surface\)/);
  assert.match(css, /\.dhw-main\s*\{[^}]*padding:/);

  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(root), encoding: 'utf8',
  }));
  assert.ok(pack.files.some(({ path }) => path === asset));
});
