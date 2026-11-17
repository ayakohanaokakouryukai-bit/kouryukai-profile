// Thin wrappers around Apps Script services, shaped like the `deps` that Service.js expects.

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '').toLowerCase();
}

function makeMail_() {
  return {
    remaining: function () { return MailApp.getRemainingDailyQuota(); },
    send: function (to, msg) {
      MailApp.sendEmail({ to: to, subject: msg.subject, body: msg.body, name: '100人交流会 運営事務局' });
    },
  };
}

function makePhoto_(config, now) {
  return {
    save: function (base64, mimeType) {
      var stamp = now().getTime();
      var name = 'p' + stamp + '-' + Utilities.getUuid().slice(0, 8) + '.jpg';
      var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'image/jpeg', name);
      var file = DriveApp.getFolderById(config.photoFolderId).createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var id = file.getId();
      // Task 11: if this does not display on a real device, switch to https://lh3.googleusercontent.com/d/{id}=w400
      return { fileId: id, url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' };
    },
    trash: function (fileId) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (err) {
        console.warn('photo.trash skipped: ' + (err && err.message));
      }
    },
  };
}

var LIST_CACHE_TTL_ = 600;
var LIST_GEN_TTL_ = 21600; // CacheService maximum

// A generation value guards against a stale rebuild: the caller reads generation() before building the
// list, and putList only writes if invalidate() has not bumped the generation since.
function makeCache_() {
  var cache = CacheService.getScriptCache();
  function currentGen() {
    try {
      return cache.get('list:gen') || '0';
    } catch (err) {
      return '0';
    }
  }
  return {
    generation: currentGen,
    getList: function () {
      try {
        var n = parseInt(cache.get('list:n'), 10);
        if (!(n >= 1)) return null;
        var parts = [];
        for (var i = 0; i < n; i++) {
          var p = cache.get('list:' + i);
          if (p == null) return null;
          parts.push(p);
        }
        return JSON.parse(joinFromCache(parts));
      } catch (err) {
        return null;
      }
    },
    putList: function (list, gen) {
      try {
        if (currentGen() !== gen) return;
        var parts = splitForCache(JSON.stringify(list), CACHE_CHUNK_CHARS);
        for (var i = 0; i < parts.length; i++) cache.put('list:' + i, parts[i], LIST_CACHE_TTL_);
        cache.put('list:n', String(parts.length), LIST_CACHE_TTL_); // written last: readers see all chunks or none
        if (currentGen() !== gen) cache.remove('list:n'); // invalidated while writing: drop it
      } catch (err) {
        console.warn('cache.putList failed: ' + (err && err.message)); // caching is best effort
      }
    },
    invalidate: function () {
      cache.put('list:gen', Date.now() + '-' + Math.random().toString(36).slice(2), LIST_GEN_TTL_);
      cache.remove('list:n');
    },
  };
}

function makeAlerts_(now) {
  var key = 'ALERT_SENT_DATE';
  return {
    alreadySentToday: function () {
      return PropertiesService.getScriptProperties().getProperty(key) === jstDate(now());
    },
    markSentToday: function () {
      PropertiesService.getScriptProperties().setProperty(key, jstDate(now()));
    },
  };
}
