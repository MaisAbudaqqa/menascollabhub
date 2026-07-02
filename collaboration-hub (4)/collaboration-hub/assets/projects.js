/* =========================================================
   Project / Department / Item hierarchy + secure folder sharing
   Prototype data layer — uses localStorage so the demo works
   without a backend. Swap the HUB.store calls for real API
   calls when this is wired up to a server.
   ========================================================= */

(function () {
  "use strict";

  var LS_PROJECTS = "hub_projects_v2";
  var LS_SHARES = "hub_shares_v1";

  // current drill-down position in the browser
  var nav = { projectId: null, deptId: null };

  // ---------- storage helpers ----------

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 9);
  }

  function seedProjects() {
    return [
      {
        id: uid("proj"),
        name: "Landing Gear Program",
        departments: [
          {
            id: uid("dept"),
            name: "Drawings & specs",
            items: [
              { id: uid("item"), name: "Assembly drawing — Rev C.pdf", type: "PDF", status: "Final" },
              { id: uid("item"), name: "Tolerance specification.docx", type: "DOC", status: "Checked out" },
              { id: uid("item"), name: "Material callouts.xlsx", type: "XLS", status: "Final" }
            ]
          },
          {
            id: uid("dept"),
            name: "Quality documents",
            items: [
              { id: uid("item"), name: "Incoming inspection report — Batch 14.pdf", type: "PDF", status: "In review" },
              { id: uid("item"), name: "ISO certification.pdf", type: "PDF", status: "Final" }
            ]
          },
          {
            id: uid("dept"),
            name: "Purchase orders",
            items: [
              { id: uid("item"), name: "PO-2026-0148.pdf", type: "PDF", status: "Final" },
              { id: uid("item"), name: "PO-2026-0151.pdf", type: "PDF", status: "Final" }
            ]
          },
          {
            id: uid("dept"),
            name: "Supplier submissions",
            items: [
              { id: uid("item"), name: "Prototype test data — Supplier B.xlsx", type: "XLS", status: "New" }
            ]
          }
        ]
      }
    ];
  }

  function getProjects() { return load(LS_PROJECTS, seedProjects()); }
  function setProjects(p) { save(LS_PROJECTS, p); }
  function getShares() { return load(LS_SHARES, []); }
  function setShares(s) { save(LS_SHARES, s); }

  function findProject(id) { return getProjects().find(function (p) { return p.id === id; }); }
  function findDept(projects, projectId, deptId) {
    var proj = projects.find(function (p) { return p.id === projectId; });
    return proj ? proj.departments.find(function (d) { return d.id === deptId; }) : null;
  }

  function deleteProject(projectId, projectName) {
    if (!window.confirm('Delete "' + projectName + '" and everything inside it? This cannot be undone.')) return;
    var projects = getProjects().filter(function (p) { return p.id !== projectId; });
    setProjects(projects);
    if (nav.projectId === projectId) { nav.projectId = null; nav.deptId = null; }
    renderAll();
    toast("Project deleted");
  }

  function deleteDepartment(projectId, deptId, deptName) {
    if (!window.confirm('Delete department "' + deptName + '" and all its items? This cannot be undone.')) return;
    var projects = getProjects();
    var proj = projects.find(function (p) { return p.id === projectId; });
    if (proj) proj.departments = proj.departments.filter(function (d) { return d.id !== deptId; });
    setProjects(projects);
    if (nav.deptId === deptId) nav.deptId = null;
    renderAll();
    toast("Department deleted");
  }

  function deleteItem(projectId, deptId, itemId, itemName) {
    if (!window.confirm('Delete "' + itemName + '"? This cannot be undone.')) return;
    var projects = getProjects();
    var dept = findDept(projects, projectId, deptId);
    if (dept) dept.items = dept.items.filter(function (it) { return it.id !== itemId; });
    setProjects(projects);
    renderAll();
    toast("Item deleted");
  }

  function driveMimeToType(mimeType) {
    if (!mimeType) return "FILE";
    if (mimeType.indexOf("folder") !== -1) return "Folder";
    if (mimeType.indexOf("pdf") !== -1) return "PDF";
    if (mimeType.indexOf("spreadsheet") !== -1 || mimeType.indexOf("excel") !== -1) return "XLS";
    if (mimeType.indexOf("word") !== -1 || mimeType.indexOf("document") !== -1) return "DOC";
    if (mimeType.indexOf("image") !== -1) return "IMG";
    return "FILE";
  }

  function syncDeptFromDrive(projectId, deptId) {
    if (!window.DriveHub) { toast("Drive script not loaded"); return; }
    var projects = getProjects();
    var dept = findDept(projects, projectId, deptId);
    if (!dept || !dept.driveUrl) { toast("Set a Drive folder link first"); return; }
    var folderId = window.DriveHub.extractFolderId(dept.driveUrl);
    if (!folderId) { toast("That doesn't look like a valid Drive folder URL"); return; }

    toast("Syncing from Drive…");
    window.DriveHub.listPublicFiles(folderId).then(function (files) {
      var projects2 = getProjects();
      var dept2 = findDept(projects2, projectId, deptId);
      if (!dept2) return;
      var existingById = {};
      (dept2.items || []).forEach(function (it) { if (it.driveFileId) existingById[it.driveFileId] = it; });

      dept2.items = files.map(function (f) {
        var prior = existingById[f.id];
        return {
          id: (prior && prior.id) || uid("item"),
          name: f.name,
          type: driveMimeToType(f.mimeType),
          status: (prior && prior.status) || "Synced",
          modifiedAt: f.modifiedTime,
          driveFileId: f.id,
          driveUrl: f.webViewLink || dept2.driveUrl
        };
      });
      setProjects(projects2);
      renderAll();
      toast(files.length + " file" + (files.length === 1 ? "" : "s") + " synced from Drive");
    }).catch(function (err) {
      toast("Sync failed: " + err.message);
    });
  }

  // ---------- crypto-ish helpers for the share token + one-time code ----------

  function randomToken() {
    var bytes = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function randomCode() {
    var n = "";
    var arr = new Uint32Array(6);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    for (var i = 0; i < 6; i++) n += (arr[i] % 10).toString();
    return n;
  }

  function simpleHash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash = hash & hash; // force 32-bit
    }
    return Math.abs(hash).toString(36);
  }

  // ---------- toast ----------

  function toast(msg) {
    var el = document.getElementById("hub-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "hub-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  // ---------- modal scaffold ----------

  function openModal(html, onMount) {
    closeModal();
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "hub-modal-overlay";
    overlay.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true">' + html + "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
    if (onMount) onMount(overlay);
  }

  function closeModal() {
    var existing = document.getElementById("hub-modal-overlay");
    if (existing) existing.remove();
  }

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeModal(); closeTreeMenu(); }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function iconSvg(type, px) {
    px = px || 14;
    var paths = {
      ban: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" stroke-width="2"/>',
      clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      check: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.6 2.6L16 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      copy: '<rect x="8" y="8" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 16V6.5A1.5 1.5 0 0 1 6.5 5H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    };
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0;vertical-align:-2px;">' + (paths[type] || "") + "</svg>";
  }

  // two-tone yellow/orange folder icon, used anywhere a project or department is shown as a folder
  function folderIconHtml(px, extraStyle) {
    px = px || 20;
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" ' +
      'style="flex-shrink:0;display:inline-block;vertical-align:middle;' + (extraStyle || "") + '">' +
      '<path d="M4 5.5C4 4.67 4.67 4 5.5 4h4.4c.34 0 .67.13.92.37L12.4 6H18.5c.83 0 1.5.67 1.5 1.5v1H4z" fill="#f5a623"/>' +
      '<rect x="3" y="7.2" width="18" height="12.3" rx="2.2" fill="#ffce32"/>' +
      "</svg>";
  }

  function guessType(name) {
    var ext = (name.split(".").pop() || "").toUpperCase();
    return ext.length <= 4 ? ext : "FILE";
  }

  // ---------- "New project / department / item" modal ----------

  function openCreateModal(presetProjectId, presetDeptId) {
    var projects = getProjects();

    var projectOptions = projects.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === presetProjectId ? " selected" : "") + ">" + escapeHtml(p.name) + "</option>";
    }).join("");

    var defaultKind = presetDeptId ? "item" : presetProjectId ? "department" : "project";

    var html =
      '<h3>Create</h3>' +
      '<p class="modal-sub">Add a new project, or a department / item underneath an existing one.</p>' +
      '<div class="field">' +
      '<label>What are you creating?</label>' +
      '<select id="cf-kind">' +
      '<option value="project">New project</option>' +
      '<option value="department">New department (folder) in a project</option>' +
      '<option value="item">New item (file) in a department</option>' +
      "</select>" +
      "</div>" +
      '<div class="field" id="cf-project-field" style="display:none">' +
      '<label>Project</label>' +
      '<select id="cf-project">' + projectOptions + "</select>" +
      "</div>" +
      '<div class="field" id="cf-dept-field" style="display:none">' +
      '<label>Department</label>' +
      '<select id="cf-dept"></select>' +
      "</div>" +
      '<div class="field">' +
      '<label id="cf-name-label">Project name</label>' +
      '<input type="text" id="cf-name" placeholder="e.g. Landing Gear Program">' +
      "</div>" +
      '<div class="field" id="cf-drive-field" style="display:none">' +
      '<label>Google Drive folder URL (optional)</label>' +
      '<input type="url" id="cf-drive-url" placeholder="https://drive.google.com/drive/folders/...">' +
      "</div>" +
      '<div class="modal-foot">' +
      '<button class="btn" id="cf-cancel">Cancel</button>' +
      '<button class="btn btn-primary" id="cf-save">Create</button>' +
      "</div>";

    openModal(html, function (overlay) {
      var kindSel = overlay.querySelector("#cf-kind");
      var projField = overlay.querySelector("#cf-project-field");
      var deptField = overlay.querySelector("#cf-dept-field");
      var projSel = overlay.querySelector("#cf-project");
      var deptSel = overlay.querySelector("#cf-dept");
      var nameLabel = overlay.querySelector("#cf-name-label");
      var nameInput = overlay.querySelector("#cf-name");
      var driveField = overlay.querySelector("#cf-drive-field");
      var driveInput = overlay.querySelector("#cf-drive-url");

      function refreshDeptOptions() {
        var proj = getProjects().find(function (p) { return p.id === projSel.value; });
        deptSel.innerHTML = (proj ? proj.departments : []).map(function (d) {
          return '<option value="' + d.id + '"' + (d.id === presetDeptId ? " selected" : "") + ">" + escapeHtml(d.name) + "</option>";
        }).join("");
      }

      function syncFields() {
        var kind = kindSel.value;
        projField.style.display = kind === "project" ? "none" : "block";
        deptField.style.display = kind === "item" ? "block" : "none";
        nameLabel.textContent = kind === "project" ? "Project name" : kind === "department" ? "Department name" : "Item / file name";
        nameInput.placeholder = kind === "project" ? "e.g. Landing Gear Program" : kind === "department" ? "e.g. Quality documents" : "e.g. Inspection report Rev A.pdf";
        driveField.style.display = kind === "project" ? "none" : "block";
        if (kind !== "project") refreshDeptOptions();
      }

      kindSel.value = defaultKind;
      kindSel.addEventListener("change", syncFields);
      projSel.addEventListener("change", refreshDeptOptions);
      syncFields();

      overlay.querySelector("#cf-cancel").addEventListener("click", closeModal);
      overlay.querySelector("#cf-save").addEventListener("click", function () {
        var name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        var driveUrl = driveInput.value.trim();
        var kind = kindSel.value;
        var projects = getProjects();
        var newDeptId = null;

        if (kind === "project") {
          var newProj = { id: uid("proj"), name: name, departments: [] };
          projects.push(newProj);
        } else if (kind === "department") {
          var proj = projects.find(function (p) { return p.id === projSel.value; });
          if (!proj) { toast("Pick a project first"); return; }
          newDeptId = uid("dept");
          proj.departments.push({ id: newDeptId, name: name, items: [], driveUrl: driveUrl });
        } else {
          var proj2 = projects.find(function (p) { return p.id === projSel.value; });
          var dept = proj2 && proj2.departments.find(function (d) { return d.id === deptSel.value; });
          if (!dept) { toast("Pick a department first"); return; }
          dept.items.push({ id: uid("item"), name: name, type: guessType(name), status: "New", driveUrl: driveUrl });
        }

        setProjects(projects);
        closeModal();
        toast("Created");
        if (kind === "department" && projSel.value === nav.projectId) { /* stay in place, just refresh */ }
        renderAll();
      });
    });
  }

  // ---------- drive link modal ----------

  function openDriveLinkModal(kind, projId, deptId, itemId, currentUrl, label) {
    var html =
      '<h3>Google Drive folder link</h3>' +
      '<p class="modal-sub">Paste the real Drive folder URL for "' + escapeHtml(label) + '". Suppliers who unlock this share will see a button to open it.</p>' +
      '<div class="field"><label>Drive folder URL</label><input type="url" id="dl-url" placeholder="https://drive.google.com/drive/folders/..." value="' + escapeHtml(currentUrl || "") + '"></div>' +
      '<div class="modal-foot">' +
      '<button class="btn" id="dl-cancel">Cancel</button>' +
      '<button class="btn btn-primary" id="dl-save">Save</button>' +
      "</div>";

    openModal(html, function (overlay) {
      overlay.querySelector("#dl-cancel").addEventListener("click", closeModal);
      overlay.querySelector("#dl-save").addEventListener("click", function () {
        var url = overlay.querySelector("#dl-url").value.trim();
        var projects = getProjects();
        var proj = projects.find(function (p) { return p.id === projId; });
        if (!proj) { closeModal(); return; }
        var dept = proj.departments.find(function (d) { return d.id === deptId; });
        if (!dept) { closeModal(); return; }
        if (kind === "department") {
          dept.driveUrl = url;
        } else {
          var item = dept.items.find(function (it) { return it.id === itemId; });
          if (item) item.driveUrl = url;
        }
        setProjects(projects);
        closeModal();
        toast("Drive link saved");
        renderAll();
      });
    });
  }

  // ---------- share modal ----------

  function openShareModal(scopeType, scopeId, scopeName, projectName) {
    var html =
      '<h3>Share "' + escapeHtml(scopeName) + '"</h3>' +
      '<p class="modal-sub">Generate a link for this ' + (scopeType === "department" ? "folder" : "item") + '. The supplier also needs the 6-digit code to unlock it — send them separately.</p>' +
      '<div class="field"><label>Supplier / contact name</label><input type="text" id="sh-name" placeholder="e.g. Acme Fabrication"></div>' +
      '<div class="field"><label>Supplier email (optional, for your records)</label><input type="email" id="sh-email" placeholder="contact@supplier.com"></div>' +
      '<div id="sh-result"></div>' +
      '<div class="modal-foot">' +
      '<button class="btn" id="sh-cancel">Close</button>' +
      '<button class="btn btn-primary" id="sh-generate">Generate link &amp; code</button>' +
      "</div>";

    openModal(html, function (overlay) {
      overlay.querySelector("#sh-cancel").addEventListener("click", closeModal);
      overlay.querySelector("#sh-generate").addEventListener("click", async function () {
        var nameInput = overlay.querySelector("#sh-name");
        var emailInput = overlay.querySelector("#sh-email");
        var supplierName = nameInput.value.trim() || "Unnamed supplier";

        // Get or create the status blob ID (creates one on first ever share)
        var blobId = "";
        if (window.StatusSync) {
          try { blobId = await window.StatusSync.getOrCreateBlobId(); } catch(e) {}
        }

        var token = randomToken();
        var code = randomCode();

        // Get the drive URL for this scope so we can embed it in the link
        var projects = getProjects();
        var driveUrl = "";
        if (scopeType === "department") {
          for (var p = 0; p < projects.length; p++) {
            var d = projects[p].departments.find(function (d) { return d.id === scopeId; });
            if (d) { driveUrl = d.driveUrl || ""; break; }
          }
        } else {
          for (var p2 = 0; p2 < projects.length; p2++) {
            for (var d2 = 0; d2 < projects[p2].departments.length; d2++) {
              var it = projects[p2].departments[d2].items.find(function (it) { return it.id === scopeId; });
              if (it) { driveUrl = it.driveUrl || ""; break; }
            }
          }
        }

        // Save to localStorage for admin tracking
        var shares = getShares();
        shares.unshift({
          token: token,
          code: code,
          scopeType: scopeType,
          scopeId: scopeId,
          scopeName: scopeName,
          projectName: projectName || "",
          supplierName: supplierName,
          supplierEmail: emailInput.value.trim(),
          createdAt: new Date().toISOString(),
          status: "pending",
          accessedAt: null,
          attempts: 0
        });
        setShares(shares);

        // Encode ALL share data into the URL so any device can open it
        // The code itself is NOT in the URL — supplier needs it separately
        var sharePayload = {
          token: token,
          scopeType: scopeType,
          scopeId: scopeId,
          scopeName: scopeName,
          projectName: projectName || "",
          supplierName: supplierName,
          driveUrl: driveUrl,
          codeHash: simpleHash(token + code),
          blobId: blobId,
          createdAt: new Date().toISOString()
        };
        var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(sharePayload))));
        var base = (location.origin + location.pathname).replace(/[^\/]*$/, "");
        var link = base + "share.html?d=" + encodeURIComponent(encoded);

        // Format code as XXX-XXX for readability
        var codeDisplay = code.slice(0, 3) + "-" + code.slice(3);

        var resultHtml =
          '<div class="share-result">' +
          '<p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 6px;">Share link — send this first</p>' +
          '<div class="sh-copy-row">' +
            '<span class="sh-copy-val">' + escapeHtml(link) + '</span>' +
            '<button class="sh-copy-btn" id="sh-copy-link"><i class="ti ti-copy"></i> Copy link</button>' +
          '</div>' +
          '<p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:16px 0 6px;">Access code — send this separately</p>' +
          '<div class="sh-code-block">' +
            '<div class="sh-code-digits">' + escapeHtml(codeDisplay) + '</div>' +
            '<button class="sh-copy-btn" id="sh-copy-code"><i class="ti ti-copy"></i> Copy code</button>' +
          '</div>' +
          '<p class="share-warning" style="margin-top:14px;">Send the link and the code <strong>separately</strong> — e.g. email the link, text the code. The code works once only.</p>' +
          '</div>';

        overlay.querySelector("#sh-result").innerHTML = resultHtml;
        overlay.querySelector("#sh-generate").style.display = "none";
        nameInput.disabled = true;
        emailInput.disabled = true;

        overlay.querySelector("#sh-copy-link").addEventListener("click", function () {
          copyToClipboard(link);
          var btn = overlay.querySelector("#sh-copy-link");
          btn.innerHTML = '<i class="ti ti-check"></i> Copied!';
          btn.style.background = "var(--coral)"; btn.style.color = "#fff";
          setTimeout(function () { btn.innerHTML = '<i class="ti ti-copy"></i> Copy link'; btn.style.background = ""; btn.style.color = ""; }, 2000);
        });
        overlay.querySelector("#sh-copy-code").addEventListener("click", function () {
          copyToClipboard(code);
          var btn = overlay.querySelector("#sh-copy-code");
          btn.innerHTML = '<i class="ti ti-check"></i> Copied!';
          btn.style.background = "var(--coral)"; btn.style.color = "#fff";
          setTimeout(function () { btn.innerHTML = '<i class="ti ti-copy"></i> Copy code'; btn.style.background = ""; btn.style.color = ""; }, 2000);
        });

        renderShares();
        document.dispatchEvent(new CustomEvent("hub:shares-changed"));
      });
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
  }

  function revokeShare(token) {
    var shares = getShares();
    var s = shares.find(function (x) { return x.token === token; });
    if (s) {
      s.status = "revoked";
      setShares(shares);
      renderShares();
      toast("Link revoked");
      document.dispatchEvent(new CustomEvent("hub:shares-changed"));
    }
  }

  // ---------- share picker (toolbar button — pick what to share, then share it) ----------

  function openSharePicker() {
    var projects = getProjects();
    if (!projects.length) {
      closeModal();
      toast("Create a project first");
      return;
    }

    var projectOptions = projects.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === nav.projectId ? " selected" : "") + ">" + escapeHtml(p.name) + "</option>";
    }).join("");

    var html =
      '<h3>Share a folder</h3>' +
      '<p class="modal-sub">Pick the project and department (or a single item) you want to give a supplier access to.</p>' +
      '<div class="field"><label>Project</label><select id="sp-project">' + projectOptions + "</select></div>" +
      '<div class="field"><label>What to share</label><select id="sp-scope"></select></div>' +
      '<div class="modal-foot">' +
      '<button class="btn" id="sp-cancel">Cancel</button>' +
      '<button class="btn btn-primary" id="sp-next">Continue</button>' +
      "</div>";

    openModal(html, function (overlay) {
      var projSel = overlay.querySelector("#sp-project");
      var scopeSel = overlay.querySelector("#sp-scope");

      function refreshScopes() {
        var proj = projects.find(function (p) { return p.id === projSel.value; });
        if (!proj) { scopeSel.innerHTML = ""; return; }
        var deptOpts = proj.departments.map(function (d) {
          return '<option value="dept:' + d.id + '"' + (d.id === nav.deptId ? " selected" : "") + '>📁 ' + escapeHtml(d.name) + " (whole folder)</option>";
        });
        var itemOpts = [];
        proj.departments.forEach(function (d) {
          d.items.forEach(function (it) {
            itemOpts.push('<option value="item:' + d.id + ":" + it.id + '">📄 ' + escapeHtml(d.name) + " / " + escapeHtml(it.name) + "</option>");
          });
        });
        scopeSel.innerHTML = deptOpts.concat(itemOpts).join("") || '<option value="">No departments yet — add one first</option>';
      }

      projSel.addEventListener("change", refreshScopes);
      refreshScopes();

      overlay.querySelector("#sp-cancel").addEventListener("click", closeModal);
      overlay.querySelector("#sp-next").addEventListener("click", function () {
        var proj = projects.find(function (p) { return p.id === projSel.value; });
        var val = scopeSel.value;
        if (!proj || !val) { toast("Add a department first"); return; }

        if (val.indexOf("dept:") === 0) {
          var deptId = val.slice(5);
          var dept = proj.departments.find(function (d) { return d.id === deptId; });
          if (dept) openShareModal("department", dept.id, dept.name, proj.name);
        } else {
          var parts = val.slice(5).split(":");
          var dept2 = proj.departments.find(function (d) { return d.id === parts[0]; });
          var item = dept2 && dept2.items.find(function (it) { return it.id === parts[1]; });
          if (item) openShareModal("item", item.id, item.name, proj.name);
        }
      });
    });
  }

  // ---------- kebab menu (shared by sidebar list + folder cards + item rows) ----------

  function closeTreeMenu() {
    var existing = document.getElementById("tree-menu");
    if (existing) existing.remove();
    document.querySelectorAll(".tree-kebab.open").forEach(function (b) { b.classList.remove("open"); });
  }

  document.addEventListener("click", closeTreeMenu);

  function openKebabMenu(btn, items) {
    var wasOpen = btn.classList.contains("open");
    closeTreeMenu();
    if (wasOpen) return;
    btn.classList.add("open");

    var menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.id = "tree-menu";
    menu.innerHTML = items.map(function (it, i) {
      return '<button data-i="' + i + '"' + (it.danger ? ' class="danger"' : '') + '>' +
        '<svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" aria-hidden="true" style="flex-shrink:0;"><circle cx="3" cy="3" r="3"/></svg>' +
        escapeHtml(it.label) + "</button>";
    }).join("");
    document.body.appendChild(menu);

    var rect = btn.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 4;
    var left = Math.min(rect.left + window.scrollX, window.innerWidth - 190);
    menu.style.top = top + "px";
    menu.style.left = left + "px";

    menu.querySelectorAll("button").forEach(function (mbtn) {
      mbtn.addEventListener("click", function (e) {
        e.stopPropagation();
        items[Number(mbtn.dataset.i)].action();
        closeTreeMenu();
      });
    });
  }

  // ---------- sidebar: flat project list ----------

  function renderSidebar() {
    var mount = document.getElementById("project-tree");
    if (!mount) return;
    var projects = getProjects();

    mount.innerHTML = projects.map(function (p) {
      var cls = "tree-item root depth-0" + (p.id === nav.projectId ? " active-row" : "");
      return '<div class="' + cls + '" data-go-project="' + p.id + '" style="cursor:pointer;">' +
        folderIconHtml(16, "margin-right:6px;") + escapeHtml(p.name) +
        '<button class="tree-kebab" data-kebab-project="' + p.id + '" title="Options" aria-label="Options"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="19" r="2.4"/></svg></button>' +
        "</div>";
    }).join("") || '<p style="font-size:12.5px;color:var(--text-muted);padding:8px 4px;">No projects yet.</p>';

    mount.querySelectorAll("[data-go-project]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest(".tree-kebab")) return;
        nav.projectId = row.dataset.goProject;
        nav.deptId = null;
        renderAll();
      });
    });

    mount.querySelectorAll("[data-kebab-project]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var projectId = btn.dataset.kebabProject;
        var proj = findProject(projectId);
        openKebabMenu(btn, [
          { icon: "ti-folder-plus", label: "Add department", action: function () { openCreateModal(projectId, null); } },
          { icon: "ti-trash", label: "Delete project", danger: true, action: function () { deleteProject(projectId, proj ? proj.name : "this project"); } }
        ]);
      });
    });

    var statProjects = document.getElementById("stat-projects");
    var statItems = document.getElementById("stat-items");
    if (statProjects) statProjects.textContent = projects.length;
    if (statItems) {
      var total = 0;
      projects.forEach(function (p) { p.departments.forEach(function (d) { total += d.items.length; }); });
      statItems.textContent = total;
    }
  }

  // ---------- breadcrumb ----------

  function renderBreadcrumb() {
    var mount = document.getElementById("breadcrumb");
    if (!mount) return;
    var projects = getProjects();
    var proj = nav.projectId ? findProject(nav.projectId) : null;
    var dept = proj && nav.deptId ? proj.departments.find(function (d) { return d.id === nav.deptId; }) : null;

    var parts = [];
    parts.push('<button data-crumb="root"' + (!proj ? ' class="current"' : "") + '>' + folderIconHtml(14, "margin-right:4px;") + "Projects</button>");
    if (proj) {
      parts.push('<span class="crumb-sep">/</span>');
      parts.push('<button data-crumb="project"' + (!dept ? ' class="current"' : "") + '>' + escapeHtml(proj.name) + "</button>");
    }
    if (dept) {
      parts.push('<span class="crumb-sep">/</span>');
      parts.push('<button class="current">' + escapeHtml(dept.name) + "</button>");
    }
    mount.innerHTML = parts.join("");

    var rootBtn = mount.querySelector('[data-crumb="root"]');
    var projBtn = mount.querySelector('[data-crumb="project"]');
    if (rootBtn) rootBtn.addEventListener("click", function () { nav.projectId = null; nav.deptId = null; renderAll(); });
    if (projBtn) projBtn.addEventListener("click", function () { nav.deptId = null; renderAll(); });
  }

  // ---------- main browser (folder grid or item table) ----------

  function statusPillClass(status) {
    if (status === "Final") return "completed";
    if (status === "In review") return "open";
    if (status === "Checked out") return "blocked";
    return "in-progress";
  }

  function fmtShort(dt) {
    if (!dt) return "—";
    return new Date(dt).toLocaleDateString();
  }

  function renderBrowser() {
    var mount = document.getElementById("browser-root");
    var footCount = document.getElementById("browser-foot-count");
    var filterBtn = document.getElementById("btn-filter");
    if (!mount) return;

    var projects = getProjects();
    var searchVal = ((document.getElementById("browser-search") || {}).value || "").trim().toLowerCase();

    // ---- level 0: list of projects as folders ----
    if (!nav.projectId) {
      if (filterBtn) filterBtn.style.display = "";
      var visibleProjects = projects.filter(function (p) { return !searchVal || p.name.toLowerCase().indexOf(searchVal) !== -1; });

      var cards = visibleProjects.map(function (p) {
        var deptCount = p.departments.length;
        var itemCount = p.departments.reduce(function (a, d) { return a + d.items.length; }, 0);
        return '<div class="folder-card" data-open-project="' + p.id + '">' +
          '<button class="tree-kebab" data-kebab-project="' + p.id + '" title="Options" aria-label="Options"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="19" r="2.4"/></svg></button>' +
          '<div class="fc-icon">' + folderIconHtml(34) + "</div>" +
          '<div class="fc-name">' + escapeHtml(p.name) + "</div>" +
          '<div class="fc-meta">' + deptCount + " department" + (deptCount === 1 ? "" : "s") + " &middot; " + itemCount + " item" + (itemCount === 1 ? "" : "s") + "</div>" +
          "</div>";
      }).join("");

      var newProjectCard =
        '<div class="folder-card new-card" id="card-new-project">' +
        '<div class="fc-icon"><i class="ti ti-plus"></i></div>' +
        '<div class="fc-name">+ Add project</div>' +
        "</div>";

      mount.innerHTML = '<div class="folder-grid">' + cards + newProjectCard + "</div>";
      if (footCount) footCount.textContent = visibleProjects.length + " project" + (visibleProjects.length === 1 ? "" : "s");

      mount.querySelectorAll("[data-open-project]").forEach(function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.closest(".tree-kebab")) return;
          nav.projectId = card.dataset.openProject;
          nav.deptId = null;
          renderAll();
        });
      });
      mount.querySelectorAll("[data-kebab-project]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var projectId = btn.dataset.kebabProject;
          var proj2 = findProject(projectId);
          openKebabMenu(btn, [
            { icon: "ti-folder-plus", label: "Add department", action: function () { openCreateModal(projectId, null); } },
            { icon: "ti-trash", label: "Delete project", danger: true, action: function () { deleteProject(projectId, proj2 ? proj2.name : "this project"); } }
          ]);
        });
      });
      var newProjectCardEl = document.getElementById("card-new-project");
      if (newProjectCardEl) newProjectCardEl.addEventListener("click", function () { openCreateModal(); });

      return;
    }

    var proj = findProject(nav.projectId);
    if (!proj) { nav.projectId = null; renderBrowser(); return; }

    // ---- level 1: departments inside a project, as folders ----
    if (!nav.deptId) {
      if (filterBtn) filterBtn.style.display = "";
      var visibleDepts = proj.departments.filter(function (d) { return !searchVal || d.name.toLowerCase().indexOf(searchVal) !== -1; });

      var deptCards = visibleDepts.map(function (d) {
        return '<div class="folder-card" data-open-dept="' + d.id + '">' +
          '<button class="tree-kebab" data-kebab-dept="' + d.id + '" title="Options" aria-label="Options"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="19" r="2.4"/></svg></button>' +
          '<div class="fc-icon">' + folderIconHtml(34) + "</div>" +
          '<div class="fc-name">' + escapeHtml(d.name) + "</div>" +
          '<div class="fc-meta">' + d.items.length + " item" + (d.items.length === 1 ? "" : "s") + "</div>" +
          "</div>";
      }).join("");

      var newDeptCard =
        '<div class="folder-card new-card" id="card-new-dept">' +
        '<div class="fc-icon"><i class="ti ti-plus"></i></div>' +
        '<div class="fc-name">+ Add department</div>' +
        "</div>";

      mount.innerHTML = visibleDepts.length || true
        ? '<div class="folder-grid">' + deptCards + newDeptCard + "</div>"
        : '<div class="browser-empty">No departments yet in this project.</div>';

      if (footCount) footCount.textContent = visibleDepts.length + " department" + (visibleDepts.length === 1 ? "" : "s");

      mount.querySelectorAll("[data-open-dept]").forEach(function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.closest(".tree-kebab")) return;
          nav.deptId = card.dataset.openDept;
          renderAll();
        });
      });
      mount.querySelectorAll("[data-kebab-dept]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var deptId = btn.dataset.kebabDept;
          var dept = proj.departments.find(function (d) { return d.id === deptId; });
          openKebabMenu(btn, [
            { icon: "ti-share-2", label: "Share this folder", action: function () { openShareModal("department", dept.id, dept.name, proj.name); } },
            { icon: "ti-brand-google-drive", label: "Set Drive folder link", action: function () { openDriveLinkModal("department", proj.id, dept.id, null, dept ? dept.driveUrl : "", dept ? dept.name : ""); } },
            { icon: "ti-refresh", label: "Sync files from Drive", action: function () { syncDeptFromDrive(proj.id, dept.id); } },
            { icon: "ti-file-plus", label: "Add item", action: function () { openCreateModal(proj.id, deptId); } },
            { icon: "ti-trash", label: "Delete department", danger: true, action: function () { deleteDepartment(proj.id, deptId, dept ? dept.name : "this department"); } }
          ]);
        });
      });
      var newDeptCardEl = document.getElementById("card-new-dept");
      if (newDeptCardEl) newDeptCardEl.addEventListener("click", function () { openCreateModal(proj.id, null); });

      return;
    }

    // ---- level 2: items inside a department, as a file table ----
    var dept = proj.departments.find(function (d) { return d.id === nav.deptId; });
    if (!dept) { nav.deptId = null; renderBrowser(); return; }

    if (filterBtn) filterBtn.style.display = "";

    var statusVal = (document.getElementById("filter-status") || {}).value || "";
    var visibleItems = dept.items.filter(function (it) {
      if (searchVal && it.name.toLowerCase().indexOf(searchVal) === -1) return false;
      if (statusVal && it.status !== statusVal) return false;
      return true;
    });

    if (!dept.items.length) {
      mount.innerHTML = '<div class="browser-empty">No items in this department yet. Use the + New item button below to add one.</div>' +
        '<div class="folder-grid"><div class="folder-card new-card" id="card-new-item"><div class="fc-icon"><i class="ti ti-plus"></i></div><div class="fc-name">+ Add item</div></div></div>';
      var newItemCardEl0 = document.getElementById("card-new-item");
      if (newItemCardEl0) newItemCardEl0.addEventListener("click", function () { openCreateModal(proj.id, dept.id); });
      if (footCount) footCount.textContent = "0 items";
      return;
    }

    var rows = visibleItems.map(function (it) {
      return '<tr>' +
        '<td class="checkbox-cell"><input type="checkbox"></td>' +
        '<td class="star-cell"><i class="ti ti-star star-icon" aria-hidden="true"></i></td>' +
        '<td class="dt-name-cell"><i class="ti ti-file-text" aria-hidden="true"></i>' + escapeHtml(it.name) + "</td>" +
        '<td>' + escapeHtml(it.type || "") + "</td>" +
        '<td><span class="dt-pill ' + statusPillClass(it.status) + '">' + escapeHtml(it.status || "") + "</span></td>" +
        '<td style="font-family:var(--font-mono); font-size:12px;">' + fmtShort(it.modifiedAt) + "</td>" +
        '<td>' +
        '<button class="tree-kebab" data-kebab-item="' + it.id + '" title="Options" aria-label="Options" style="position:static;"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="19" r="2.4"/></svg></button>' +
        "</td>" +
        "</tr>";
    }).join("");

    mount.innerHTML =
      '<div class="dt-wrap"><table class="dt"><thead><tr>' +
      '<th class="checkbox-cell"><input type="checkbox" aria-label="Select all"></th>' +
      '<th class="star-cell"></th><th>Name</th><th>Type</th><th>Status</th><th>Modified</th><th></th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<div style="padding:14px 20px;"><button class="btn" id="btn-add-item-inline"><i class="ti ti-plus" aria-hidden="true"></i> New item</button></div>';

    if (footCount) footCount.textContent = visibleItems.length + " item" + (visibleItems.length === 1 ? "" : "s") + " in " + dept.name;

    mount.querySelectorAll("[data-kebab-item]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var itemId = btn.dataset.kebabItem;
        var item = dept.items.find(function (it) { return it.id === itemId; });
        openKebabMenu(btn, [
          { icon: "ti-share-2", label: "Share this item", action: function () { openShareModal("item", item.id, item.name, proj.name); } },
          { icon: "ti-brand-google-drive", label: "Set Drive folder link", action: function () { openDriveLinkModal("item", proj.id, dept.id, item.id, item ? item.driveUrl : "", item ? item.name : ""); } },
          { icon: "ti-trash", label: "Delete item", danger: true, action: function () { deleteItem(proj.id, dept.id, itemId, item ? item.name : "this item"); } }
        ]);
      });
    });

    var addItemInline = document.getElementById("btn-add-item-inline");
    if (addItemInline) addItemInline.addEventListener("click", function () { openCreateModal(proj.id, dept.id); });
  }

  // ---------- filter popover (jump straight to a project / department, optionally by status) ----------

  function renderFilterOptions() {
    var projSel = document.getElementById("filter-project");
    var deptSel = document.getElementById("filter-dept");
    if (!projSel || !deptSel) return;
    var projects = getProjects();

    var prevProj = projSel.value;
    projSel.innerHTML = '<option value="">All projects</option>' + projects.map(function (p) {
      return '<option value="' + p.id + '">' + escapeHtml(p.name) + "</option>";
    }).join("");
    if (projects.some(function (p) { return p.id === prevProj; })) projSel.value = prevProj;
    else if (nav.projectId) projSel.value = nav.projectId;

    function refreshDepts() {
      var proj = projects.find(function (p) { return p.id === projSel.value; });
      var depts = proj ? proj.departments : [];
      var prevDept = deptSel.value;
      deptSel.innerHTML = '<option value="">All departments</option>' + depts.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.name) + "</option>";
      }).join("");
      if (depts.some(function (d) { return d.id === prevDept; })) deptSel.value = prevDept;
      else if (nav.deptId && proj && proj.id === nav.projectId) deptSel.value = nav.deptId;
    }
    projSel.onchange = refreshDepts;
    refreshDepts();
  }

  function applyFilter() {
    var projVal = (document.getElementById("filter-project") || {}).value || "";
    var deptVal = (document.getElementById("filter-dept") || {}).value || "";

    nav.projectId = projVal || null;
    nav.deptId = projVal && deptVal ? deptVal : null;

    var filterPop = document.getElementById("filter-popover");
    if (filterPop) filterPop.classList.remove("open");

    renderAll();
    toast("Filter applied");
  }

  function clearFilter() {
    ["filter-project", "filter-dept", "filter-status"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    nav.projectId = null;
    nav.deptId = null;
    renderAll();
  }

  // ---------- shared links table (admin view) ----------

  function statusPillHtml(s) {
    if (s.status === "accessed") return '<span class="dt-pill accessed">' + iconSvg("check", 11) + " Accessed</span>";
    if (s.status === "revoked") return '<span class="dt-pill revoked">' + iconSvg("ban", 11) + " Revoked</span>";
    return '<span class="dt-pill pending">' + iconSvg("clock", 11) + " Pending</span>";
  }

  function fmt(dt) {
    if (!dt) return "—";
    var d = new Date(dt);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderShares() {
    var mount = document.getElementById("shares-tbody");
    if (!mount) return;
    var shares = getShares();

    // Merge any cross-device status updates written by share.html
    // Both admin and supplier share the same localStorage origin on Netlify
    var updated = false;
    shares.forEach(function (s) {
      if (s.status !== "accessed") {
        try {
          var crossDevice = JSON.parse(localStorage.getItem("hub_status_" + s.token) || "null");
          if (crossDevice && crossDevice.status === "accessed") {
            s.status = "accessed";
            s.accessedAt = crossDevice.accessedAt || new Date().toISOString();
            if (crossDevice.email) s.accessEmail = crossDevice.email;
            updated = true;
          }
        } catch(e) {}
      }
    });
    if (updated) setShares(shares);

    if (!shares.length) {
      mount.innerHTML = '<tr class="empty-row"><td colspan="6">No share links yet. Open a department or item and use its ⋮ menu, or the "Share a folder" button, to create one.</td></tr>';
      return;
    }

    mount.innerHTML = shares.map(function (s) {
      return "<tr>" +
        "<td><strong>" + escapeHtml(s.scopeName) + "</strong><div style='font-size:11.5px;color:var(--text-muted)'>" + escapeHtml(s.projectName) + "</div></td>" +
        "<td>" + escapeHtml(s.supplierName) + (s.supplierEmail ? "<div style='font-size:11.5px;color:var(--text-muted)'>" + escapeHtml(s.supplierEmail) + "</div>" : "") + (s.accessEmail ? "<div style='font-size:11.5px;color:var(--text-muted)'>Used: " + escapeHtml(s.accessEmail) + "</div>" : "") + "</td>" +
        "<td>" + statusPillHtml(s) + "</td>" +
        "<td style='font-family:var(--font-mono);font-size:12px;'>" + fmt(s.createdAt) + "</td>" +
        "<td style='font-family:var(--font-mono);font-size:12px;'>" + (s.status === "accessed" ? fmt(s.accessedAt) : "—") + "</td>" +
        "<td>" +
        '<button class="icon-btn" data-revoke="' + s.token + '" title="Revoke link" ' + (s.status !== "pending" ? "disabled style='opacity:.35;cursor:not-allowed;'" : "") + ">" + iconSvg("ban", 16) + "</button>" +
        "</td>" +
        "</tr>";
    }).join("");

    mount.querySelectorAll("[data-revoke]").forEach(function (btn) {
      btn.addEventListener("click", function () { revokeShare(btn.dataset.revoke); });
    });
  }

  function renderAll() {
    renderSidebar();
    renderBreadcrumb();
    renderBrowser();
    renderShares();
    renderFilterOptions();
  }

  // ---------- wire up page chrome ----------

  function init() {
    var tree = document.getElementById("project-tree");
    if (!tree) return; // not on projects.html

    var params = new URLSearchParams(location.search);
    var qProject = params.get("project");
    var qDept = params.get("dept");
    if (qProject) {
      nav.projectId = qProject;
      nav.deptId = qDept || null;
    }

    renderAll();

    // Pull latest access statuses from jsonblob on page load
    (async function syncStatuses() {
      if (!window.StatusSync) return;
      var blobId = window.StatusSync.getBlobId();
      if (!blobId) return;
      var updated = await window.StatusSync.syncToLocalShares(blobId, getShares, setShares);
      if (updated) renderShares();
    })();

    var newProjectBtn = document.getElementById("btn-new-project");
    if (newProjectBtn) newProjectBtn.addEventListener("click", function () { openCreateModal(); });

    var syncAllBtn = document.getElementById("btn-sync-drive");
    if (syncAllBtn) {
      syncAllBtn.addEventListener("click", function () {
        if (!window.DriveHub) { toast("Drive script not loaded"); return; }
        var cfg = window.DRIVE_CONFIG || {};
        if (!cfg.API_KEY || cfg.API_KEY.indexOf("PASTE_") === 0) {
          toast("Paste your API key into assets/drive-config.js first");
          return;
        }
        syncAllBtn.disabled = true;
        syncAllBtn.textContent = "Syncing…";
        window.DriveHub.syncFullDrive(function (msg) { toast(msg); console.log("[DriveSync]", msg); })
          .then(function (projects) {
            console.log("[DriveSync] projects returned:", JSON.stringify(projects, null, 2));
            console.log("[DriveSync] count:", projects.length);
            if (projects.length === 0) {
              toast("Sync returned 0 projects — check console (F12) for details");
              syncAllBtn.disabled = false;
              syncAllBtn.innerHTML = '<i class="ti ti-brand-google-drive"></i> Sync from Drive';
              return;
            }
            localStorage.setItem("hub_projects_v2", JSON.stringify(projects));
            console.log("[DriveSync] saved to hub_projects_v2, now re-rendering");
            renderAll();
            toast("Drive sync complete — " + projects.length + " project(s) loaded");
          })
          .catch(function (err) {
            toast("Sync failed: " + err.message);
          })
          .finally(function () {
            syncAllBtn.disabled = false;
            syncAllBtn.innerHTML = '<i class="ti ti-brand-google-drive"></i> Sync from Drive';
          });
      });
    }

    var shareBtn = document.getElementById("btn-share-folder");
    if (shareBtn) shareBtn.addEventListener("click", function () { openSharePicker(); });

    var searchInput = document.getElementById("browser-search");
    if (searchInput) searchInput.addEventListener("input", function () { renderBrowser(); });

    var filterBtn = document.getElementById("btn-filter");
    var filterPop = document.getElementById("filter-popover");
    if (filterBtn && filterPop) {
      filterBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        filterPop.classList.toggle("open");
      });
      document.addEventListener("click", function (e) {
        if (!filterPop.contains(e.target) && e.target !== filterBtn) filterPop.classList.remove("open");
      });
      var applyBtn = document.getElementById("filter-apply");
      var clearBtn = document.getElementById("filter-clear");
      if (applyBtn) applyBtn.addEventListener("click", applyFilter);
      if (clearBtn) clearBtn.addEventListener("click", clearFilter);
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  window.HUB = { getProjects: getProjects, getShares: getShares, openSharePicker: openSharePicker };
})();
