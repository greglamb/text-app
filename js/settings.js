/**
 * @constructor
 */
function Settings() {
  this.ready_ = false;
  this.settings_ = {};
  for (var key in Settings.SETTINGS) {
    this.settings_[key] = this.read_(key);
  }
  this.ready_ = true;

  // Keep windows of the app in sync: the storage event fires in every other
  // window of the same origin when one of them writes a setting.
  window.addEventListener('storage', this.onStorage_.bind(this));

  /** The media query list to detect if the preferred color scheme is dark. */
  this.colorSchemeMatcherDark_ =
      window.matchMedia('(prefers-color-scheme: dark)');
  this.colorSchemeMatcherDark_.addEventListener('change', () => {
    if (this.settings_['theme'] === 'default') {
      $.event.trigger('settingschange', ['theme', this.get('theme')]);
    }
  });
}

/**
 * @type {string}
 * Prefix for the localStorage keys that hold settings.
 */
Settings.STORAGE_PREFIX = 'settings-';

/**
 * @type {Object.<string, Object>}
 */
Settings.SETTINGS = {
  'fontsize': {'default': 14, 'type': 'number', 'widget': 'number'},
  'linenumbers': {'default': true, 'type': 'boolean', 'widget': 'checkbox'},
  'sidebaropen': {'default': false, 'type': 'boolean', 'widget': null},
  'sidebarwidth': {'default': 220, 'type': 'integer', 'widget': null},
  'smartindent': {'default': true, 'type': 'boolean', 'widget': 'checkbox'},
  'spacestab': {'default': true, 'type': 'boolean', 'widget': 'checkbox'},
  'tabsize': {'default': 4, 'type': 'integer', 'widget': 'number'},
  'theme': {'default': 'default', 'type': 'string', 'widget': 'radio'},
  'wraplines': {'default': true, 'type': 'boolean', 'widget': 'checkbox'},
  'search': {'default': true, 'type': 'boolean', 'widget': 'search'},
};

/**
 * @param {string} key Setting name.
 * @return {*} The stored value, or the default if none is stored.
 * @private
 */
Settings.prototype.read_ = function(key) {
  var defaultValue = Settings.SETTINGS[key]['default'];
  try {
    var raw = window.localStorage.getItem(Settings.STORAGE_PREFIX + key);
    return raw === null ? defaultValue : JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read setting', key, e);
    return defaultValue;
  }
};

/**
 * @param {string} key Setting name.
 * @return {Object}
 */
Settings.prototype.get = function(key) {
  const setting = this.settings_[key];

  if (key === 'theme' && setting === 'default') {
    return this.colorSchemeMatcherDark_.matches ? 'dark' : 'light';
  }

  return setting;
};

Settings.prototype.getAll = function() {
  return this.settings_;
};

Settings.prototype.set = function(key, value) {
  try {
    window.localStorage.setItem(
        Settings.STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save setting', key, e);
  }
  this.update_(key, value);
};

Settings.prototype.reset = function(key) {
  var defaultValue = Settings.SETTINGS[key]['default'];
  this.set(key, defaultValue);
};

Settings.prototype.isReady = function() {
  return this.ready_;
};

/**
 * @param {string} key Setting name.
 * @param {*} value New value.
 * @private
 */
Settings.prototype.update_ = function(key, value) {
  if (this.settings_[key] === value) return;
  this.settings_[key] = value;
  $.event.trigger('settingschange', [key, value]);
};

/**
 * Applies a setting changed in another window of the app.
 * @param {!StorageEvent} e
 * @private
 */
Settings.prototype.onStorage_ = function(e) {
  if (e.storageArea !== window.localStorage) return;
  if (e.key === null) {
    // localStorage.clear() was called: reset everything to defaults.
    for (var name in Settings.SETTINGS) {
      this.update_(name, Settings.SETTINGS[name]['default']);
    }
    return;
  }
  if (e.key.indexOf(Settings.STORAGE_PREFIX) !== 0) return;
  var key = e.key.substring(Settings.STORAGE_PREFIX.length);
  if (!(key in Settings.SETTINGS)) return;
  this.update_(key, this.read_(key));
};
