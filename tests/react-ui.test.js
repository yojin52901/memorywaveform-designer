import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://editor.test/' });
  const { window } = dom;
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    SVGElement: window.SVGElement,
    Node: window.Node,
    ShadowRoot: window.ShadowRoot,
    getComputedStyle: window.getComputedStyle
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  window.PointerEvent ??= window.MouseEvent;
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent });
  window.matchMedia ??= () => ({ addEventListener() {}, addListener() {}, matches: false, removeEventListener() {}, removeListener() {} });
  window.ResizeObserver ??= class { disconnect() {} observe() {} unobserve() {} };
  window.SVGElement.prototype.setPointerCapture ??= () => {};
  window.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame ??= (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

async function loadEditorModule() {
  const testCache = resolve(root, '.test-cache');
  const output = resolve(testCache, `Editor-${process.pid}-${Date.now()}.mjs`);
  await mkdir(testCache, { recursive: true });
  await build({
    entryPoints: [resolve(root, 'src/react/Editor.jsx')],
    bundle: true,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'antd', '@ant-design/icons'],
    format: 'esm',
    jsx: 'automatic',
    outfile: output,
    platform: 'node'
  });
  try {
    return await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  } finally {
    await rm(output, { force: true });
  }
}

test('the mounted React editor retains example, authoring, JSON, and repair workflows', async () => {
  const dom = installDom();
  const React = (await import('react')).default;
  const { fireEvent, render, waitFor, within } = await import('@testing-library/react');
  const userEvent = (await import('@testing-library/user-event')).default;
  const { Editor } = await loadEditorModule();
  const user = userEvent.setup({ document: window.document });
  const view = render(React.createElement(Editor, {
    account: { email: 'designer@gmail.com' },
    onLogout() {}
  }));
  const ui = within(view.container);

  assert.ok(ui.getByText('Memory Waveform Designer'));
  await user.click(ui.getByRole('button', { name: /Example document$/ }));
  await waitFor(() => assert.ok(ui.getByText('VDD')));
  assert.equal(ui.getByRole('button', { name: /Export JSON$/ }).disabled, false);
  const canvas = view.container.querySelector('#waveform-canvas');
  const svg = canvas.querySelector('svg');
  const panSurface = canvas.querySelector('[data-canvas-pan-surface]');
  fireEvent.pointerDown(panSurface, { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 60, pointerId: 1 });
  assert.equal(canvas.scrollLeft, 40);
  fireEvent.pointerUp(svg, { clientX: 60, pointerId: 1 });

  await user.click(ui.getByText('JSON'));
  await waitFor(() => assert.match(ui.getByText(/Example document — ENVM/).textContent, /schemaVersion/));
  await user.click(ui.getByText('Waveform'));
  await user.click(ui.getByText('Add signal'));
  await user.type(ui.getByPlaceholderText('WE#'), 'TEST_SIGNAL');
  await user.click(ui.getAllByRole('button', { name: /Add signal$/ }).find((element) => element.tagName === 'BUTTON'));
  await waitFor(() => assert.ok(ui.getByText('TEST_SIGNAL')));

  const fileInput = view.container.querySelector('input[type="file"]');
  assert.ok(fileInput);
  const invalidFile = new window.File(['{not json'], 'invalid.json', { type: 'application/json' });
  Object.defineProperty(invalidFile, 'text', { value: async () => '{not json' });
  await user.upload(fileInput, invalidFile);
  await waitFor(() => assert.ok(ui.getByText('Repair imported JSON')));
  assert.equal(view.container.querySelector('#waveform-canvas'), null);
  assert.ok(ui.getByText('Validation errors'));

  view.unmount();
  dom.window.close();
});
