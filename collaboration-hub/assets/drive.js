// Google Drive integration.
// Uses Google Identity Services (sign-in) + the Drive REST API (gapi client)
// to list real files from the configured folder and upload new ones.
//
// Scope used: drive.file — this app can only see/manage files that were
// either created by it or explicitly opened with it. It cannot browse a
// user's entire Drive. This is the safest scope for a third-party site.

window.DriveHub = (function () {
  var SCOPES = "https://www.googleapis.com/auth/drive.file";
  var tokenClient = null;
  var accessToken = null;
  var gapiReady = false;
  var listeners = [];

  function notify(state) {
    listeners.forEach(function (fn) { fn(state); });
  }

  function onStateChange(fn) {
    listeners.push(fn);
  }

  // Pull a folder ID out of any Drive folder URL the admin pastes in,
  // e.g. https://drive.google.com/drive/folders/1AbC...?usp=sharing -> 1AbC...
  function extractFolderId(input) {
    if (!input) return "";
    var trimmed = input.trim();
    var m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed; // looks like a bare ID already
    return "";
  }

  // List files/folders in any folder using just the API key (no sign-in).
  // The folder must be shared as "Anyone with the link - Viewer" in Drive.
  async function listPublicFiles(folderId) {
    var cfg = window.DRIVE_CONFIG || {};
    if (!cfg.API_KEY || cfg.API_KEY.indexOf("PASTE_") === 0) {
      throw new Error("Drive API key not configured — paste it into assets/drive-config.js");
    }
    if (!folderId) throw new Error("No folder ID");

    var q = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
    var fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size,webViewLink)");
    var url = "https://www.googleapis.com/drive/v3/files?q=" + q +
      "&fields=" + fields + "&orderBy=name&pageSize=200&key=" + cfg.API_KEY;

    var resp = await fetch(url);
    if (!resp.ok) {
      var body = await resp.json().catch(function () { return {}; });
      var msg = (body.error && body.error.message) || ("HTTP " + resp.status);
      throw new Error(msg + " — make sure the folder is shared as \"Anyone with the link\" Viewer in Google Drive.");
    }
    var data = await resp.json();
    return data.files || [];
  }

  // Full recursive sync: reads your entire Drive folder tree and maps it to
  // the portal structure automatically:
  //   Root folder
  //     └── Subfolder (Project)
  //           └── Subfolder (Department)
  //                 └── Files (Items)
  //
  // Any files sitting directly in the root or project level are grouped
  // into a "General" department automatically.
  async function syncFullDrive(onProgress) {
    var cfg = window.DRIVE_CONFIG || {};
    var rootId = cfg.ROOT_FOLDER_ID || cfg.FOLDER_ID || "root";

    function progress(msg) { if (onProgress) onProgress(msg); }

    function uid(prefix) {
      return prefix + "_" + Math.random().toString(36).slice(2, 10);
    }

    function mimeToType(mimeType) {
      if (!mimeType) return "FILE";
      if (mimeType.indexOf("folder") !== -1) return "Folder";
      if (mimeType.indexOf("pdf") !== -1) return "PDF";
      if (mimeType.indexOf("spreadsheet") !== -1 || mimeType.indexOf("excel") !== -1) return "XLS";
      if (mimeType.indexOf("document") !== -1 || mimeType.indexOf("word") !== -1) return "DOC";
      if (mimeType.indexOf("presentation") !== -1 || mimeType.indexOf("powerpoint") !== -1) return "PPT";
      if (mimeType.indexOf("image") !== -1) return "IMG";
      return "FILE";
    }

    function isFolder(f) { return f.mimeType && f.mimeType.indexOf("folder") !== -1; }

    // Get the existing projects so we can preserve statuses and share codes
    var existingProjects = [];
    try { existingProjects = JSON.parse(localStorage.getItem("hub_projects_v2") || "[]"); } catch (e) {}

    function findExisting(projects, name) {
      return projects.find(function (p) { return p.name === name; });
    }
    function findExistingDept(proj, name) {
      return (proj.departments || []).find(function (d) { return d.name === name; });
    }
    function findExistingItem(dept, driveId) {
      return (dept.items || []).find(function (it) { return it.driveFileId === driveId; });
    }

    progress("Reading root Drive folder…");
    var rootContents = await listPublicFiles(rootId);
    console.log("[DriveSync] root folder ID:", rootId);
    console.log("[DriveSync] root contents:", rootContents);
    var rootFolders = rootContents.filter(isFolder);
    var rootFiles = rootContents.filter(function (f) { return !isFolder(f); });
    console.log("[DriveSync] subfolders (will become projects):", rootFolders.map(function(f){return f.name;}));
    console.log("[DriveSync] files at root level:", rootFiles.map(function(f){return f.name;}));

    var projects = [];

    for (var i = 0; i < rootFolders.length; i++) {
      var projFolder = rootFolders[i];
      progress("Reading project: " + projFolder.name + "…");

      var existingProj = findExisting(existingProjects, projFolder.name);
      var proj = {
        id: (existingProj && existingProj.id) || uid("proj"),
        name: projFolder.name,
        driveFileId: projFolder.id,
        driveUrl: projFolder.webViewLink || "",
        departments: []
      };

      var projContents = await listPublicFiles(projFolder.id);
      var deptFolders = projContents.filter(isFolder);
      var projFiles = projContents.filter(function (f) { return !isFolder(f); });

      // Files directly in a project folder → "General" dept
      if (projFiles.length > 0) {
        var genExisting = existingProj ? findExistingDept(existingProj, "General") : null;
        var genDept = {
          id: (genExisting && genExisting.id) || uid("dept"),
          name: "General",
          driveUrl: projFolder.webViewLink || "",
          items: projFiles.map(function (f) {
            var prior = genExisting ? findExistingItem(genExisting, f.id) : null;
            return {
              id: (prior && prior.id) || uid("item"),
              name: f.name,
              type: mimeToType(f.mimeType),
              status: (prior && prior.status) || "Synced",
              driveFileId: f.id,
              driveUrl: f.webViewLink || "",
              modifiedAt: f.modifiedTime
            };
          })
        };
        proj.departments.push(genDept);
      }

      // Subfolders → departments
      for (var j = 0; j < deptFolders.length; j++) {
        var deptFolder = deptFolders[j];
        progress("Reading department: " + projFolder.name + " / " + deptFolder.name + "…");

        var existingDept = existingProj ? findExistingDept(existingProj, deptFolder.name) : null;
        var dept = {
          id: (existingDept && existingDept.id) || uid("dept"),
          name: deptFolder.name,
          driveFileId: deptFolder.id,
          driveUrl: deptFolder.webViewLink || "",
          items: []
        };

        var deptContents = await listPublicFiles(deptFolder.id);
        dept.items = deptContents.map(function (f) {
          var prior = existingDept ? findExistingItem(existingDept, f.id) : null;
          return {
            id: (prior && prior.id) || uid("item"),
            name: f.name,
            type: mimeToType(f.mimeType),
            status: (prior && prior.status) || "Synced",
            driveFileId: f.id,
            driveUrl: f.webViewLink || "",
            modifiedAt: f.modifiedTime
          };
        });

        proj.departments.push(dept);
      }

      projects.push(proj);
    }

    // Files at the root level → a "Root Files" project with one "General" dept
    if (rootFiles.length > 0) {
      var rootProjExisting = findExisting(existingProjects, "Root Files");
      projects.push({
        id: (rootProjExisting && rootProjExisting.id) || uid("proj"),
        name: "Root Files",
        driveUrl: "",
        departments: [{
          id: uid("dept"),
          name: "General",
          driveUrl: "",
          items: rootFiles.map(function (f) {
            return {
              id: uid("item"),
              name: f.name,
              type: mimeToType(f.mimeType),
              status: "Synced",
              driveFileId: f.id,
              driveUrl: f.webViewLink || "",
              modifiedAt: f.modifiedTime
            };
          })
        }]
      });
    }

    return projects;
  }

  function loadGapiClient() {
    return new Promise(function (resolve) {
      if (window.gapi && gapiReady) return resolve();
      var script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = function () {
        gapi.load("client", function () {
          gapi.client.init({}).then(function () {
            return gapi.client.load("https://www.googleapis.com/discovery/v1/apis/drive/v3/rest");
          }).then(function () {
            gapiReady = true;
            resolve();
          });
        });
      };
      document.head.appendChild(script);
    });
  }

  function loadIdentityServices() {
    return new Promise(function (resolve) {
      if (window.google && window.google.accounts) return resolve();
      var script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  async function init() {
    var cfg = window.DRIVE_CONFIG || {};
    if (!cfg.CLIENT_ID || cfg.CLIENT_ID.indexOf("PASTE_") === 0) {
      notify({ status: "not_configured" });
      return;
    }
    await Promise.all([loadGapiClient(), loadIdentityServices()]);
    gapi.client.setApiKey(cfg.API_KEY);

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.CLIENT_ID,
      scope: SCOPES,
      callback: function (resp) {
        if (resp.error) {
          notify({ status: "error", error: resp.error });
          return;
        }
        accessToken = resp.access_token;
        gapi.client.setToken({ access_token: accessToken });
        notify({ status: "signed_in" });
      }
    });

    notify({ status: "ready" });
  }

  function signIn() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, function () {});
    }
    accessToken = null;
    notify({ status: "signed_out" });
  }

  function isSignedIn() {
    return !!accessToken;
  }

  async function listFiles() {
    var cfg = window.DRIVE_CONFIG || {};
    var folderId = cfg.FOLDER_ID || "root";
    var q = folderId === "root"
      ? "'root' in parents and trashed = false"
      : "'" + folderId + "' in parents and trashed = false";

    var resp = await gapi.client.drive.files.list({
      q: q,
      fields: "files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink)",
      orderBy: "modifiedTime desc",
      pageSize: 50
    });
    return resp.result.files || [];
  }

  async function uploadFile(file) {
    var cfg = window.DRIVE_CONFIG || {};
    var folderId = cfg.FOLDER_ID || "root";
    var metadata = {
      name: file.name,
      parents: folderId === "root" ? undefined : [folderId]
    };

    var form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", file);

    var resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken },
      body: form
    });
    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    return resp.json();
  }

  function formatSize(bytes) {
    if (!bytes) return "—";
    bytes = parseInt(bytes, 10);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fileTag(mimeType) {
    if (!mimeType) return "FILE";
    if (mimeType.indexOf("pdf") !== -1) return "PDF";
    if (mimeType.indexOf("spreadsheet") !== -1 || mimeType.indexOf("excel") !== -1) return "XLS";
    if (mimeType.indexOf("word") !== -1 || mimeType.indexOf("document") !== -1) return "DOC";
    if (mimeType.indexOf("image") !== -1) return "IMG";
    if (mimeType.indexOf("folder") !== -1) return "DIR";
    return "FILE";
  }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    isSignedIn: isSignedIn,
    listFiles: listFiles,
    uploadFile: uploadFile,
    formatSize: formatSize,
    fileTag: fileTag,
    onStateChange: onStateChange,
    extractFolderId: extractFolderId,
    listPublicFiles: listPublicFiles,
    syncFullDrive: syncFullDrive
  };
})();
