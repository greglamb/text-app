/**
 * @constructor
 * @param {number} id
 * @param {window.CodeMirror.state.EditorState} session Edit session.
 * @param {string} lineEndings What character(s) to use as the line ending.
 * @param {?FileSystemFileHandle} entry The file shown in the tab, if any.
 * @param {DialogController} dialogController
 */
function Tab(id, session, lineEndings, entry, dialogController) {
  this.id_ = id;
  /** @type {window.CodeMirror.state.EditorState} */
  this.session_ = session;
  /** @type {string} Separator between lines. */
  this.lineEndings_ = lineEndings;
  /** @type {?FileSystemFileHandle} */
  this.entry_ = entry;
  this.saved_ = true;
  /** @type {number} Incremented on every edit; used to detect edits made
   *  while a save is in flight. */
  this.version_ = 0;
  /** @type {!Promise} Serializes saves so an older write can't land last. */
  this.saveQueue_ = Promise.resolve();
  this.path_ = null;
  this.dialogController_ = dialogController;
  if (this.entry_)
    this.updatePath_();
};

Tab.prototype.getId = function() {
  return this.id_;
};

Tab.prototype.getName = function() {
  if (this.entry_) {
    return this.entry_.name;
  } else {
    // TODO: i18n 'Untitled' text
    return 'Untitled ' + this.id_;
  }
};

/**
 * @return {string?} Filename extension or null.
 */
Tab.prototype.getExtension = function() {
  if (!this.entry_)
    return null;

  return util.getExtension(this.getName());
};

Tab.prototype.getSession = function() {
  return this.session_;
};

Tab.prototype.setSession = function(session) {
  return this.session_ = session;
};

/**
 * @param {!FileSystemFileHandle} entry
 */
Tab.prototype.setEntry = function(entry) {
  var nameChanged = this.getName() != entry.name;
  this.entry_ = entry;
  if (nameChanged)
    $.event.trigger('tabrenamed', this);
  this.updatePath_();
  $.event.trigger('tabentrychange', this);
};

Tab.prototype.getEntry = function() {
  return this.entry_;
};

Tab.prototype.getPath = function() {
  return this.path_;
};

Tab.prototype.updatePath_ = function() {
  // The File System Access API doesn't expose full paths, so the file name is
  // the most specific location available.
  this.path_ = this.entry_ ? this.entry_.name : null;
  $.event.trigger('tabpathchange', this);
};

/** Get the contents of the file in the tab. */
Tab.prototype.getContent_ = function() {
  // Files with mixed line endings will get normalized to whatever we guessed.
  // We could set the EditorState.lineSeparator facet to make round-trips work,
  // but other GUI Linux text editors also seem to normalize.
  return this.session_.doc.toString().split('\n').join(this.lineEndings_);
};

Tab.prototype.save = function(opt_callbackDone) {
  // Capture what to write now; the write itself waits for earlier saves.
  var entry = this.entry_;
  var content = this.getContent_();
  var version = this.version_;
  this.saveQueue_ = this.saveQueue_.then(function() {
    return fileSystem.writeText(entry, content);
  }).then(
      function() {
        // Only mark the tab saved if nothing was typed while writing.
        if (this.version_ === version) {
          this.saved_ = true;
          $.event.trigger('tabsave', this);
        }
        if (opt_callbackDone)
          opt_callbackDone();
      }.bind(this),
      this.reportWriteError_.bind(this));
};

Tab.prototype.reportWriteError_ = function(e) {
  util.handleFSError(e);
  // TODO: Replace this with i18n message
  this.dialogController_.showError(
      'Error saving file: ' + fileSystem.errorToString(e));
};

Tab.prototype.isSaved = function() {
  return this.saved_;
};

Tab.prototype.changed = function() {
  this.version_++;
  if (this.saved_) {
    this.saved_ = false;
    $.event.trigger('tabchange', this);
  }
};


/**
 * @constructor
 * @param {EditorCodeMirror} editor
 */
function Tabs(editor, dialogController, settings) {
  /** @type {EditorCodeMirror} */
  this.editor_ = editor;
  this.dialogController_ = dialogController;
  this.settings_ = settings;
  /** @type {Tab[]} */
  this.tabs_ = [];
  /** @type {Tab|null} Current selected tab, or initially null. */
  this.currentTab_ = null;
  /** @type {!Promise} Serializes file opens so duplicates are detected. */
  this.openQueue_ = Promise.resolve();

  $(document).bind('docchange', this.onDocChanged_.bind(this));
}

Tabs.prototype.getTabById = function(id) {
  for (var i = 0; i < this.tabs_.length; i++) {
    if (this.tabs_[i].getId() === id)
      return this.tabs_[i];
  }
  return null;
};

Tabs.prototype.getCurrentTab = function() {
  return this.currentTab_;
};

/**
 * Opens a new, empty app window. The query parameter tells the new window not
 * to reopen the files from the last session.
 */
Tabs.prototype.newWindow = function() {
  var url = new URL('./', window.location.href);
  url.searchParams.set(Tabs.NEW_WINDOW_PARAM, '1');
  window.open(url.href, '_blank');
};

/** @const {string} */
Tabs.NEW_WINDOW_PARAM = 'new-window';

/**
 * Add a new tab.
 *
 * @param {?string} opt_content What text content the tab should contain. Otherwise it starts empty.
 */
Tabs.prototype.newTab = function(opt_content, opt_entry) {
  var id = 1;
  while (this.getTabById(id)) {
    id++;
  }

  var session = this.editor_.newState(opt_content);
  var lineEndings = util.guessLineEndings(opt_content);

  var tab = new Tab(id, session, lineEndings, opt_entry || null,
                    this.dialogController_);
  this.tabs_.push(tab);
  $.event.trigger('newtab', tab);
  this.showTab(tab.getId());
};

/**
 * @param {number} oldIndex
 * @param {number} newIndex
 * Move a {Tab} from oldIndex to newIndex
 */
Tabs.prototype.reorder = function (oldIndex, newIndex) {
  this.tabs_.splice(
      newIndex, // specifies at what position to add items
      0, // no items will be removed
      this.tabs_.splice(oldIndex, 1)[0]); // item to be added
  $.event.trigger('tabsreordered');
};

Tabs.prototype.getTabIndex = function(tab) {
  for (var i = 0; i < this.tabs_.length; i++) {
    if (this.tabs_[i] === tab)
      return i;
  }
  return -1;
}

Tabs.prototype.previousTab = function() {
  var currentTabIndex = this.getTabIndex(this.currentTab_);
  var previousTabIndex = currentTabIndex - 1;
  if (previousTabIndex < 0)
    previousTabIndex = this.tabs_.length - 1;
  this.showTab(this.tabs_[previousTabIndex].getId());
};

Tabs.prototype.nextTab = function() {
  var currentTabIndex = this.getTabIndex(this.currentTab_);
  var nextTabIndex = currentTabIndex + 1;
  if (nextTabIndex >= this.tabs_.length)
    nextTabIndex = 0;
  this.showTab(this.tabs_[nextTabIndex].getId());
};

Tabs.prototype.showTab = function(tabId) {
  if (this.currentTab_) {
    // Before switching tabs, write the editorView's state to the tab.
    this.updateCurrentTabState_();
  }

  var tab = this.getTabById(tabId)
  if (!tab) {
    console.error('Can\'t find tab', tabId);
    return;
  }
  this.editor_.setSession(tab.getSession(), tab.getExtension());
  this.currentTab_ = tab;
  $.event.trigger('switchtab', tab);
  if (this.dialogController_.isOpen()) {
    // A new session is editable; keep the editor locked behind the dialog.
    this.editor_.disable();
  } else {
    this.editor_.focus();
  }
};

Tabs.prototype.close = function(tabId) {
  for (var i = 0; i < this.tabs_.length; i++) {
    if (this.tabs_[i].getId() == tabId)
      break;
  }

  if (i >= this.tabs_.length) {
    console.error('Can\'t find tab', tabId);
    return;
  }

  var tab = this.tabs_[i];

  if (!tab.isSaved()) {
    this.promptSave_(tab, function(answer) {
      if (answer === 'yes') {
        this.save(tab, this.closeTab_.bind(this, tab));
      } else if (answer === 'no') {
        this.closeTab_(tab);
      }
    }.bind(this));
  } else {
    this.closeTab_(tab);
  }
};

/**
 * @param {Tab} tab
 * Close tab without checking whether it needs to be saved. The safe version
 * (invoking auto-save and, if needed, SaveAs dialog) is Tabs.close().
 */
Tabs.prototype.closeTab_ = function(tab) {
  var closingLastTab = false;
  if (tab === this.currentTab_) {
    if (this.tabs_.length > 1) {
      this.nextTab();
    } else {
      closingLastTab = true;
    }
  }

  var i = this.getTabIndex(tab);
  if (i < 0) return;

  this.tabs_.splice(i, 1);
  $.event.trigger('tabclosed', tab);

  if (closingLastTab) {
    this.currentTab_ = null;
    // The app closes the window (or starts a new document in a browser tab).
    $.event.trigger('lasttabclosed');
  }
};

/**
 * This is needed because EditorState is immutable. So if you open a tab and
 * edit the contents, the EditorView's state won't match the tab's session state.
 */
Tabs.prototype.updateCurrentTabState_ = function() {
  if (!this.currentTab_) return;
  this.currentTab_.setSession(this.editor_.editorView_.state);
}

Tabs.prototype.closeCurrent = function() {
  this.close(this.currentTab_.getId());
};

Tabs.prototype.openFiles = function() {
  fileSystem.pickFilesToOpen().then(
      function(entries) {
        for (var i = 0; i < entries.length; i++)
          this.openFileEntry(entries[i]);
      }.bind(this),
      this.reportOpenError_.bind(this));
};

/**
 * @param {function()} callback
 * Invoke the save dialog for all tabs with unsaved progress. Does not close any tabs.
 */
Tabs.prototype.promptAllUnsaved = function(callback) {
  this.promptAllUnsavedFromIndex_(0, callback);
};

Tabs.prototype.promptAllUnsavedFromIndex_ = function(i, callback) {
  if (i >= this.tabs_.length) {
    callback();
    return;
  }

  var tab = this.tabs_[i];
  if (tab.isSaved()) {
    this.promptAllUnsavedFromIndex_(i + 1, callback);
  } else {
    this.showTab(this.tabs_[i].getId());
    this.promptSave_(tab, function(answer) {
      if (answer === 'yes') {
        this.save(
          tab, this.promptAllUnsavedFromIndex_.bind(this, i + 1, callback));
      } else if (answer === 'no') {
        this.promptAllUnsavedFromIndex_(i + 1, callback);
      }
    }.bind(this));
  }
};

/**
 * Prompts the user if they want to save a file.
 * @param {!Tab} tab The tab corresponding to the file to be saved.
 * @param {function(string)} callbackShowDialog Called when the save dialog box
 *     is resolved. Takes as an argument string corresponding to the dialog
 *     button selected by the user.
 */
Tabs.prototype.promptSave_ = function(tab, callbackShowDialog) {
  this.dialogController_.setText(
      i18n.getMessage('saveFilePromptLine1', tab.getName()),
      i18n.getMessage('saveFilePromptLine2')
  );
  this.dialogController_.resetButtons();
  this.dialogController_.addButton('yes',
      i18n.getMessage('yesDialogButton'));
  this.dialogController_.addButton('no',
      i18n.getMessage('noDialogButton'));
  this.dialogController_.addButton('cancel',
      i18n.getMessage('cancelDialogButton'));
  this.dialogController_.show(callbackShowDialog);
};

/**
 * Save opt_tab, or the current tab if no opt_tab is passed.
 * @param {?Tab=} opt_tab Optional tab to save.
 * @param {function()=} opt_callback
 */
Tabs.prototype.save = function(opt_tab, opt_callback) {
  var tab = opt_tab || this.currentTab_;

  // Update the tab's editorState if it's the current tab.
  if (tab && tab === this.currentTab_) {
    this.updateCurrentTabState_();
  }

  if (tab.getEntry()) {
    tab.save(opt_callback);
  } else {
    this.saveAs(tab, opt_callback);
  }
};

/**
 * Save opt_tab as a new file, or the current tab if no opt_tab is passed.
 * @param {?Tab=} opt_tab
 * @param {function()=} opt_callback
 */
Tabs.prototype.saveAs = function(opt_tab, opt_callback) {
  var tab = opt_tab || this.currentTab_;
  if (tab && tab === this.currentTab_) {
    this.updateCurrentTabState_();
  }

  var suggestedName = tab.getEntry() && tab.getEntry().name ||
                      util.sanitizeFileName(tab.session_.doc.line(1).text) ||
                      tab.getName();

  if (!util.getExtension(suggestedName)) {
      suggestedName += '.txt';
  }
  fileSystem.pickFileToSave(suggestedName).then(
      function(entry) {
        // saveEntry_ calls opt_callback once the write has finished.
        this.saveEntry_(tab, entry, opt_callback);
      }.bind(this),
      function(e) {
        // TODO: Replace this with i18n message
        this.dialogController_.showError(
            'Error saving file: ' + fileSystem.errorToString(e));
      }.bind(this));
};

/**
 * @return {!Array<!FileSystemFileHandle>} The files open in tabs, in order.
 */
Tabs.prototype.getFilesToRetain = function() {
  var toRetain = [];

  for (var i = 0; i < this.tabs_.length; i++) {
    if (this.tabs_[i].getEntry()) {
      toRetain.push(this.tabs_[i].getEntry());
    }
  }

  return toRetain;
};

/**
 * Opens the file in a new tab, or switches to its tab if it's already open.
 * Opens are queued so that opening the same file twice at once can't create
 * two tabs for it.
 * @param {!FileSystemFileHandle} entry
 * @param {boolean=} opt_quiet Skip files that can't be read without showing
 *     an error, as the Chrome App did when restoring files on launch.
 * @return {!Promise}
 */
Tabs.prototype.openFileEntry = function(entry, opt_quiet) {
  var opened = this.openQueue_.then(
      this.openFileEntryNow_.bind(this, entry, !!opt_quiet));
  this.openQueue_ = opened.catch(function(e) {
    console.error('Failed to open file:', e);
  });
  return opened;
};

/**
 * @param {!FileSystemFileHandle} entry
 * @param {boolean} quiet
 * @return {!Promise}
 * @private
 */
Tabs.prototype.openFileEntryNow_ = async function(entry, quiet) {
  for (var i = 0; i < this.tabs_.length; i++) {
    var tabEntry = this.tabs_[i].getEntry();
    if (tabEntry && await fileSystem.isSameFile(tabEntry, entry)) {
      this.showTab(this.tabs_[i].getId());
      return;
    }
  }

  var content;
  try {
    if (!quiet) $.event.trigger('loadingfile');
    content = await fileSystem.readText(entry);
  } catch (e) {
    if (quiet) {
      console.warn('Skipping file that could not be reopened:', entry.name, e);
      return;
    }
    util.handleFSError(e);
    this.reportOpenError_(e);
    return;
  }
  this.addFileTab_(entry, content);
};

/**
 * @param {*} e
 * @private
 */
Tabs.prototype.reportOpenError_ = function(e) {
  // TODO: Replace this with i18n message
  this.dialogController_.showError(
      'Error opening file: ' + fileSystem.errorToString(e));
};

/**
 * Sets the mode for a tab depending on its extension.
 *
 * @param {Tab} tab The tab corresponding to the file to be saved.
 */
Tabs.prototype.modeAutoSet = function(tab) {
  // Only set the mode if it's the current tab. The mode for non-current tabs
  // will update when they become the current tab.
  if (tab !== this.currentTab_) return;
  var extension = tab.getExtension();
  if (extension) {
    this.editor_.updateMode(extension);
  }
};

/**
 * Adds a tab for a file that has been read, replacing the initial empty
 * Untitled tab if it's the only other one.
 * @param {!FileSystemFileHandle} entry
 * @param {string} content
 * @private
 */
Tabs.prototype.addFileTab_ = function(entry, content) {
  this.newTab(content, entry);
  if (this.tabs_.length === 2 &&
      !this.tabs_[0].getEntry() &&
      this.tabs_[0].isSaved()) {
    this.close(this.tabs_[0].getId());
  }
};

/**
 * @param {!Tab} tab
 * @param {?FileSystemFileHandle} entry
 * @param {function()=} opt_callback
 */
Tabs.prototype.saveEntry_ = function(tab, entry, opt_callback) {
  if (!entry) {
    return;
  }

  tab.setEntry(entry);
  this.save(tab, opt_callback);
};

/**
 * The event handler for the docchange event.
 */
Tabs.prototype.onDocChanged_ = function() {
  if (this.currentTab_)
    this.currentTab_.changed();
}

/**
 * Determines whether any tabs are open.
 * @return {boolean} True if at least one tab is open.
 */
Tabs.prototype.hasOpenTab = function() {
  return !!this.tabs_.length;
};

/**
 * @return {boolean} True if any tab has changes that haven't been saved.
 */
Tabs.prototype.hasUnsavedTabs = function() {
  for (var i = 0; i < this.tabs_.length; i++) {
    if (!this.tabs_[i].isSaved())
      return true;
  }
  return false;
};
