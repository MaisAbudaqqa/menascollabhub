// Cross-device share status sync using jsonblob.com
// Free, no account, no API key, CORS enabled.
// One blob stores all share statuses: { "TOKEN": { status, accessedAt, email } }
// The blob ID is stored in admin localStorage and embedded in every share URL.

window.StatusSync = (function () {
  var BLOB_URL = "https://jsonblob.com/api/jsonBlob";
  var LS_BLOB_ID = "hub_status_blob_id";

  function getBlobId() {
    return localStorage.getItem(LS_BLOB_ID) || "";
  }

  function setBlobId(id) {
    localStorage.setItem(LS_BLOB_ID, id);
  }

  // Create a new blob and return its ID
  async function createBlob() {
    var resp = await fetch(BLOB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({})
    });
    if (!resp.ok) throw new Error("Could not create status blob");
    // Blob ID is in the Location header: https://jsonblob.com/api/jsonBlob/ID
    var location = resp.headers.get("Location") || "";
    var id = location.split("/").pop();
    if (!id) throw new Error("No blob ID in response");
    return id;
  }

  // Get or create the blob ID for this site
  async function getOrCreateBlobId() {
    var id = getBlobId();
    if (id) return id;
    id = await createBlob();
    setBlobId(id);
    return id;
  }

  // Read all statuses from the blob
  async function fetchStatuses(blobId) {
    if (!blobId) return {};
    try {
      var resp = await fetch(BLOB_URL + "/" + blobId, {
        headers: { "Accept": "application/json" }
      });
      if (!resp.ok) return {};
      return await resp.json();
    } catch (e) { return {}; }
  }

  // Write a status update for one token to the blob
  async function markAccessed(blobId, token, scopeName, supplierName, email) {
    if (!blobId || !token) return;
    try {
      // Read current, merge, write back
      var current = await fetchStatuses(blobId);
      current[token] = {
        status: "accessed",
        accessedAt: new Date().toISOString(),
        scopeName: scopeName || "",
        supplierName: supplierName || "",
        email: email || ""
      };
      await fetch(BLOB_URL + "/" + blobId, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(current)
      });
    } catch (e) {}
  }

  // Sync statuses from blob into admin localStorage shares
  async function syncToLocalShares(blobId, getShares, setShares) {
    if (!blobId) return false;
    var statuses = await fetchStatuses(blobId);
    var keys = Object.keys(statuses);
    if (!keys.length) return false;
    var shares = getShares();
    var updated = false;
    keys.forEach(function (token) {
      var s = statuses[token];
      var idx = shares.findIndex(function (sh) { return sh.token === token; });
      if (idx > -1 && shares[idx].status !== "accessed") {
        shares[idx].status = "accessed";
        shares[idx].accessedAt = s.accessedAt || "";
        if (s.email) shares[idx].accessEmail = s.email;
        updated = true;
      }
    });
    if (updated) setShares(shares);
    return updated;
  }

  return {
    getOrCreateBlobId: getOrCreateBlobId,
    getBlobId: getBlobId,
    setBlobId: setBlobId,
    markAccessed: markAccessed,
    syncToLocalShares: syncToLocalShares
  };
})();
