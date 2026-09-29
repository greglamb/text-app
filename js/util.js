var util = {};

/**
 * Signals a file system error to the UI and logs it.
 * @param {*} e An error thrown by the File System Access API.
 */
util.handleFSError = function(e) {
  $.event.trigger('filesystemerror');
  console.warn('FS Error:', fileSystem.errorToString(e), e);
};

/**
 * @return {boolean} True if running as an installed app in its own window,
 *     rather than in a browser tab.
 */
util.isInstalledApp = function() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: window-controls-overlay)').matches;
};

/**
 * @param {string} fileName
 * @return {string} Sanitized File name.
 * Returns a sanitized version of a File Name.
 */
util.sanitizeFileName = function(fileName) {
  return fileName.replace(/[^a-z0-9\-]/gi, ' ').substr(0, 50).trim();
}

/**
 * @param {string} fileName
 * @return {?string} Extension.
 * Returns the extension of a File Name or null if there's none.
 */
util.getExtension = function(fileName) {
  var match = /\.([^.\\\/]+)$/.exec(fileName);

  if (match) {
    return match[1];
  } else {
    return null;
  }
};

/**
 * @param {?string} [text] Text content.
 * @return {string} Line endings.
 * Returns guessed line endings or LF if not successful.
 */
util.guessLineEndings = function(text) {
  if (!text) {
    return '\n';
  }
  var indexOfLF = text.indexOf('\n');
  var hasCRLF = (indexOfLF > 0) && (text[indexOfLF - 1] === '\r');

  return (hasCRLF ? '\r\n' : '\n');
};
