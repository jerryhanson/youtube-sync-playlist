const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// --- Authentication and API Helpers ---
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    // Use interactive: false first to check silently
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        resolve(token); // Already logged in
      } else if (chrome.runtime.lastError?.message.includes('interactive')) {
         // This specific error means user interaction is needed, but we don't force it here
         console.warn("Auth token requires user interaction (login).");
         reject(new Error("User interaction required for login."));
      } else {
        // Other errors or no token silently
        console.warn("Auth token not available:", chrome.runtime.lastError?.message);
        reject(chrome.runtime.lastError || new Error("Auth token not available."));
      }
    });
  });
}

// Function to force interactive login (used by popup button)
async function forceGetAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error("Auth Error (Interactive):", chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
      } else {
        console.log("Interactive Auth Successful.");
        resolve(token);
      }
    });
  });
}


async function fetchYouTubeAPI(endpoint) {
  try {
    // Try to get token silently first for background operations
    const token = await getAuthToken().catch(async (silentError) => {
         // If silent fails *specifically* because interaction is needed,
         // AND this is likely an automatic sync, we should probably stop.
         // But for simplicity in manual calls from popup, let's assume getAuthToken
         // should generally succeed if the user *thinks* they are logged in.
         // A better approach might involve checking interactive:false first in the callers.
         console.warn("Silent token fetch failed, attempting interactive potentially:", silentError.message);
         // For now, let's just re-throw. The popup handles interactive login.
         throw silentError;
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (!response.ok) {
       const errorBody = await response.text();
       console.error(`API call failed: ${response.status}`, endpoint, errorBody);
        // Special handling for 401 Unauthorized might be needed if token expires
       if (response.status === 401) {
           console.warn("API call failed with 401 (Unauthorized). Token might be expired or invalid.");
           // Optionally try removing the cached token here?
           // chrome.identity.removeCachedAuthToken({ token: token }, () => {});
       }
       throw new Error(`API call failed: ${response.status}`);
    }
    return response.json();
  } catch (error) {
     // Catch errors from getAuthToken or fetch
     console.error(`Error during fetchYouTubeAPI for ${endpoint}:`, error);
     throw error; // Re-throw the error to be caught by the caller
  }
}

async function getSubscriptions() {
  let allSubscriptions = [];
  let nextPageToken = '';
  try {
      do {
        // Ensure endpoint includes `mine=true`
        const data = await fetchYouTubeAPI(`subscriptions?part=snippet&mine=true&maxResults=50&pageToken=${nextPageToken}`);
        if (data && data.items) {
          allSubscriptions = allSubscriptions.concat(data.items);
          nextPageToken = data.nextPageToken;
        } else {
          nextPageToken = null; // Exit loop if data is invalid
        }
      } while (nextPageToken);
      console.log(`Fetched ${allSubscriptions.length} subscriptions`);
      return allSubscriptions;
  } catch (error) {
       // Error is already logged in fetchYouTubeAPI
       console.error("Failed to fetch subscriptions.");
       throw error; // Propagate error
  }
}

async function getUserPlaylists() {
  let allPlaylists = [];
  let nextPageToken = '';
   try {
      do {
         // Ensure endpoint includes `mine=true`
        const data = await fetchYouTubeAPI(`playlists?part=snippet&mine=true&maxResults=50&pageToken=${nextPageToken}`);
        if (data && data.items) {
          allPlaylists = allPlaylists.concat(data.items);
          nextPageToken = data.nextPageToken;
        } else {
          nextPageToken = null; // Exit loop if data is invalid
        }
      } while (nextPageToken);
      console.log(`Fetched ${allPlaylists.length} playlists`);
      return allPlaylists;
  } catch (error) {
       // Error is already logged in fetchYouTubeAPI
       console.error("Failed to fetch playlists.");
       throw error; // Propagate error
  }
}

// --- RSS Parsing and Playlist Management ---
async function fetchAndParseRSS(url) {
    // console.log(`Fetching RSS feed text from: ${url}`); // Less verbose log
    let offscreenCreated = false;
    try {
        if (await chrome.offscreen.hasDocument?.()) {
            await chrome.offscreen.closeDocument();
        }
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['DOM_PARSER'],
            justification: 'To parse the XML from the RSS feed.',
        });
        offscreenCreated = true;

        const response = await fetch(url);
        if (!response.ok) {
             console.warn(`RSS fetch failed for ${url}: ${response.status}`);
            return [];
        }
        const rssText = await response.text();

        // Send to offscreen and wait for response
        const result = await chrome.runtime.sendMessage({
            action: 'parseRSS',
            rssText: rssText
        });

        if (result && result.success) {
            return result.videoIds; // These should be newest first from YouTube feed
        } else {
             throw new Error(result?.error || "Parsing failed in offscreen document.");
        }
    } catch (error) {
        console.error(`Failed to parse feed ${url}:`, error.message);
        return [];
    } finally {
         if (offscreenCreated && await chrome.offscreen.hasDocument?.()) {
             await chrome.offscreen.closeDocument();
         }
    }
}

async function addVideoToPlaylist(playlistId, videoId) {
    try {
        const token = await getAuthToken(); // Needs auth
        const response = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                snippet: {
                    playlistId: playlistId,
                    resourceId: { kind: 'youtube#video', videoId: videoId }
                }
            })
        });
        if (!response.ok && response.status !== 409) { // 409 = duplicate is ok
            const errorBody = await response.text();
            console.error(`Failed to add video ${videoId}: ${response.status}`, errorBody);
            return false;
        }
        if (response.status === 409) {
             // console.warn(`Video ${videoId} is already in the playlist.`); // Less verbose log
             return false; // Not added
        }
        console.log(`Successfully added video ${videoId} to playlist ${playlistId}`);
        return true; // Added successfully
    } catch (error) {
        // Catch auth errors or fetch errors
        console.error(`Error in addVideoToPlaylist for ${videoId}:`, error);
        return false; // Failed to add
    }
}


async function getPlaylistVideoIds(playlistId) {
    const videoIds = new Set();
    let nextPageToken = '';
    try {
        if (!playlistId) {
             console.error("getPlaylistVideoIds called with invalid playlistId:", playlistId);
             throw new Error("Invalid playlist ID provided.");
        }
        // console.log(`Fetching items for playlist: ${playlistId}`); // Less verbose log
        do {
            const data = await fetchYouTubeAPI(`playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50&pageToken=${nextPageToken}`);
            if (data && data.items) {
                for (const item of data.items) {
                    if(item.contentDetails && item.contentDetails.videoId) {
                         videoIds.add(item.contentDetails.videoId);
                    } else {
                         // console.warn("Playlist item missing contentDetails or videoId:", item); // Less verbose log
                    }
                }
            } else {
                 console.warn("Received empty or invalid data fetching playlist items.", data);
            }
            nextPageToken = data ? data.nextPageToken : null;
        } while (nextPageToken);
        // console.log(`Finished fetching items for ${playlistId}. Found ${videoIds.size} videos.`); // Less verbose log
        return videoIds; // Return the Set upon success

    } catch (error) {
         // Catch errors from fetchYouTubeAPI (which includes auth check)
         console.error(`Critical error fetching playlist items for ${playlistId}:`, error);
         return new Set(); // Return an EMPTY Set on error
    }
}

// --- Core Sync Logic ---

// Function for MANUAL sync (latest video from each specified feed)
async function runManualSync(channelIdsToSync) {
  console.log("Starting manual sync (latest video from each specified feed)...");
  let videosAddedCount = 0;
  const startTime = Date.now();

  const { playlistId } = await chrome.storage.sync.get('playlistId');

  if (!playlistId) {
      console.error('CRITICAL: Playlist ID is not saved in settings. Aborting manual sync.');
      return { success: false, error: 'Playlist ID not saved' };
  }
  if (!channelIdsToSync || channelIdsToSync.length === 0) {
      console.log('No channels provided for manual sync. Aborting.');
      return { success: true, videosAdded: 0 };
  }

  const rssFeedList = channelIdsToSync.map(id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  console.log(`Manual Sync: Checking ${rssFeedList.length} provided feeds for their latest video...`);

  try {
    const existingVideoIds = await getPlaylistVideoIds(playlistId); // Needs auth
    console.log(`Target playlist contains ${existingVideoIds.size} videos.`);
    const videosToAdd = new Set();

    for (const url of rssFeedList) {
        try {
            const videoIds = await fetchAndParseRSS(url); // Doesn't need auth
            if (videoIds.length > 0) {
                const latestVideoIdForChannel = videoIds[0];
                if (latestVideoIdForChannel && !existingVideoIds.has(latestVideoIdForChannel) && !videosToAdd.has(latestVideoIdForChannel)) {
                    videosToAdd.add(latestVideoIdForChannel);
                }
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        } catch (feedError) {
             console.error(`Skipping feed ${url} in manual sync due to error:`, feedError.message);
        }
    }
    console.log(`Manual Sync: Found ${videosToAdd.size} unique latest videos to add.`);

    for (const videoId of videosToAdd) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit adds
        const added = await addVideoToPlaylist(playlistId, videoId); // Needs auth
        if (added) videosAddedCount++;
    }
    console.log(`Manual sync finished. Added ${videosAddedCount} video(s).`);

    await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount } });
    return { success: true, videosAdded: videosAddedCount };

  } catch(error) {
      // Catch errors from getPlaylistVideoIds or addVideoToPlaylist (likely auth related)
      console.error("A critical error occurred during manual sync:", error);
       const errorMessage = error instanceof Error ? error.message : String(error);
       await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount, error: errorMessage } });
       return { success: false, error: errorMessage, videosAdded: videosAddedCount };
  }
}

// Function for AUTOMATIC sync (all new videos since first sync)
async function runAutomaticSync() {
  console.log("Starting automatic sync (all new videos)...");
  let videosAddedCount = 0;
  const startTime = Date.now();

   // Need settings and potentially first-sync history
   let settings;
   let syncHistory;
   try {
        [settings, syncHistory] = await Promise.all([
             chrome.storage.sync.get(['playlistId', 'selectedChannels', 'syncFrequency']),
             chrome.storage.local.get('syncedChannels')
        ]);
   } catch (storageError) {
        console.error("Auto Sync Error: Failed to load settings/history from storage.", storageError);
        return; // Cannot proceed without settings
   }

   const { playlistId, selectedChannels, syncFrequency } = settings;
   const { syncedChannels = {} } = syncHistory;

   // Check if auto-sync is enabled
   if (!syncFrequency || syncFrequency <= 0) {
        console.log("Automatic sync is disabled (frequency is 0 or unset). Skipping.");
        await chrome.alarms.clear('youtubeAutoSync');
        return;
   }
  if (!playlistId) { console.error('Auto Sync Error: Playlist ID not saved.'); return; }
  if (!selectedChannels || selectedChannels.length === 0) { console.log('Auto Sync: No channels saved to sync.'); return; }

  const channelIdsToSync = selectedChannels.map(ch => ch.id);
  console.log(`Auto Sync: Syncing ${channelIdsToSync.length} saved feeds to Playlist ID: ${playlistId}`);
  let newSyncedChannels = { ...syncedChannels };

  try {
    const existingVideoIds = await getPlaylistVideoIds(playlistId); // Needs auth
    console.log(`Auto Sync: Target playlist contains ${existingVideoIds.size} videos.`);
    const videosToAdd = new Set();

     for (const channelId of channelIdsToSync) {
        const isFirstSync = !syncedChannels[channelId];
        const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

         try {
            const rssVideoIds = await fetchAndParseRSS(rssFeedUrl); // Doesn't need auth
            if (rssVideoIds.length === 0) continue;

            if (isFirstSync) {
                const latestVideoId = rssVideoIds[0];
                if (latestVideoId && !existingVideoIds.has(latestVideoId)) {
                     videosToAdd.add(latestVideoId);
                }
                newSyncedChannels[channelId] = true; // Mark as synced
            } else {
                // Subsequent sync: add all missing videos from this feed
                for (const videoId of rssVideoIds) {
                     if (!existingVideoIds.has(videoId)) {
                         videosToAdd.add(videoId);
                     } else {
                          // Optional: Stop checking older videos for efficiency?
                          // break;
                     }
                }
            }
         } catch (feedError) {
              console.error(`Auto Sync: Skipping channel ${channelId} due to error:`, feedError.message);
         }
         await new Promise(resolve => setTimeout(resolve, 100)); // Delay between channels
     } // End channel loop

      console.log(`Auto Sync: Found ${videosToAdd.size} unique new videos across all feeds.`);

      // Add collected videos
      for (const videoId of videosToAdd) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit adds
        const added = await addVideoToPlaylist(playlistId, videoId); // Needs auth
        if (added) videosAddedCount++;
      }

      console.log(`Auto sync finished. Added ${videosAddedCount} new video(s).`);
      await Promise.all([
        chrome.storage.local.set({ syncedChannels: newSyncedChannels }),
        chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount } })
      ]);

  } catch(error) {
       // Catch errors from getPlaylistVideoIds or addVideoToPlaylist (likely auth related)
      console.error("A critical error occurred during automatic sync:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount, error: errorMessage } });
  }
}

// --- Alarm Setup ---
async function setupAlarm() {
    try {
        // Use default value here in case syncFrequency is undefined in storage
        const { syncFrequency = 60 } = await chrome.storage.sync.get('syncFrequency');
        await chrome.alarms.clear('youtubeAutoSync');

        if (syncFrequency && syncFrequency > 0) {
            chrome.alarms.create('youtubeAutoSync', {
                delayInMinutes: syncFrequency, // Start after the full interval
                periodInMinutes: syncFrequency
            });
            console.log(`Alarm created/updated. First run in ${syncFrequency} mins, then every ${syncFrequency} mins.`);
            return true;
        } else {
            console.log("Auto sync frequency is 0 or unset. Alarm cleared (disabled).");
            return false;
        }
    } catch (error) {
         console.error("Failed to setup alarm:", error);
         return false;
    }
}

// Set up alarm on install/startup
chrome.runtime.onInstalled.addListener(() => { console.log("onInstalled: Setting up alarm."); setupAlarm(); });
chrome.runtime.onStartup.addListener(() => {
     console.log("onStartup: Checking/Setting up alarm.");
      chrome.alarms.get('youtubeAutoSync', (alarm) => {
         if (!alarm) {
             console.log("Alarm not found on startup, setting up...");
             setupAlarm();
         } else {
              console.log("Alarm already exists.");
         }
     });
 });

// Listen for the alarm to run the AUTOMATIC sync
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'youtubeAutoSync') {
    console.log("Alarm triggered. Running automatic sync.");
    runAutomaticSync();
  }
});

// --- Message Listeners ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'getPlaylists') {
      getUserPlaylists()
        .then(playlists => sendResponse({ success: true, playlists: playlists }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // async

  } else if (request.action === 'getSubscriptions') {
      getSubscriptions()
        .then(subscriptions => sendResponse({ success: true, subscriptions: subscriptions }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // async

  } else if (request.action === 'runManualSyncNow') {
      runManualSync(request.channelsToSync).then(sendResponse);
      return true; // async

   } else if (request.action === 'settingsUpdated') {
      console.log("Settings updated message received. Re-creating alarm.");
      setupAlarm().then(alarmWasSet => {
          sendResponse({ success: true, alarmSet: alarmWasSet });
      }).catch(err => {
          console.error("Error during setupAlarm after settings update:", err);
          sendResponse({ success: false, error: err.message });
      });
      return true; // Indicate async response

  } else if (request.action === 'getLastSyncStatus') {
      chrome.storage.local.get('lastSyncStatus', (result) => {
          sendResponse(result.lastSyncStatus ? { success: true, ...result.lastSyncStatus } : { success: false });
      });
      return true; // async

  } else if (request.action === 'getAlarmStatus') {
       chrome.alarms.get('youtubeAutoSync', (alarm) => {
           sendResponse(alarm ? { success: true, alarmExists: true, nextRunTime: alarm.scheduledTime } : { success: true, alarmExists: false });
       });
       return true; // async

  } else if (request.action === 'resetAuth') {
    chrome.identity.getAuthToken({ 'interactive': false }, function(currentToken) {
        if (chrome.runtime.lastError || !currentToken) {
            console.log("Reset Auth: No active token found or error occurred.", chrome.runtime.lastError?.message);
            // Even if no token, clear storage/alarms
             Promise.all([
                 chrome.storage.local.clear(),
                 chrome.alarms.clear('youtubeAutoSync')
             ]).then(() => {
                  console.log("Local storage and alarm cleared after auth reset (no token found).");
                  sendResponse({ success: true, message: "No active token found, cleared local data." });
             }).catch(clearErr => {
                  console.error("Error clearing storage/alarm after reset (no token found):", clearErr);
                  sendResponse({ success: false, error: "Failed to clear local data." });
             });
            return;
        }
        // If token exists, revoke and clear cache
        fetch('https://accounts.google.com/o/oauth2/revoke?token=' + currentToken)
            .catch(err => console.warn("Revoke token fetch failed:", err))
            .finally(() => {
                 chrome.identity.removeCachedAuthToken({ 'token': currentToken }, () => {
                     console.log("Auth token cache cleared.");
                      Promise.all([
                           chrome.storage.local.clear(),
                           chrome.alarms.clear('youtubeAutoSync')
                      ]).then(() => {
                           console.log("Local storage and alarm cleared after auth reset.");
                           sendResponse({ success: true });
                      }).catch(clearErr => {
                           console.error("Error clearing storage/alarm after reset:", clearErr);
                           sendResponse({ success: true }); // Still report success for cache clear
                      });
                 });
            });
    });
    return true; // async response
  }

  // If no action matched
  console.warn("Unmatched message action:", request.action);
  return false;
});