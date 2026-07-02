// Netlify serverless function — called by the admin portal to get all access statuses.
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

  try {
    const store = getStore("share-statuses");
    const { blobs } = await store.list();

    const statuses = await Promise.all(
      blobs.map(async function (b) {
        try {
          return await store.get(b.key, { type: "json" });
        } catch (e) {
          return null;
        }
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(statuses.filter(Boolean))
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
