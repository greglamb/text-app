/**
 * @fileoverview Remembers which files were open so they can be reopened on
 * the next launch. Replaces chrome.fileSystem.retainEntry/restoreEntry:
 * FileSystemFileHandle objects are structured-cloneable, so they are stored
 * in IndexedDB as-is.
 */

var retainedFiles = (function() {
  var DB_NAME = 'text-app';
  var STORE_NAME = 'kv';
  var KEY = 'retainedFiles';

  /** @type {?Promise<!IDBDatabase>} */
  var dbPromise_ = null;

  /** @return {!Promise<!IDBDatabase>} */
  function openDb() {
    if (!dbPromise_) {
      dbPromise_ = new Promise(function(resolve, reject) {
        var request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = function() {
          request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { reject(request.error); };
      });
    }
    return dbPromise_;
  }

  /**
   * @param {string} mode 'readonly' or 'readwrite'.
   * @param {function(!IDBObjectStore): !IDBRequest} operation
   * @return {!Promise<*>} The request's result.
   */
  function run(mode, operation) {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, mode);
        var request = operation(tx.objectStore(STORE_NAME));
        tx.oncomplete = function() { resolve(request.result); };
        tx.onerror = function() { reject(tx.error); };
        tx.onabort = function() { reject(tx.error); };
      });
    });
  }

  /**
   * @param {!Array<!FileSystemFileHandle>} handles
   * @return {!Promise}
   */
  function save(handles) {
    return run('readwrite', function(store) {
      return store.put(handles.slice(), KEY);
    });
  }

  /** @return {!Promise<!Array<!FileSystemFileHandle>>} */
  function load() {
    return run('readonly', function(store) {
      return store.get(KEY);
    }).then(function(handles) {
      return Array.isArray(handles) ? handles : [];
    }).catch(function(e) {
      console.warn('Could not load the files to reopen:', e);
      return [];
    });
  }

  return {
    load: load,
    save: save,
  };
}());
