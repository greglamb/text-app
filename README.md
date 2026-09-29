# Text

A simple text editor for ChromeOS and Chrome, packaged as an installable web app (PWA).

This is a fork of Google's [Text Chrome App](https://github.com/GoogleChromeLabs/text-app), which was archived in January 2025. Chrome Apps are being removed from ChromeOS, so this fork replaces the Chrome App APIs with standard web platform APIs. The editor itself (CodeMirror 6, syntax highlighting, tabs, search, themes, 20 languages) is unchanged.

## Using it

Open the deployed site in Chrome or Edge and install it from the install icon in the address bar or the browser menu. Once installed it:

- runs in its own window and works offline
- appears in **Open with** for text files in the ChromeOS Files app (and in the OS open-with menu on other desktop platforms where Chrome supports file handling)
- reopens the files you had open last time

Opening and saving files uses the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API), so it needs a Chromium-based browser.

## Differences from the Chrome App

| Chrome App | Web app |
| --- | --- |
| `chrome.fileSystem` file entries | File System Access API handles |
| Full file path shown on hover | File name only (web apps can't see paths) |
| Files reopened silently on launch | Reopened silently if Chrome kept permission (installed apps can choose "Allow on every visit"); otherwise the app asks first |
| Settings synced with `chrome.storage.sync` | Settings stored per device in `localStorage`, synced live between open windows |
| Custom title bar with minimize/maximize/close | Standard browser window frame |
| "Always on top" setting | Removed; the web has no equivalent |
| Launch files via `chrome.app.runtime` | [File Handling](https://developer.chrome.com/docs/capabilities/web-apis/file-handling) manifest entry + `launchQueue` |
| Warns about unsaved tabs on close | Same in-app dialog for Ctrl+Shift+W; the browser's "Leave site?" prompt when the window is closed another way |

## Development

Requires Node.js 20 or later.

```sh
npm install
npm run build:codemirror   # once, and after changing third_party/codemirror.next
npm start                  # builds dist/ and serves it at http://localhost:8080/
```

`npm run build` copies the files the app needs into `dist/` and generates `dist/sw.js` with [Workbox](https://developer.chrome.com/docs/workbox), which precaches everything for offline use. Rebuild after each change; the dev server doesn't watch.

The service worker serves the cached copy first, so after rebuilding, reload twice or use DevTools → Application → Service workers → **Update on reload**.

### Tests

```sh
npm test
```

Runs end-to-end tests in Chromium with [Playwright](https://playwright.dev/) against `dist/`, so build first. File pickers can't be automated, so the tests stand in files from the origin private file system, which exercise the same read, write and reopen code paths.

## Deployment

Pushes to `master` build, test and deploy `dist/` to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

All paths are relative, so `dist/` can be hosted from any HTTPS origin or subpath.

## License

BSD-style; see [LICENSE.md](LICENSE.md). Third-party code under `third_party/` keeps its own licenses.
