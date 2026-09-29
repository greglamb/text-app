/**
 * @constructor
 */
function TextApp() {
  /** @type {EditorCodeMirror} */
  this.editor_ = null;
  this.settings_ = null;
  this.tabs_ = null;

  this.dialogController_ = null;
  this.hotkeysController_ = null;
  this.menuController_ = null;
  this.searchController_ = null;
  this.settingsController_ = null;
  this.windowController_ = null;

  /** @type {boolean} False until startup has reopened the last session's
   *  files, so the startup tab doesn't overwrite the saved list. */
  this.retainingFiles_ = false;
  /** @type {boolean} Only the primary window saves the list of open files,
   *  so extra windows don't overwrite the main window's session. */
  this.isPrimaryWindow_ = false;
  /** @type {?number} */
  this.retainTimer_ = null;
  /** @type {!Promise} Resolves once startup has finished opening files. */
  this.startupDone_ = Promise.resolve();
  /** @type {boolean} True while the app itself is closing the window. */
  this.closing_ = false;
}

/** @const {number} Delay before writing the list of open files. */
TextApp.RETAIN_DELAY_MS = 250;

/** @const {string} Web Lock held by the window that saves the session. */
TextApp.PRIMARY_WINDOW_LOCK = 'text-app-primary-window';

/**
 * Called when all the resources have loaded. All initializations should be done
 * here.
 */
TextApp.prototype.init = function() {
  this.settings_ = new Settings();
  // Editor is initalised after settings are ready.
  this.editor_ = null;

  if (this.settings_.isReady()) {
    this.onSettingsReady_();
  } else {
    $(document).bind('settingsready', this.onSettingsReady_.bind(this));
  }
  $(document).bind('settingschange', this.onSettingsChanged_.bind(this));
};

/**
 * Open one tab per file passed, then a new Untitled tab if no tabs are open.
 * @param {!Array<!FileSystemFileHandle>} entries The files to be opened.
 * @param {boolean=} opt_quiet Skip unreadable files without an error dialog.
 * @return {!Promise}
 */
TextApp.prototype.openTabs = async function(entries, opt_quiet) {
  for (var i = 0; i < entries.length; i++) {
    await this.tabs_.openFileEntry(entries[i], opt_quiet)
        .catch(function() {});
  }
  this.windowController_.focus_();
  if (!this.tabs_.hasOpenTab()) {
    this.tabs_.newTab();
  }
};

/**
 * @return {!Array<!FileSystemFileHandle>}
 */
TextApp.prototype.getFilesToRetain = function() {
  return this.tabs_.getFilesToRetain();
};

/**
 * Remembers the open files so the next launch can reopen them. Writes are
 * debounced because dragging a tab reorders the list many times.
 * @private
 */
TextApp.prototype.scheduleRetainFiles_ = function() {
  if (!this.retainingFiles_ || !this.isPrimaryWindow_) return;
  clearTimeout(this.retainTimer_);
  this.retainTimer_ = setTimeout(
      this.flushRetainedFiles_.bind(this), TextApp.RETAIN_DELAY_MS);
};

/**
 * Writes the list of open files now, cancelling any pending write.
 * @return {!Promise}
 * @private
 */
TextApp.prototype.flushRetainedFiles_ = function() {
  clearTimeout(this.retainTimer_);
  this.retainTimer_ = null;
  if (!this.retainingFiles_ || !this.isPrimaryWindow_) {
    return Promise.resolve();
  }
  return retainedFiles.save(this.getFilesToRetain()).catch(function(e) {
    console.warn('Could not remember the open files:', e);
  });
};

/**
 * Makes this window the one that saves the session if no other window is.
 * Other windows wait in line and take over when the primary window closes,
 * so the last window left open decides what reopens, as in the Chrome App.
 * @return {!Promise<boolean>} True if this window became primary right away.
 * @private
 */
TextApp.prototype.claimPrimaryWindow_ = function() {
  var becomePrimary = function() {
    this.isPrimaryWindow_ = true;
    this.scheduleRetainFiles_();
    // Hold the lock until the window closes.
    return new Promise(function() {});
  }.bind(this);

  if (!navigator.locks) {
    becomePrimary();
    return Promise.resolve(true);
  }
  return new Promise(function(resolve) {
    navigator.locks.request(
        TextApp.PRIMARY_WINDOW_LOCK, {ifAvailable: true}, function(lock) {
          if (lock) {
            resolve(true);
            return becomePrimary();
          }
          resolve(false);
          navigator.locks.request(TextApp.PRIMARY_WINDOW_LOCK, becomePrimary);
        });
  });
};

/**
 * Reopens the files that were open when the app was last used. Files the
 * browser still has permission for open straight away; for the rest the
 * user is asked first, because granting permission needs a click.
 * @return {!Promise}
 * @private
 */
TextApp.prototype.restoreFiles_ = async function() {
  var handles = await retainedFiles.load();
  var granted = [];
  var needPermission = [];
  for (var i = 0; i < handles.length; i++) {
    // Opening a file only grants read access; saving asks for write access
    // when it's needed.
    var state = await fileSystem.queryPermission(handles[i], 'read')
        .catch(function() { return 'denied'; });
    if (state === 'granted') {
      granted.push(handles[i]);
    } else if (state === 'prompt') {
      needPermission.push(handles[i]);
    }
  }

  // Files that were moved or deleted are skipped quietly, as in the Chrome
  // App.
  await this.openTabs(granted, true);
  if (needPermission.length) {
    await this.askToReopen_(needPermission);
  }
};

/**
 * @param {!Array<!FileSystemFileHandle>} handles Files that need permission.
 * @return {!Promise} Resolves once the user has answered.
 * @private
 */
TextApp.prototype.askToReopen_ = function(handles) {
  return new Promise(function(resolve) {
    if (this.dialogController_.isOpen()) {
      // The user is already busy with another dialog; don't stack a second.
      resolve();
      return;
    }
    var names = handles.map(function(h) { return h.name; }).join(', ');
    // TODO: Replace this with i18n message
    this.dialogController_.setText(
        'Reopen the files from your last session?', names);
    this.dialogController_.resetButtons();
    this.dialogController_.addButton(
        'yes', i18n.getMessage('yesDialogButton'));
    this.dialogController_.addButton(
        'no', i18n.getMessage('noDialogButton'));
    this.dialogController_.show(function(answer) {
      if (answer !== 'yes') {
        resolve();
        return;
      }
      // Request every file synchronously inside the click handler, while
      // the click still counts as a user gesture. Chrome can then restore
      // access to all of them from one prompt.
      var requests = handles.map(function(handle) {
        return handle.requestPermission({mode: 'read'}).then(
            function(state) { return state === 'granted'; },
            function() { return false; });
      });
      Promise.all(requests).then(function(results) {
        return this.openTabs(
            handles.filter(function(h, i) { return results[i]; }), true);
      }.bind(this)).then(resolve, resolve);
    }.bind(this));
  }.bind(this));
};

/**
 * Opens files the operating system launched the app with, e.g. from "Open
 * with" in the Files app. Replaces chrome.app.runtime.onLaunched. Launched
 * files wait for startup to finish so they open last and end up in front.
 * @private
 */
TextApp.prototype.listenForLaunchedFiles_ = function() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(function(launchParams) {
    if (!launchParams.files || !launchParams.files.length) return;
    this.startupDone_.then(function() {
      return this.openTabs(launchParams.files);
    }.bind(this));
  }.bind(this));
};

/**
 * Closing the last tab closes an app window, as in the Chrome App. In a
 * browser tab, which a page can't close, it starts a new document instead.
 * @private
 */
TextApp.prototype.onLastTabClosed_ = function() {
  if (util.isInstalledApp()) {
    this.closeWindow_();
  } else {
    this.tabs_.newTab();
  }
};

/**
 * Saves the list of open files, then closes the window. The user has
 * already answered the app's own save prompts, so the browser's "Leave
 * site?" prompt is suppressed.
 * @return {!Promise}
 * @private
 */
TextApp.prototype.closeWindow_ = async function() {
  this.closing_ = true;
  await this.flushRetainedFiles_();
  window.close();
  // window.close() does nothing in a browser tab the page didn't open; turn
  // the unsaved-changes warning back on in that case.
  setTimeout(function() { this.closing_ = false; }.bind(this), 1000);
};

/**
 * Warns before the window is closed or reloaded with unsaved changes. The
 * browser shows its own dialog; custom text isn't allowed.
 * @param {!Event} e
 * @private
 */
TextApp.prototype.onBeforeUnload_ = function(e) {
  if (!this.closing_ && this.tabs_ && this.tabs_.hasUnsavedTabs()) {
    e.preventDefault();
    e.returnValue = '';
  }
};

/**
 * Sets up the window once the editor exists. Replaces the background page's
 * onLaunched and onWindowReady from the Chrome App.
 * @private
 */
TextApp.prototype.onWindowReady_ = async function() {
  $(document).bind('newtab tabclosed tabentrychange tabsreordered',
                   this.scheduleRetainFiles_.bind(this));
  $(document).bind('lasttabclosed', this.onLastTabClosed_.bind(this));
  $(document).bind('windowcloserequested', this.closeWindow_.bind(this));
  window.addEventListener('beforeunload', this.onBeforeUnload_.bind(this));

  var finishStartup;
  this.startupDone_ = new Promise(function(resolve) {
    finishStartup = resolve;
  });
  this.listenForLaunchedFiles_();

  // Only the first window reopens the last session. Windows opened with
  // Ctrl+Shift+N, or while another window is open, start empty, as in the
  // Chrome App.
  var isPrimary = await this.claimPrimaryWindow_();
  var params = new URLSearchParams(window.location.search);
  if (isPrimary && !params.has(Tabs.NEW_WINDOW_PARAM)) {
    await this.restoreFiles_();
  }
  await this.openTabs([]);

  this.retainingFiles_ = true;
  this.scheduleRetainFiles_();
  finishStartup();
};

TextApp.prototype.setTheme = function() {
  var theme = this.settings_.get('theme');

  this.windowController_.setTheme(theme);
  this.editor_.setTheme(theme);
};

/**
 * Called when all the services have started and settings are loaded.
 */
TextApp.prototype.onSettingsReady_ = function() {
  this.settingsController_ = new SettingsController(this.settings_);

  this.initEditor_();
  this.onWindowReady_();
};

/**
 * Create all of the controllers the editor needs.
 */
TextApp.prototype.initControllers_ = function() {
  this.dialogController_ =
      new DialogController($('#dialog-container'), this.editor_);
  this.tabs_ = new Tabs(this.editor_, this.dialogController_, this.settings_);
  this.menuController_ = new MenuController(this.tabs_);
  this.windowController_ =
      new WindowController(this.editor_, this.settings_, this.tabs_);
  this.hotkeysController_ = new HotkeysController(
      this.windowController_, this.tabs_, this.editor_, this.settings_,
      this.settingsController_);
  this.searchController_ = new SearchController(this.editor_.getSearch());
};

/**
 * Loads all settings into the current editor.
 */
TextApp.prototype.loadSettingsIntoEditor = function() {
  this.setTheme();
  this.editor_.applyAllSettings();
};

/**
 * Create a new editor and load all settings.
 */
TextApp.prototype.initEditor_ = function() {
  if (this.editor_) {
    console.error("Trying to re-initialize text app");
    return;
  }

  const editor = document.getElementById('editor');
  this.editor_ = new EditorCodeMirror(editor, this.settings_);
  this.initControllers_();
  this.loadSettingsIntoEditor();
};

/**
 * @param {Event} e
 * @param {string} key
 * @param {*} value
 */
TextApp.prototype.onSettingsChanged_ = function(e, key, value) {
  switch (key) {
    case 'fontsize':
      this.editor_.setFontSize(value);
      break;

    case 'linenumbers':
      this.editor_.showHideLineNumbers(value);
      break;

    case 'spacestab':
      this.editor_.setReplaceTabWithSpaces(this.settings_.get('spacestab'));
      break;

    case 'tabsize':
      this.editor_.setTabSize(value);
      break;

    case 'theme':
      this.setTheme();
      break;

    case 'wraplines':
      this.editor_.setWrapLines(value);
      break;
  }
};

const textApp = new TextApp();

/** Caches the app for offline use and keeps it installable. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(function(e) {
    console.warn('Service worker registration failed:', e);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  i18n.load().then(function() {
    i18nTemplate.process(document);
    textApp.init();
  });
  registerServiceWorker();
});
