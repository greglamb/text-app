/**
 * @fileoverview Replacement for chrome.i18n.getMessage() in the web app.
 *
 * Loads the Chrome-extension-style _locales/<locale>/messages.json files that
 * ship with the app and resolves messages with the same placeholder rules as
 * chrome.i18n: named $placeholder$ references expand to their "content", and
 * $1..$9 in that content are replaced with the substitutions passed in.
 */

var i18n = (function() {
  var DEFAULT_LOCALE = 'en';

  /** Locales that exist under _locales/. */
  var SUPPORTED_LOCALES = [
    'da', 'de', 'en', 'en_GB', 'es', 'es_419', 'fi', 'fr', 'fr_CA', 'it',
    'ja', 'ko', 'nl', 'no', 'pl', 'pt_BR', 'ru', 'sv', 'zh_CN', 'zh_TW',
  ];

  /** Browser language tags that don't map onto a folder name directly. */
  var LOCALE_ALIASES = {
    'nb': 'no',
    'nn': 'no',
    'pt': 'pt_BR',
    'zh': 'zh_CN',
    'zh_hans': 'zh_CN',
    'zh_hant': 'zh_TW',
    'zh_hk': 'zh_TW',
    'zh_mo': 'zh_TW',
  };

  var messages_ = {};
  var fallbackMessages_ = {};
  var locale_ = DEFAULT_LOCALE;

  /**
   * @param {string} tag A BCP 47 language tag such as "en-GB" or "zh-Hant-TW".
   * @return {?string} The best matching supported locale, or null.
   */
  function matchLocale(tag) {
    var parts = tag.replace(/-/g, '_').split('_');
    var candidates = [];
    for (var i = parts.length; i > 0; i--) {
      candidates.push(parts.slice(0, i).join('_'));
    }
    for (var j = 0; j < candidates.length; j++) {
      var lower = candidates[j].toLowerCase();
      if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower];
      for (var k = 0; k < SUPPORTED_LOCALES.length; k++) {
        if (SUPPORTED_LOCALES[k].toLowerCase() === lower) {
          return SUPPORTED_LOCALES[k];
        }
      }
    }
    return null;
  }

  /**
   * @param {!Array<string>} languages Preferred languages, most preferred
   *     first (navigator.languages).
   * @return {string} The locale to load.
   */
  function pickLocale(languages) {
    for (var i = 0; i < languages.length; i++) {
      var match = matchLocale(languages[i]);
      if (match) return match;
    }
    return DEFAULT_LOCALE;
  }

  /**
   * @param {!Object} messages A parsed messages.json.
   * @return {!Object} The same entries keyed by lowercase name, because
   *     chrome.i18n message names are case-insensitive.
   */
  function lowercaseKeys(messages) {
    var result = {};
    for (var name in messages) result[name.toLowerCase()] = messages[name];
    return result;
  }

  /**
   * @param {string} locale
   * @return {!Promise<!Object>} The parsed messages.json, or {} on failure.
   */
  function fetchMessages(locale) {
    return fetch('_locales/' + locale + '/messages.json')
        .then(function(response) {
          if (!response.ok) throw new Error(response.status);
          return response.json();
        })
        .then(lowercaseKeys)
        .catch(function(e) {
          console.warn('Could not load messages for locale', locale, e);
          return {};
        });
  }

  /**
   * Loads messages for the user's preferred language plus the default locale
   * as a fallback. Must resolve before getMessage() is called.
   * @param {!Array<string>=} opt_languages Overrides navigator.languages.
   * @return {!Promise}
   */
  function load(opt_languages) {
    var languages = opt_languages ||
        navigator.languages || [navigator.language || DEFAULT_LOCALE];
    locale_ = pickLocale(languages);
    var requests = [fetchMessages(DEFAULT_LOCALE)];
    if (locale_ !== DEFAULT_LOCALE) requests.push(fetchMessages(locale_));
    return Promise.all(requests).then(function(results) {
      fallbackMessages_ = results[0];
      messages_ = results[1] || results[0];
      document.documentElement.lang = locale_.replace('_', '-');
    });
  }

  /**
   * @param {!Object} entry A messages.json entry.
   * @param {!Array<*>} substitutions
   * @return {string}
   */
  function format(entry, substitutions) {
    var placeholders = {};
    var declared = entry['placeholders'] || {};
    for (var name in declared) {
      placeholders[name.toLowerCase()] = declared[name]['content'];
    }
    var text = String(entry['message']).replace(
        /\$([a-z0-9_@]+)\$/gi, function(match, name) {
          var content = placeholders[name.toLowerCase()];
          return content === undefined ? match : content;
        });
    return text.replace(/\$(\$|[1-9])/g, function(match, token) {
      if (token === '$') return '$';
      var value = substitutions[Number(token) - 1];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  /**
   * Same contract as chrome.i18n.getMessage(): returns '' for unknown keys.
   * @param {string} key
   * @param {(*|Array<*>)=} opt_substitutions
   * @return {string}
   */
  function getMessage(key, opt_substitutions) {
    var name = String(key).toLowerCase();
    var entry = messages_[name] || fallbackMessages_[name];
    if (!entry) return '';
    var substitutions = opt_substitutions === undefined ? [] :
        (Array.isArray(opt_substitutions) ?
            opt_substitutions : [opt_substitutions]);
    return format(entry, substitutions);
  }

  return {
    getLocale: function() { return locale_; },
    getMessage: getMessage,
    load: load,
    pickLocale: pickLocale,
  };
}());
