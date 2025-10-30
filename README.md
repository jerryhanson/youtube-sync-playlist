# youtube-sync-playlist
automatically or manually sync new videos from selected YouTube channels to a designated YouTube playlist

## 🚀 First-Time Setup Guide for YouTube Subscription Sync Extension

This guide will walk you through setting up the extension for the first time, including generating the necessary Google Cloud credentials.

-----

### Step 1: Prepare Your Extension Files

1.  **Download/Copy Files:** Make sure you have all the necessary extension files in a single folder on your computer. These are:
      * `manifest.json`
      * `popup.html`
      * `popup.js`
      * `background.js`
      * `offscreen.html`
      * `offscreen.js`
      * A subfolder named `images` containing `icon16.png`, `icon48.png`, `icon128.png` (you can use placeholder images initially).
2.  **Edit `manifest.json` (Placeholder):** Open `manifest.json` in a text editor. Find the `oauth2` section and ensure the `client_id` looks like this for now:
    ```json
    "oauth2": {
      "client_id": "YOUR_CLIENT_ID_GOES_HERE.apps.googleusercontent.com",
      "scopes": [
        "https://www.googleapis.com/auth/youtube"
      ]
    }
    ```

-----

### Step 2: Google Cloud Project Setup ☁️

You need to tell Google about your extension so it can securely access your YouTube data.

1.  **Go to Google Cloud Console:** Open [https://console.cloud.google.com/](https://console.cloud.google.com/) and log in with your Google account.
2.  **Create a New Project:**
      * Click the project dropdown menu at the top (it might say "Select a project").
      * Click "**New Project**".
      * Give your project a name (e.g., "YouTube Sync Extension Project") and click "**Create**". Wait for the project to be created. Make sure your new project is selected in the top dropdown.
3.  **Enable YouTube Data API v3:**
      * Click the navigation menu (☰) in the top-left corner.
      * Go to "**APIs & Services**" \> "**Library**".
      * Search for "**YouTube Data API v3**".
      * Click on it in the search results.
      * Click the blue "**Enable**" button. Wait for it to activate.
4.  **Configure OAuth Consent Screen:**
      * Click the navigation menu (☰) \> "**APIs & Services**" \> "**OAuth consent screen**".
      * Select "**External**" user type and click "**Create**".
      * Fill in the required fields:
          * **App name:** Give it a name (e.g., "My YouTube Sync").
          * **User support email:** Select your email address.
          * **Developer contact information:** Enter your email address.
      * Click "**Save and Continue**" through the "Scopes" and "Test users" sections (you don't need to add anything here).
      * On the "Summary" page, click "**Back to Dashboard**".
      * Click "**Publish App**" and confirm. The status should change to "**In production**". This is important to avoid user limits.
5.  **Create OAuth 2.0 Client ID:**
      * Go to "**APIs & Services**" \> "**Credentials**".
      * Click "**+ Create Credentials**" at the top and select "**OAuth client ID**".
      * **Application type:** Select "**Chrome App**".
      * **Name:** Give it a name (e.g., "YouTube Sync Extension Credential").
      * **Application ID:** Leave this **blank for now**. We need the Extension ID first.
      * Click "**Create**".
      * A window will pop up showing your **Client ID**. **Do not copy it yet**. We need to add the Extension ID first. Click "**OK**".

-----

### Step 3: Get Extension ID & Link to Client ID

1.  **Load the Extension (Temporarily):**
      * Open Chrome and go to `chrome://extensions`.
      * Turn on "**Developer mode**" using the toggle in the top-right corner.
      * Click "**Load unpacked**".
      * Select the folder containing your extension files.
      * Your extension will appear. Find its card and copy the **ID** (a long string of letters).
2.  **Add Extension ID to Client ID:**
      * Go back to the Google Cloud Console \> "**APIs & Services**" \> "**Credentials**".
      * Click the **pencil icon (✏️)** next to the Client ID you created.
      * Paste the **Extension ID** you just copied from Chrome into the "**Application ID**" field.
      * Click "**Save**".
3.  **Copy the Final Client ID:**
      * Now, on the Credentials page, copy the full **Client ID** value (it ends with `.apps.googleusercontent.com`).
4.  **Update `manifest.json`:**
      * Go back to your text editor and open `manifest.json`.
      * Replace `"YOUR_CLIENT_ID_GOES_HERE.apps.googleusercontent.com"` with the actual Client ID you just copied.
      * Save the `manifest.json` file.
5.  **Reload the Extension:**
      * Go back to `chrome://extensions`.
      * Click the **reload icon (🔄)** on your extension's card.

-----

### Step 4: Using the Extension for the First Time 🎉

1.  **Click the Icon:** Find the extension's icon in your Chrome toolbar and click it.
2.  **Login:**
      * Click the "**Login to YouTube / Check Auth**" button.
      * A Google sign-in window will pop up. Choose your account.
      * Google will ask for permission for the extension to "Manage your YouTube account". Click "**Allow**".
      * The popup button should now say "YouTube Login OK".
3.  **Load Playlists:**
      * Click the "**Load Playlists**" button.
      * Wait a moment for the dropdown menu below it to populate with your YouTube playlists.
      * Select the playlist you want to sync videos **to**.
4.  **Load Channels:** Choose one method:
      * **Option A (Recommended):** Click "**Load Subs (YT)**". This fetches all your current YouTube subscriptions automatically. The "Channels Loaded" display will update.
      * **Option B:** Click "**Load Subs (JSON)**". Select a `.json` file that contains a list of YouTube RSS feed URLs (exported previously or created manually). The "Channels Loaded" display will update.
5.  **Save Settings:**
      * Choose your desired **Auto Sync Frequency** (in minutes). Remember `0` disables automatic sync. 60+ minutes is recommended to avoid quota issues.
      * Click "**Save Settings & Update Auto Sync**". The blue status bar will update to show if auto-sync is enabled and when the next run is scheduled.
6.  **Run Manual Sync (Optional):**
      * Click "**Run Manual Sync Now**" to immediately sync the latest video from each currently loaded channel to your selected playlist.
      * Check the grey status bar below for progress/results.

Your extension is now set up\! It will sync automatically based on your chosen frequency, or you can trigger a manual sync anytime. You can also export the currently loaded channel list using the "Export" button.
