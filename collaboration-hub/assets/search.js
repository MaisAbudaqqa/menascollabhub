/* =========================================================
   Global "Search the hub" box.
   Lives in the topbar on every page. It does two things:
   1. Looks up matching projects / departments / items (shared
      data layer in localStorage) and lets you jump straight to
      them, from any page.
   2. On pages with a plain table or list (Deadlines, Contacts,
      RFIs, Announcements), it also live-filters the rows on
      that page so you can narrow down what's visible.
   ========================================================= */

(function () {
  "use strict";

  var LS_PROJECTS = "hub_projects_v2";

  function getProjects() {
    try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]"); } catch (e) { return []; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function folderIconHtml(px) {
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0;display:inline-block;vertical-align:middle;">' +
      '<path d="M4 5.5C4 4.67 4.67 4 5.5 4h4.4c.34 0 .67.13.92.37L12.4 6H18.5c.83 0 1.5.67 1.5 1.5v1H4z" fill="#f5a623"/>' +
      '<rect x="3" y="7.2" width="18" height="12.3" rx="2.2" fill="#ffce32"/>' +
      "</svg>";
  }

  function fileIconHtml(px) {
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0;display:inline-block;vertical-align:middle;">' +
      '<path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 20V4A1.5 1.5 0 0 1 5.5 2.5z" fill="#cfd6e0"/>' +
      '<path d="M14 2.5v3.5a1 1 0 0 0 1 1h3.5" fill="none" stroke="#fff" stroke-width="0.6"/>' +
      "</svg>";
  }

  // ---------- build a flat searchable index of projects/departments/items ----------

  function buildIndex() {
    var projects = getProjects();
    var index = [];
    projects.forEach(function (p) {
      index.push({ type: "project", label: p.name, projectId: p.id, sub: "Project" });
      (p.departments || []).forEach(function (d) {
        index.push({ type: "department", label: d.name, projectId: p.id, deptId: d.id, sub: p.name });
        (d.items || []).forEach(function (it) {
          index.push({ type: "item", label: it.name, projectId: p.id, deptId: d.id, sub: p.name + " / " + d.name });
        });
      });
    });
    return index;
  }

  function matches(haystack, needle) {
    return haystack.toLowerCase().indexOf(needle) !== -1;
  }

  function goTo(entry) {
    var url = "projects.html?project=" + encodeURIComponent(entry.projectId);
    if (entry.deptId) url += "&dept=" + encodeURIComponent(entry.deptId);
    location.href = url;
  }

  // ---------- in-page row/list filtering (deadlines, contacts, rfis, announcements...) ----------

  function filterPageContent(query) {
    var rows = document.querySelectorAll(".panel-body table.dt tbody tr");
    rows.forEach(function (row) {
      var text = row.textContent.toLowerCase();
      row.style.display = !query || text.indexOf(query) !== -1 ? "" : "none";
    });

    var cards = document.querySelectorAll(".panel-body .announcement");
    cards.forEach(function (card) {
      var text = card.textContent.toLowerCase();
      card.style.display = !query || text.indexOf(query) !== -1 ? "" : "none";
    });
  }

  // ---------- dropdown UI ----------

  function init() {
    var box = document.querySelector(".topbar-search");
    if (!box) return;
    var input = box.querySelector("input");
    if (!input) return;

    box.style.position = "relative";

    var dropdown = document.createElement("div");
    dropdown.className = "hub-search-dropdown";
    dropdown.style.display = "none";
    box.appendChild(dropdown);

    function renderDropdown(query) {
      if (!query) { dropdown.style.display = "none"; return; }
      var index = buildIndex();
      var hits = index.filter(function (e) { return matches(e.label, query); }).slice(0, 8);

      filterPageContent(query);

      if (!hits.length) {
        dropdown.innerHTML = '<div class="hub-search-empty">No projects, departments, or items match "' + escapeHtml(query) + '".</div>';
        dropdown.style.display = "block";
        return;
      }

      dropdown.innerHTML = hits.map(function (e, i) {
        var icon = e.type === "item" ? fileIconHtml(15) : folderIconHtml(15);
        return '<button type="button" class="hub-search-row" data-i="' + i + '">' +
          icon +
          '<span class="hub-search-text"><span class="hub-search-label">' + escapeHtml(e.label) + '</span>' +
          '<span class="hub-search-sub">' + escapeHtml(e.sub) + "</span></span>" +
          "</button>";
      }).join("");
      dropdown.style.display = "block";

      Array.prototype.forEach.call(dropdown.querySelectorAll(".hub-search-row"), function (btn, i) {
        btn.addEventListener("click", function () { goTo(hits[i]); });
      });
    }

    input.addEventListener("input", function () { renderDropdown(input.value.trim().toLowerCase()); });
    input.addEventListener("focus", function () { if (input.value.trim()) renderDropdown(input.value.trim().toLowerCase()); });

    document.addEventListener("click", function (e) {
      if (!box.contains(e.target)) dropdown.style.display = "none";
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; filterPageContent(""); dropdown.style.display = "none"; }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
