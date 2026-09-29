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

  /** @type {boolean} False until the files from the last session are
   *  reopened, so the startup tab doesn't overwrite the list. */
  this.retainingFiles_ = false;
  /** @type {?number} */
  this.retainTimer_ = null;
}

/** @const {number} Delay before writing the list of open files. */
TextApp.RETAIN_DELAY_MS = 250;

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
 * @return {!Promise}
 */
TextApp.prototype.openTabs = async function(entries) {
  for (var i = 0; i < entries.length; i++) {
    await this.tabs_.openFileEntry(entries[i]).catch(function() {});
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
  if (!this.retainingFiles_) return;
  clearTimeout(this.retainTimer_);
  this.retainTimer_ = setTimeout(function() {
    retainedFiles.save(this.getFilesToRetain()).catch(function(e) {
      console.warn('Could not remember the open files:', e);
    });
  }.bind(this), TextApp.RETAIN_DELAY_MS);
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
    var state = await fileSystem.queryPermission(handles[i], 'readwrite')
        .catch(function() { return 'denied'; });
    if (state === 'granted') {
      granted.push(handles[i]);
    } else if (state === 'prompt') {
      needPermission.push(handles[i]);
    }
  }

  await this.openTabs(granted);
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
      // Another dialog (e.g. an error) is showing; don't stack a second one.
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
    this.dialogController_.show(async function(answer) {
      if (answer === 'yes') {
        var allowed = [];
        // Runs inside the click handler, so the permission prompt may show.
        for (var i = 0; i < handles.length; i++) {
          if (await fileSystem.ensurePermission(handles[i], 'readwrite')
                  .catch(function() { return false; })) {
            allowed.push(handles[i]);
          }
        }
        await this.openTabs(allowed);
      }
      resolve();
    }.bind(this));
  }.bind(this));
};

/**
 * Opens files the operating system launched the app with, e.g. from "Open
 * with" in the Files app. Replaces chrome.app.runtime.onLaunched.
 * @private
 */
TextApp.prototype.listenForLaunchedFiles_ = function() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(function(launchParams) {
    if (launchParams.files && launchParams.files.length) {
      this.openTabs(launchParams.files);
    }
  }.bind(this));
};

/**
 * Warns before the window is closed or reloaded with unsaved changes. The
 * browser shows its own dialog; custom text isn't allowed.
 * @param {!Event} e
 * @private
 */
TextApp.prototype.onBeforeUnload_ = function(e) {
  if (this.tabs_ && this.tabs_.hasUnsavedTabs()) {
    e.preventDefault();
    e.returnValue = '';
  }
};

/**
 * Sets up the window once the editor exists. Replaces the background page's
 * onWindowReady from the Chrome App.
 * @private
 */
TextApp.prototype.onWindowReady_ = async function() {
  $(document).bind('newtab tabclosed tabentrychange tabsreordered',
                   this.scheduleRetainFiles_.bind(this));
  window.addEventListener('beforeunload', this.onBeforeUnload_.bind(this));
  this.listenForLaunchedFiles_();

  var params = new URLSearchParams(window.location.search);
  if (params.has(Tabs.NEW_WINDOW_PARAM)) {
    // Windows opened with Ctrl+Shift+N start empty, as in the Chrome App.
    await this.openTabs([]);
  } else {
    await this.restoreFiles_();
    if (!this.tabs_.hasOpenTab()) this.tabs_.newTab();
  }
  this.retainingFiles_ = true;
  this.scheduleRetainFiles_();
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
