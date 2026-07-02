// Netlify serverless function — called by share.html when a supplier redeems a code.
// Stores the access record in Netlify Blobs so the admin portal can read it.
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { token, scopeName, supplierName, accessedAt, email } = body;

    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing token" }) };
    }

    const store = getStore("share-statuses");
    await store.setJSON(token, {
      token,
      status: "accessed",
      scopeName: scopeName || "",
      supplierName: supplierName || "",
      accessedAt: accessedAt || new Date().toISOString(),
      email: email || ""
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
