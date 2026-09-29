/**
 * @fileoverview File access for the web app, built on the File System Access
 * API. Replaces chrome.fileSystem from the Chrome App version: files are
 * FileSystemFileHandle objects instead of FileEntry objects.
 */

var fileSystem = {};

/** @return {boolean} True if the browser supports the pickers used here. */
fileSystem.isSupported = function() {
  return typeof window.showOpenFilePicker === 'function' &&
         typeof window.showSaveFilePicker === 'function';
};

/** @private Throws NotSupportedError if the pickers are unavailable. */
fileSystem.assertSupported_ = function() {
  if (!fileSystem.isSupported()) {
    throw new DOMException('File System Access API unavailable',
                           'NotSupportedError');
  }
};

/**
 * @param {*} e
 * @return {boolean} True if e is the error thrown when a picker is dismissed.
 */
fileSystem.isAbort = function(e) {
  return !!e && e.name === 'AbortError';
};

/**
 * Shows the system open dialog.
 * @return {!Promise<!Array<!FileSystemFileHandle>>} The chosen files, or an
 *     empty array if the dialog was dismissed.
 */
fileSystem.pickFilesToOpen = async function() {
  fileSystem.assertSupported_();
  try {
    return await window.showOpenFilePicker(
        {multiple: true, id: 'text-app-files'});
  } catch (e) {
    if (fileSystem.isAbort(e)) return [];
    throw e;
  }
};

/**
 * Shows the system save dialog.
 * @param {string} suggestedName
 * @return {!Promise<?FileSystemFileHandle>} The chosen file, or null if the
 *     dialog was dismissed.
 */
fileSystem.pickFileToSave = async function(suggestedName) {
  fileSystem.assertSupported_();
  try {
    return await window.showSaveFilePicker(
        {suggestedName: suggestedName, id: 'text-app-files'});
  } catch (e) {
    if (fileSystem.isAbort(e)) return null;
    throw e;
  }
};

/**
 * @param {!FileSystemHandle} handle
 * @param {string} mode 'read' or 'readwrite'.
 * @return {!Promise<string>} 'granted', 'denied' or 'prompt'.
 */
fileSystem.queryPermission = async function(handle, mode) {
  if (typeof handle.queryPermission !== 'function') return 'granted';
  return handle.queryPermission({mode: mode});
};

/**
 * Makes sure the page may use the handle, asking the user if needed. Asking
 * requires a user gesture, so call this from a click or key handler.
 * @param {!FileSystemHandle} handle
 * @param {string} mode 'read' or 'readwrite'.
 * @return {!Promise<boolean>} True if permission is granted.
 */
fileSystem.ensurePermission = async function(handle, mode) {
  if (await fileSystem.queryPermission(handle, mode) === 'granted') {
    return true;
  }
  if (typeof handle.requestPermission !== 'function') return false;
  return (await handle.requestPermission({mode: mode})) === 'granted';
};

/**
 * @param {!FileSystemFileHandle} handle
 * @return {!Promise<string>} The file's contents decoded as UTF-8.
 */
fileSystem.readText = async function(handle) {
  const file = await handle.getFile();
  return file.text();
};

/**
 * Replaces the file's contents. The write is atomic: the browser writes to a
 * temporary file and swaps it in when the stream is closed.
 * @param {!FileSystemFileHandle} handle
 * @param {string} content
 * @return {!Promise}
 */
fileSystem.writeText = async function(handle, content) {
  if (!await fileSystem.ensurePermission(handle, 'readwrite')) {
    throw new DOMException('Permission to write the file was denied.',
                           'NotAllowedError');
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(function() {});
    throw e;
  }
};

/**
 * @param {!FileSystemHandle} a
 * @param {!FileSystemHandle} b
 * @return {!Promise<boolean>} True if both handles point at the same file.
 */
fileSystem.isSameFile = async function(a, b) {
  if (a === b) return true;
  try {
    return await a.isSameEntry(b);
  } catch (e) {
    return false;
  }
};

/**
 * @param {*} e An error thrown by the File System Access API.
 * @return {string} Human-readable error description.
 */
fileSystem.errorToString = function(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permission denied';
    case 'NotFoundError':
      return 'File not found';
    case 'QuotaExceededError':
      return 'Quota exceeded';
    case 'InvalidModificationError':
      return 'Invalid modification';
    case 'InvalidStateError':
      return 'Invalid state';
    case 'NoModificationAllowedError':
      return 'The file is locked by another program';
    case 'NotSupportedError':
      return 'Opening and saving files needs a browser with the File System ' +
             'Access API, such as Chrome or Edge';
    default:
      return (e && e.message) || 'Unknown error';
  }
};
