// End-to-end tests for the web app, run against the built dist/ in Chromium.
//
// Real file pickers can't be driven headlessly, so tests create files in the
// origin private file system (OPFS) and replace showOpenFilePicker /
// showSaveFilePicker with functions that return those handles. OPFS handles
// are real FileSystemFileHandle objects, so reading, writing, isSameEntry and
// storing them in IndexedDB all go through the same code paths as user files.

import fs from 'node:fs';
import {test as base, expect} from '@playwright/test';

/** Fails any test whose page logs an error or throws. */
const test = base.extend({
  page: async ({page}, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await use(page);
    expect(errors, 'errors logged by the page').toEqual([]);
  },
});

const title = (page) => page.locator('#title-filename');
const tabNames = (page) => page.locator('#tabs-list .filename');
const editor = (page) => page.locator('.cm-content');

async function openApp(page, url = './') {
  await page.goto(url);
  await expect(tabNames(page)).not.toHaveCount(0);
}

/** Creates a file in OPFS and keeps its handle in window.__files[name]. */
async function createFile(page, name, content) {
  await page.evaluate(async ([name, content]) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, {create: true});
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    window.__files = window.__files || {};
    window.__files[name] = handle;
  }, [name, content]);
}

async function readFile(page, name) {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(name)).getFile()).text();
  }, name);
}

async function mockOpenPicker(page, names) {
  await page.evaluate((names) => {
    window.showOpenFilePicker = async () => names.map((n) => window.__files[n]);
  }, names);
}

async function mockSavePicker(page, name) {
  await page.evaluate((name) => {
    window.__saveCalls = [];
    window.showSaveFilePicker = async (options) => {
      window.__saveCalls.push(options);
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(name, {create: true});
    };
  }, name);
}

async function openFileViaPicker(page, name, content) {
  await createFile(page, name, content);
  await mockOpenPicker(page, [name]);
  await page.keyboard.press('Control+o');
  await expect(title(page)).toHaveText(name);
}

async function retainedNames(page) {
  return page.evaluate(async () =>
    (await retainedFiles.load()).map((handle) => handle.name));
}

test('loads with the UI translated and an Untitled tab', async ({page}) => {
  await openApp(page);
  await expect(title(page)).toHaveText('Untitled 1');
  await expect(page.locator('#file-menu-new')).toContainText('New');
  await expect(page.locator('#search-input'))
      .toHaveAttribute('placeholder', /\S/);
  await expect(page).toHaveTitle('Untitled 1 - Text');
});

test('opens, edits and saves a file', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'hello.txt', 'hello world');

  // The empty Untitled tab is replaced by the opened file.
  await expect(tabNames(page)).toHaveText(['hello.txt']);
  await expect(editor(page)).toHaveText('hello world');

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(', again');
  await expect(title(page)).toHaveClass(/unsaved/);

  await page.keyboard.press('Control+s');
  await expect(title(page)).not.toHaveClass(/unsaved/);
  expect(await readFile(page, 'hello.txt')).toBe('hello world, again');
});

test('keeps CRLF line endings when saving', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'dos.txt', 'one\r\ntwo\r\n');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('three');
  await page.keyboard.press('Control+s');
  await expect(title(page)).not.toHaveClass(/unsaved/);
  expect(await readFile(page, 'dos.txt')).toBe('one\r\ntwo\r\nthree');
});

test('switches to the existing tab when a file is opened twice', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'a.txt', 'a');
  await openFileViaPicker(page, 'b.txt', 'b');
  await mockOpenPicker(page, ['a.txt']);
  await page.keyboard.press('Control+o');
  await expect(title(page)).toHaveText('a.txt');
  await expect(tabNames(page)).toHaveText(['a.txt', 'b.txt']);
});

test('Save As writes a new file named after the first line', async ({page}) => {
  await openApp(page);
  await mockSavePicker(page, 'shopping list.txt');
  await editor(page).click();
  await page.keyboard.type('shopping list\neggs');
  await page.keyboard.press('Control+Shift+s');

  await expect(title(page)).toHaveText('shopping list.txt');
  await expect(title(page)).not.toHaveClass(/unsaved/);
  expect(await page.evaluate(() => window.__saveCalls[0].suggestedName))
      .toBe('shopping list.txt');
  expect(await readFile(page, 'shopping list.txt')).toBe('shopping list\neggs');
});

test('closing a modified Untitled tab offers to save, then closes it once', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'keep.txt', 'keep');
  // Tab ids are reused, and the startup Untitled 1 was replaced by keep.txt.
  await page.keyboard.press('Control+n');
  await expect(title(page)).toHaveText('Untitled 1');
  await mockSavePicker(page, 'draft.txt');
  await editor(page).click();
  await page.keyboard.type('draft');

  await page.keyboard.press('Control+w');
  await expect(page.locator('#dialog-container')).toHaveClass(/open/);
  await expect(page.locator('.dialog-text'))
      .toContainText('Untitled 1 has been modified.');
  await page.locator('#yes').click();

  await expect(tabNames(page)).toHaveText(['keep.txt']);
  await expect(title(page)).toHaveText('keep.txt');
  expect(await readFile(page, 'draft.txt')).toBe('draft');
  expect(await page.evaluate(() => window.__saveCalls.length)).toBe(1);
});

test('shows an error when a file can no longer be read', async ({page}) => {
  await openApp(page);
  await createFile(page, 'gone.txt', 'soon deleted');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('gone.txt');
  });
  await mockOpenPicker(page, ['gone.txt']);
  await page.keyboard.press('Control+o');

  await expect(page.locator('.dialog-text'))
      .toHaveText('Error opening file: File not found');
  await page.locator('#ok').click();
  await expect(page.locator('#dialog-container')).not.toHaveClass(/open/);
  await expect(tabNames(page)).toHaveText(['Untitled 1']);
});

test('reopens the files from the last session', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'one.txt', '1');
  await openFileViaPicker(page, 'two.txt', '2');
  await expect.poll(() => retainedNames(page)).toEqual(['one.txt', 'two.txt']);

  await page.reload();
  await expect(tabNames(page)).toHaveText(['one.txt', 'two.txt']);
  await expect(editor(page)).toHaveText('2');
});

test('asks before reopening files that need permission again', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'secret.txt', 'shh');
  await expect.poll(() => retainedNames(page)).toEqual(['secret.txt']);

  // Simulate a browser restart, where saved handles need permission again.
  await page.addInitScript(() => {
    let granted = false;
    FileSystemHandle.prototype.queryPermission =
        async () => (granted ? 'granted' : 'prompt');
    FileSystemHandle.prototype.requestPermission = async () => {
      granted = true;
      return 'granted';
    };
  });
  await page.reload();

  await expect(page.locator('.dialog-text'))
      .toContainText('Reopen the files from your last session?');
  await expect(page.locator('.dialog-text')).toContainText('secret.txt');
  await expect(tabNames(page)).toHaveText(['Untitled 1']);
  await page.locator('#yes').click();
  await expect(tabNames(page)).toHaveText(['secret.txt']);
  await expect(editor(page)).toHaveText('shh');
});

test('opens files the OS launches the app with', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {setConsumer: (consumer) => { window.__launchConsumer = consumer; }},
    });
  });
  await openApp(page);
  await createFile(page, 'launched.md', '# Launched');
  await page.evaluate(() =>
    window.__launchConsumer({files: [window.__files['launched.md']]}));

  await expect(title(page)).toHaveText('launched.md');
  await expect(tabNames(page)).toHaveText(['launched.md']);
});

test('Ctrl+Shift+N opens an empty window', async ({page, context}) => {
  await openApp(page);
  await openFileViaPicker(page, 'busy.txt', 'busy');
  await expect.poll(() => retainedNames(page)).toEqual(['busy.txt']);

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.keyboard.press('Control+Shift+N'),
  ]);
  await expect(tabNames(popup)).toHaveText(['Untitled 1']);
  expect(new URL(popup.url()).searchParams.get('new-window')).toBe('1');
});

test('closing the last tab in a browser tab starts a new document', async ({page}) => {
  await openApp(page);
  await openFileViaPicker(page, 'last.txt', 'last');
  await page.keyboard.press('Control+w');
  await expect(tabNames(page)).toHaveText(['Untitled 1']);
  await expect(title(page)).toHaveText('Untitled 1');
  await expect.poll(() => retainedNames(page)).toEqual([]);
});

test('settings persist and sync to other windows', async ({page, context}) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+=');
  const size = await page.evaluate(() => textApp.settings_.get('fontsize'));
  expect(size).toBeGreaterThan(14);
  await expect.poll(() => other.evaluate(() => textApp.settings_.get('fontsize')))
      .toBe(size);

  await page.reload();
  await expect(tabNames(page)).not.toHaveCount(0);
  expect(await page.evaluate(() => textApp.settings_.get('fontsize'))).toBe(size);
});

test('warns before closing with unsaved changes', async ({page}) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.type('unsaved');

  const dialog = page.waitForEvent('dialog');
  await page.close({runBeforeUnload: true});
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).dismiss();
});

test('works offline once loaded', async ({page, context}) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(title(page)).toHaveText('Untitled 1');
  await expect(page.locator('#file-menu-new')).toContainText('New');
});

test('manifest parses without errors and the app is installable', async ({page, context}) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);

  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const {installabilityErrors} = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('i18n matches chrome.i18n locale fallback and placeholders', async ({page}) => {
  await openApp(page);
  const result = await page.evaluate(() => ({
    enGB: i18n.pickLocale(['en-GB']),
    esMX: i18n.pickLocale(['es-MX']),
    es419: i18n.pickLocale(['es-419']),
    zhHant: i18n.pickLocale(['zh-Hant-TW']),
    zhCN: i18n.pickLocale(['zh-CN']),
    nb: i18n.pickLocale(['nb-NO']),
    firstSupported: i18n.pickLocale(['xx', 'fr-CA']),
    unknown: i18n.pickLocale(['xx']),
    count: i18n.getMessage('searchCounting', [2, 5]),
    prompt: i18n.getMessage('saveFilePromptLine1', 'a.txt'),
    missing: i18n.getMessage('noSuchMessage'),
  }));
  expect(result).toEqual({
    enGB: 'en_GB',
    esMX: 'es',
    es419: 'es_419',
    zhHant: 'zh_TW',
    zhCN: 'zh_CN',
    nb: 'no',
    firstSupported: 'fr_CA',
    unknown: 'en',
    count: '2 of 5',
    prompt: 'a.txt has been modified.',
    missing: '',
  });
});

test.describe('in German', () => {
  test.use({locale: 'de-DE'});

  test('the UI uses the browser language', async ({page}) => {
    const messages = JSON.parse(
        fs.readFileSync('_locales/de/messages.json', 'utf8'));
    await openApp(page);
    await expect(page.locator('#file-menu-new'))
        .toContainText(messages.fileMenuNew.message);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
  });
});
