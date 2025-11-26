const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// --- Authentication and API Helpers ---
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    // Use interactive: false first to check silently
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        resolve(token); // Already logged in
      } else if (chrome.runtime.lastError?.message.includes('interactive')) {
         console.warn("Auth token requires user interaction (login).");
         reject(new Error("User interaction required for login."));
      } else {
        console.warn("Auth token not available:", chrome.runtime.lastError?.message);
        reject(chrome.runtime.lastError || new Error("Auth token not available."));
      }
    });
  });
}

async function fetchYouTubeAPI(endpoint) {
  try {
    const token = await getAuthToken();
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (!response.ok) {
       const errorBody = await response.text();
       console.error(`API call failed: ${response.status}`, endpoint, errorBody);
       throw new Error(`API call failed: ${response.status}`);
    }
    return response.json();
  } catch (error) {
     console.error(`Error during fetchYouTubeAPI for ${endpoint}:`, error);
     throw error;
  }
}

async function getSubscriptions() {
  let allSubscriptions = [];
  let nextPageToken = '';
  try {
      do {
        const data = await fetchYouTubeAPI(`subscriptions?part=snippet&mine=true&maxResults=50&pageToken=${nextPageToken}`);
        if (data && data.items) {
          allSubscriptions = allSubscriptions.concat(data.items);
          nextPageToken = data.nextPageToken;
        } else {
          nextPageToken = null;
        }
      } while (nextPageToken);
      console.log(`Fetched ${allSubscriptions.length} subscriptions`);
      return allSubscriptions;
  } catch (error) {
       console.error("Failed to fetch subscriptions:", error);
       throw error;
  }
}

async function getUserPlaylists() {
  let allPlaylists = [];
  let nextPageToken = '';
   try {
      do {
        const data = await fetchYouTubeAPI(`playlists?part=snippet&mine=true&maxResults=50&pageToken=${nextPageToken}`);
        if (data && data.items) {
          allPlaylists = allPlaylists.concat(data.items);
          nextPageToken = data.nextPageToken;
        } else {
          nextPageToken = null;
        }
      } while (nextPageToken);
      console.log(`Fetched ${allPlaylists.length} playlists`);
      return allPlaylists;
  } catch (error) {
       console.error("Failed to fetch playlists:", error);
       throw error;
  }
}

// --- RSS Parsing and Playlist Management ---
async function fetchAndParseRSS(url) {
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

        const result = await chrome.runtime.sendMessage({
            action: 'parseRSS',
            rssText: rssText
        });

        if (result && result.success) {
            // Success: returns an array of objects {id, published}
            return result.videoData; 
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
        const token = await getAuthToken();
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
             return false; // Not added (duplicate)
        }
        console.log(`Successfully added video ${videoId} to playlist ${playlistId}`);
        return true; // Added successfully
    } catch (error) {
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
        do {
            const data = await fetchYouTubeAPI(`playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=50&pageToken=${nextPageToken}`);
            if (data && data.items) {
                for (const item of data.items) {
                    if(item.contentDetails && item.contentDetails.videoId) {
                         videoIds.add(item.contentDetails.videoId);
                    }
                }
            } else {
                 console.warn("Received empty or invalid data fetching playlist items.", data);
            }
            nextPageToken = data ? data.nextPageToken : null;
        } while (nextPageToken);
        return videoIds; // Return the Set upon success

    } catch (error) {
         console.error(`Critical error fetching playlist items for ${playlistId}:`, error);
         return new Set(); // Return an EMPTY Set on error
    }
}

// --- Core Sync Logic ---

// Function for MANUAL sync (LATEST VIDEO ONLY)
// Uses getPlaylistVideoIds to check for duplication of the latest video.
async function runManualSync(channelsToSync) {
  console.log("Starting manual sync (latest video from each specified feed)...");
  let videosAddedCount = 0;
  const startTime = Date.now();

  const { playlistId } = await chrome.storage.sync.get('playlistId');

  if (!playlistId) {
      console.error('CRITICAL: Playlist ID is not saved in settings. Aborting manual sync.');
      return { success: false, error: 'Playlist ID not saved' };
  }
  if (!channelsToSync || channelsToSync.length === 0) {
      console.log('No channels provided for manual sync. Aborting.');
      return { success: true, videosAdded: 0 };
  }

  const rssFeedList = channelsToSync.map(id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  console.log(`Manual Sync: Checking ${rssFeedList.length} provided feeds for their latest video...`);

  try {
    const existingVideoIds = await getPlaylistVideoIds(playlistId);
    console.log(`Target playlist contains ${existingVideoIds.size} videos.`);
    const videosToAdd = new Set();

    for (const url of rssFeedList) {
        try {
            const videoData = await fetchAndParseRSS(url); // Returns {id, published} objects
            if (videoData.length > 0) {
                const latestVideoIdForChannel = videoData[0].id; // Get ID of the newest video
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
        const added = await addVideoToPlaylist(playlistId, videoId);
        if (added) videosAddedCount++;
    }
    console.log(`Manual sync finished. Added ${videosAddedCount} video(s).`);

    await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount } });
    return { success: true, videosAdded: videosAddedCount };

  } catch(error) {
      console.error("A critical error occurred during manual sync:", error);
       const errorMessage = error instanceof Error ? error.message : String(error);
       await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount, error: errorMessage } });
       return { success: false, error: errorMessage, videosAdded: videosAddedCount };
  }
}

// Function for AUTOMATIC sync (Time-based filtering)
async function runAutomaticSync() {
  console.log("Starting automatic sync (Time-based filtering)...");
  let videosAddedCount = 0;
  const startTime = Date.now();

   // Get SAVED settings and timestamp history
   const [{ playlistId, selectedChannels, syncFrequency }, { lastSyncTimes = {} }] = await Promise.all([
      chrome.storage.sync.get(['playlistId', 'selectedChannels', 'syncFrequency']),
      chrome.storage.local.get('lastSyncTimes') // Load history of last sync times
   ]);

   if (!syncFrequency || syncFrequency <= 0) {
        console.log("Automatic sync is disabled (frequency is 0 or unset). Skipping.");
        await chrome.alarms.clear('youtubeAutoSync');
        return;
   }
  if (!playlistId) { console.error('Auto Sync Error: Playlist ID not saved.'); return; }
  if (!selectedChannels || selectedChannels.length === 0) { console.log('Auto Sync: No channels saved to sync.'); return; }

  const channelIdsToSync = selectedChannels.map(ch => ch.id);
  console.log(`Auto Sync: Syncing ${channelIdsToSync.length} saved feeds to Playlist ID: ${playlistId}`);
  
  let newLastSyncTimes = { ...lastSyncTimes }; // Copy history to update later
  let videosToAdd = new Set(); // Set to collect unique video IDs to add

  try {
    for (const channelId of channelIdsToSync) {
        const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const lastTime = lastSyncTimes[channelId] || 0; // Gets 0 on first run
        let maxPublishedTimeForChannel = lastTime; // Track the newest time seen in this feed run

         try {
            const videoData = await fetchAndParseRSS(rssFeedUrl); // Returns {id, published}
            if (videoData.length === 0) continue;

            if (lastTime === 0) {
                // --- FIRST RUN FOR THIS CHANNEL (CRITICAL FIX) ---
                // Only sync the absolute latest video and set the timestamp to prevent syncing all history next time.
                const latestVideo = videoData[0];
                if (latestVideo) {
                    videosToAdd.add(latestVideo.id);
                    maxPublishedTimeForChannel = latestVideo.published; // Set new max time
                }
            } else {
                // --- SUBSEQUENT RUNS ---
                // Add any video published AFTER the last sync time
                for (const video of videoData) {
                     if (video.published > lastTime) {
                         videosToAdd.add(video.id);
                     }
                     if (video.published > maxPublishedTimeForChannel) {
                         maxPublishedTimeForChannel = video.published;
                     }
                }
            }
            // Update history for this channel
            newLastSyncTimes[channelId] = maxPublishedTimeForChannel;

         } catch (feedError) {
              console.error(`Auto Sync: Skipping channel ${channelId} due to error:`, feedError.message);
         }
         await new Promise(resolve => setTimeout(resolve, 100)); // Delay between channels
     } // End channel loop

      console.log(`Auto Sync: Found ${videosToAdd.size} unique new videos published since last check.`);

      for (const videoId of videosToAdd) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit adds
        const added = await addVideoToPlaylist(playlistId, videoId);
        if (added) videosAddedCount++;
      }

      console.log(`Auto sync finished. Added ${videosAddedCount} new video(s).`);
      
      await Promise.all([
        chrome.storage.local.set({ lastSyncTimes: newLastSyncTimes }), 
        chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount } })
      ]);

  } catch(error) {
      console.error("A critical error occurred during automatic sync:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await chrome.storage.local.set({ lastSyncStatus: { lastSyncTime: startTime, videosAdded: videosAddedCount, error: errorMessage } });
  }
}


// --- Alarm Setup ---
async function setupAlarm() {
    try {
        const { syncFrequency } = await chrome.storage.sync.get('syncFrequency');
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

   } else if (request.action === 'settingsUpdated') { // Triggered by Save Settings
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
            console.log("Reset Auth: No active token found or error occurred.");
             Promise.all([ chrome.storage.local.clear(), chrome.alarms.clear('youtubeAutoSync') ])
                .then(() => { console.log("Local storage and alarm cleared (no token found)."); sendResponse({ success: true, message: "No active token found, cleared local data." }); })
                .catch(err => { console.error("Error clearing data:", err); sendResponse({ success: false, error: "Failed to clear local data." }); });
            return;
        }
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
                           sendResponse({ success: true }); 
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
