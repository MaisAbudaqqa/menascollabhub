// Google Drive connection settings.
// 1. Paste your API key below (from Google Cloud Console → Credentials)
// 2. Set ROOT_FOLDER_ID to the ID of your top-level Drive folder
// 3. For cross-device status tracking, add your Netlify token + form ID below

window.DRIVE_CONFIG = {
  CLIENT_ID: "PASTE_YOUR_CLIENT_ID_HERE",
  API_KEY: "PASTE_YOUR_API_KEY_HERE",
  ROOT_FOLDER_ID: "root",

  // -- Cross-device status tracking via Netlify Forms (optional but recommended) --
  // Step 1: Go to app.netlify.com → User Settings → Applications → Personal access tokens → New token
  // Step 2: Deploy the site once, then go to your site → Forms → "share-access" → copy the Form ID
  // Step 3: Paste both values here and redeploy
  NETLIFY_TOKEN: "",    // looks like: nfp_abc123...
  NETLIFY_FORM_ID: ""   // looks like: 6789abc...
};
