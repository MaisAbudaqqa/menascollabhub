// Floating AI assistant widget.
// Runs as a self-contained demo: it matches the question against this
// site's own data (files, deadlines, issues, contacts, scorecard, RFIs)
// and returns a grounded answer. No external API calls, so it always
// works offline and during a live presentation.

(function () {
  var KB = {
    deadlines: [
      { name: "Initial design review", owner: "Engineering", due: "2026-07-03", status: "on track" },
      { name: "Supplier quote submission", owner: "Supplier", due: "2026-07-10", status: "pending" },
      { name: "Prototype delivery", owner: "Supplier", due: "2026-07-22", status: "not started" },
      { name: "Final sign-off", owner: "Engineering", due: "2026-07-29", status: "not started" }
    ],
    issues: [
      { title: "Hole misalignment on bracket batch 14", severity: "high", supplier: "Acme Metalworks", status: "open", date: "2026-06-22" },
      { title: "Surface finish below spec on housing units", severity: "medium", supplier: "Delta Components", status: "in review", date: "2026-06-18" },
      { title: "Packaging label mismatch", severity: "low", supplier: "Acme Metalworks", status: "resolved", date: "2026-06-10" }
    ],
    suppliers: [
      { name: "Acme Metalworks", onTime: 88, defectRate: 2.1, response: "4 hrs", overall: "good" },
      { name: "Delta Components", onTime: 71, defectRate: 4.8, response: "11 hrs", overall: "fair" },
      { name: "Sterling Fab", onTime: 94, defectRate: 1.2, response: "2 hrs", overall: "good" }
    ],
    approvals: [
      { id: "ECN-0142", name: "Bracket redesign", stage: "Supplier review", status: "awaiting supplier" },
      { id: "ECN-0145", name: "Material substitution", stage: "Quality", status: "awaiting quality" },
      { id: "ECN-0139", name: "Fastener spec update", stage: "Final sign-off", status: "approved" }
    ],
    rfis: [
      { id: "RFI-2026-008", name: "CNC machining capability", due: "2026-07-08", respondedCount: 2, totalCount: 3 },
      { id: "RFI-2026-011", name: "Sustainable packaging options", due: "2026-07-20", respondedCount: 0, totalCount: 2 }
    ],
    contacts: [
      { role: "Engineering Lead", email: "engineering.lead@company.com" },
      { role: "Supplier Relations", email: "supplier.relations@company.com" },
      { role: "Project Manager", email: "project.manager@company.com" },
      { role: "IT Support", email: "it.support@company.com" }
    ],
    files: [
      "Assembly drawing - Rev C.pdf", "Tolerance specification.docx", "Material callouts.xlsx",
      "Incoming inspection report - Batch 14.pdf", "ISO certification.pdf",
      "PO-2026-0148.pdf", "PO-2026-0151.pdf", "Prototype test data - Supplier B.xlsx"
    ]
  };

  function answer(question) {
    var q = question.toLowerCase();

    if (/deadline|milestone|due|upcoming/.test(q)) {
      var next = KB.deadlines.filter(function (d) { return d.status !== "approved"; })[0];
      var list = KB.deadlines.map(function (d) {
        return d.name + " (" + d.owner + ") - due " + d.due + ", " + d.status;
      }).join("; ");
      return "The next upcoming item is \"" + next.name + "\", due " + next.due + " (" + next.status + "). Full list: " + list + ".";
    }

    if (/high severity|critical|urgent issue/.test(q)) {
      var high = KB.issues.filter(function (i) { return i.severity === "high"; });
      if (!high.length) return "No high severity issues are currently open.";
      return "Yes - \"" + high[0].title + "\" is open against " + high[0].supplier + ", raised " + high[0].date + ". It's currently marked " + high[0].status + ".";
    }

    if (/contact|reach|who.*talk|who.*contact|email/.test(q)) {
      return "Here's who to reach: " + KB.contacts.map(function (c) {
        return c.role + " (" + c.email + ")";
      }).join(", ") + ".";
    }

    if (/issue|defect|problem/.test(q)) {
      var open = KB.issues.filter(function (i) { return i.status !== "resolved"; });
      return "There are " + open.length + " open issues: " + open.map(function (i) {
        return i.title + " (" + i.severity + ", " + i.supplier + ")";
      }).join("; ") + ".";
    }

    if (/best supplier|top supplier|on-time|on time/.test(q)) {
      var best = KB.suppliers.slice().sort(function (a, b) { return b.onTime - a.onTime; })[0];
      return best.name + " has the best on-time delivery rate at " + best.onTime + "%, with a " + best.defectRate + "% defect rate and a " + best.response + " average response time.";
    }

    if (/scorecard|performance|defect rate/.test(q)) {
      return KB.suppliers.map(function (s) {
        return s.name + ": " + s.onTime + "% on-time, " + s.defectRate + "% defect rate (" + s.overall + ")";
      }).join("; ") + ".";
    }

    if (/approval|sign.?off|ecn/.test(q)) {
      var pending = KB.approvals.filter(function (a) { return a.status !== "approved"; });
      return "There are " + pending.length + " approvals in progress: " + pending.map(function (a) {
        return a.id + " (" + a.name + ") is waiting on " + a.stage;
      }).join("; ") + ".";
    }

    if (/rfi|information request|capability/.test(q)) {
      return KB.rfis.map(function (r) {
        return r.id + " (" + r.name + "), due " + r.due + " - " + r.respondedCount + " of " + r.totalCount + " suppliers have responded";
      }).join("; ") + ".";
    }

    if (/file|folder|document|drawing|spec/.test(q)) {
      return "The files & folders page has: " + KB.files.join(", ") + ".";
    }

    return "I can answer questions about files, deadlines, approvals, issues, the supplier scorecard, RFIs, and contacts. Try asking something like \"what deadlines are coming up?\" or \"which supplier has the best on-time rate?\"";
  }

  function buildFab() {
    var fab = document.createElement("button");
    fab.className = "ai-fab";
    fab.setAttribute("aria-label", "Open AI assistant");
    fab.innerHTML = '<i class="ti ti-message-chatbot" aria-hidden="true"></i><span class="ai-fab-badge"></span>';
    document.body.appendChild(fab);
    return fab;
  }

  function buildPanel() {
    var overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(16,24,38,0.35)";
    overlay.style.display = "none";
    overlay.style.alignItems = "flex-end";
    overlay.style.justifyContent = "flex-end";
    overlay.style.padding = "28px";
    overlay.style.zIndex = "50";
    overlay.id = "ai-overlay";

    overlay.innerHTML =
      '<div style="width:380px; max-width:92vw;" class="ai-shell">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--line);">' +
          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<i class="ti ti-sparkles" style="color:var(--coral-dark); font-size:17px;" aria-hidden="true"></i>' +
            '<span style="font-family:var(--font-display); font-size:14.5px;">Hub assistant</span>' +
          '</div>' +
          '<button id="ai-close" aria-label="Close" style="border:none; background:none; cursor:pointer; font-size:18px; color:var(--text-muted);"><i class="ti ti-x" aria-hidden="true"></i></button>' +
        '</div>' +
        '<div class="ai-messages" id="ai-messages">' +
          '<div class="ai-msg system">Ask me about files, deadlines, issues, suppliers, or contacts on this site.</div>' +
        '</div>' +
        '<div class="ai-suggestions">' +
          '<span class="ai-chip" data-q="What deadlines are coming up?">Upcoming deadlines</span>' +
          '<span class="ai-chip" data-q="Are there any high severity issues open?">Open issues</span>' +
          '<span class="ai-chip" data-q="Which supplier has the best on-time rate?">Best supplier</span>' +
        '</div>' +
        '<div class="ai-input-row">' +
          '<input id="ai-input" type="text" placeholder="Ask about files, deadlines, issues..." />' +
          '<button id="ai-send">Send</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    return overlay;
  }

  function appendMessage(container, role, text) {
    var div = document.createElement("div");
    div.className = "ai-msg " + role;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function init() {
    var fab = buildFab();
    var overlay = buildPanel();
    var messages = overlay.querySelector("#ai-messages");
    var input = overlay.querySelector("#ai-input");
    var sendBtn = overlay.querySelector("#ai-send");
    var closeBtn = overlay.querySelector("#ai-close");
    var busy = false;

    function open() { overlay.style.display = "flex"; input.focus(); }
    function close() { overlay.style.display = "none"; }

    fab.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    function send(text) {
      if (!text || busy) return;
      busy = true;
      sendBtn.disabled = true;
      appendMessage(messages, "user", text);
      input.value = "";

      var thinking = appendMessage(messages, "system", "Thinking...");
      setTimeout(function () {
        thinking.remove();
        appendMessage(messages, "assistant", answer(text));
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      }, 500 + Math.random() * 400);
    }

    sendBtn.addEventListener("click", function () { send(input.value.trim()); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send(input.value.trim());
    });
    overlay.querySelectorAll(".ai-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { send(chip.getAttribute("data-q")); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

