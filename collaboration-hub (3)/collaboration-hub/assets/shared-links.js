/* =========================================================
   Standalone "Shared links" admin page.
   Reads/writes the same hub_shares_v1 localStorage key that
   projects.js writes to when a folder/item is shared.
   ========================================================= */

(function () {
  "use strict";

  var LS_SHARES = "hub_shares_v1";

  function getShares() {
    try { return JSON.parse(localStorage.getItem(LS_SHARES) || "[]"); } catch (e) { return []; }
  }
  function setShares(s) { localStorage.setItem(LS_SHARES, JSON.stringify(s)); }

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
      check: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.6 2.6L16 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0;vertical-align:-2px;">' + (paths[type] || "") + "</svg>";
  }

  function fmt(dt) {
    if (!dt) return "—";
    var d = new Date(dt);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function statusPillHtml(s) {
    if (s.status === "accessed") return '<span class="dt-pill accessed">' + iconSvg("check", 11) + " Accessed</span>";
    if (s.status === "revoked") return '<span class="dt-pill revoked">' + iconSvg("ban", 11) + " Revoked</span>";
    return '<span class="dt-pill pending">' + iconSvg("clock", 11) + " Pending</span>";
  }

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

  function revokeShare(token) {
    if (!window.confirm("Revoke this link? The supplier's code will stop working immediately.")) return;
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

  function renderShares() {
    var mount = document.getElementById("shares-tbody");
    if (!mount) return;
    var shares = getShares();

    // Merge any cross-device status updates written by share.html
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

    var countEl = document.getElementById("shares-count");
    if (countEl) countEl.textContent = shares.length + (shares.length === 1 ? " link" : " links");

    var totalEl = document.getElementById("stat-total");
    var pendingEl = document.getElementById("stat-pending");
    var accessedEl = document.getElementById("stat-accessed");
    if (totalEl) totalEl.textContent = shares.length;
    if (pendingEl) pendingEl.textContent = shares.filter(function (s) { return s.status === "pending"; }).length;
    if (accessedEl) accessedEl.textContent = shares.filter(function (s) { return s.status === "accessed"; }).length;

    if (!shares.length) {
      mount.innerHTML = '<tr class="empty-row"><td colspan="6">No share links yet. Go to a project, open a department or item, and use its &#8942; menu (or the "Share a folder" button) to create one.</td></tr>';
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

  // Fetch Netlify form submissions and update share statuses cross-device
  async function syncFromNetlify() {
    try {
      var resp = await fetch("/.netlify/functions/get-statuses");
      if (!resp.ok) return;
      var statuses = await resp.json();
      var shares = getShares();
      var updated = false;

      statuses.forEach(function (s) {
        if (!s || !s.token) return;
        var idx = shares.findIndex(function (sh) { return sh.token === s.token; });
        if (idx > -1 && shares[idx].status !== "accessed") {
          shares[idx].status = "accessed";
          shares[idx].accessedAt = s.accessedAt || new Date().toISOString();
          if (s.email) shares[idx].accessEmail = s.email;
          updated = true;
        }
      });

      if (updated) { setShares(shares); renderShares(); }
    } catch(e) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("shares-tbody")) return;
    renderShares();
    syncFromNetlify(); // pull latest from Netlify on page load
    document.addEventListener("hub:shares-changed", renderShares);
  });
})();
