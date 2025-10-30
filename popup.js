document.addEventListener('DOMContentLoaded', () => {
    // Get UI elements - Ensure all these are declared correctly
    const loginButton = document.getElementById('loginButton');
    const loadPlaylistsButton = document.getElementById('loadPlaylistsButton');
    const loadSubsButton = document.getElementById('loadSubsButton');
    const playlistSelect = document.getElementById('playlists');
    const channelCountDisplay = document.getElementById('channelCountDisplay');
    const importSubsButton = document.getElementById('importSubsButton');
    const exportSubsButton = document.getElementById('exportSubsButton');
    const syncFrequencyInput = document.getElementById('syncFrequency');
    const saveSettingsButton = document.getElementById('saveSettingsButton');
    const syncButton = document.getElementById('syncButton');
    const autoSyncStatusDiv = document.getElementById('autoSyncStatus');
    const statusDiv = document.getElementById('status');
    const resetAuthButton = document.getElementById('resetAuthButton');
    const fileInput = document.getElementById('fileInput');
    // ** Make sure this line exists and matches the ID in popup.html **
    const syncHistoryDiv = document.getElementById('syncHistory');

    let currentSelectedChannels = [];
    let savedPlaylistId = null;
    let savedPlaylistTitle = null;
    let isLoggedIn = false;

    // --- Load Initial State ---

    function loadInitialData() {
        checkInitialAuthStatus();
        loadSavedSettings();
        fetchAutoSyncStatus();
        fetchLastSyncStatus(); // Fetch history status on load
    }

    function checkInitialAuthStatus() {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (token) {
                isLoggedIn = true;
                loginButton.textContent = 'YouTube Login OK';
                loadPlaylistsButton.disabled = false;
                loadSubsButton.disabled = false;
            } else {
                isLoggedIn = false;
                loginButton.textContent = 'Login to YouTube / Check Auth';
                loadPlaylistsButton.disabled = true;
                loadSubsButton.disabled = true;
                 playlistSelect.innerHTML = '<option value="">Login first, then Load</option>';
            }
        });
    }


    function loadSavedSettings() {
        chrome.storage.sync.get(['playlistId', 'playlistTitle', 'selectedChannels', 'syncFrequency'], (result) => {
            savedPlaylistId = result.playlistId || null;
            savedPlaylistTitle = result.playlistTitle || null;
            if (result.selectedChannels && Array.isArray(result.selectedChannels)) {
                currentSelectedChannels = result.selectedChannels;
            } else {
                 // Compatibility check omitted for brevity, assuming correct format now
                 currentSelectedChannels = [];
            }
            updateChannelCountDisplay();
            syncFrequencyInput.value = result.syncFrequency !== undefined ? result.syncFrequency : "60";
            if (isLoggedIn) {
                 displaySavedPlaylist();
            }
        });
    }

    function displaySavedPlaylist() {
        if (!isLoggedIn) {
            playlistSelect.innerHTML = '<option value="">Login first, then Load</option>';
            return;
        }
        if (savedPlaylistId && savedPlaylistTitle) {
            let existingOption = playlistSelect.querySelector(`option[value="${savedPlaylistId}"]`);
            if (existingOption) {
                playlistSelect.value = savedPlaylistId;
            } else {
                playlistSelect.innerHTML = '';
                const option = document.createElement('option');
                option.value = savedPlaylistId;
                option.textContent = `${savedPlaylistTitle} (Saved)`;
                playlistSelect.appendChild(option);
                playlistSelect.value = savedPlaylistId;
            }
        } else {
            playlistSelect.innerHTML = '<option value="">Click \'Load Playlists\'</option>';
        }
    }


    function fetchAutoSyncStatus() {
         if (!isLoggedIn) {
            autoSyncStatusDiv.textContent = 'Login required to check auto-sync status.';
            autoSyncStatusDiv.style.backgroundColor = '#eeeeee'; autoSyncStatusDiv.style.borderColor = '#dddddd'; autoSyncStatusDiv.style.color = '#555555';
            return;
        }
        chrome.runtime.sendMessage({ action: 'getAlarmStatus' }, (response) => {
            if (chrome.runtime.lastError) {
                 console.warn("Could not get alarm status:", chrome.runtime.lastError.message);
                 autoSyncStatusDiv.textContent = 'Could not get auto-sync status.';
                 return;
            }
            if (response && response.alarmExists && response.nextRunTime) {
                 const nextRunDate = new Date(response.nextRunTime).toLocaleString();
                 autoSyncStatusDiv.textContent = `Auto-sync enabled. Next run: ${nextRunDate}`;
                 autoSyncStatusDiv.style.backgroundColor = '#e0f7fa'; autoSyncStatusDiv.style.borderColor = '#b2ebf2'; autoSyncStatusDiv.style.color = '#006064';
            } else {
                 autoSyncStatusDiv.textContent = 'Automatic sync is disabled.';
                 autoSyncStatusDiv.style.backgroundColor = '#eeeeee'; autoSyncStatusDiv.style.borderColor = '#dddddd'; autoSyncStatusDiv.style.color = '#555555';
            }
        });
    }

    // *** Ensure this function uses the correctly declared variable ***
    function fetchLastSyncStatus() {
        chrome.runtime.sendMessage({ action: 'getLastSyncStatus' }, (response) => {
            // Check runtime.lastError in case the background script isn't ready yet
            if (chrome.runtime.lastError) {
                console.warn("Could not get last sync status:", chrome.runtime.lastError.message);
                if (syncHistoryDiv) syncHistoryDiv.textContent = 'Last Sync: Error loading status'; // Check if div exists
                return;
            }
            // Check if syncHistoryDiv was found
            if (!syncHistoryDiv) {
                 console.error("syncHistoryDiv element not found in popup.html");
                 return;
            }
            if (response && response.success && response.lastSyncTime) {
                const date = new Date(response.lastSyncTime).toLocaleString();
                let statusText = `Last Sync: ${date} (Added ${response.videosAdded} videos)`;
                if (response.error) { // Append error if it exists
                     statusText += ` - Error: ${response.error}`;
                }
                syncHistoryDiv.textContent = statusText; // Set the text content
            } else {
                syncHistoryDiv.textContent = 'Last Sync: Never'; // Set default text
            }
        });
    }


    function updateChannelCountDisplay() {
        if(channelCountDisplay) channelCountDisplay.textContent = `${currentSelectedChannels.length} channels loaded`;
    }

    // --- Button Event Listeners ---
    // Ensure all elements exist before adding listeners

    if(loginButton) loginButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
        statusDiv.textContent = 'Attempting YouTube login...'; statusDiv.style.display = 'block';
        loginButton.disabled = true;
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            loginButton.disabled = false;
            if (token) {
                isLoggedIn = true;
                statusDiv.textContent = 'Login successful!';
                loginButton.textContent = 'YouTube Login OK';
                loadPlaylistsButton.disabled = false;
                loadSubsButton.disabled = false;
                loadSavedSettings(); // Reload settings which triggers displaySavedPlaylist
                fetchAutoSyncStatus();
            } else {
                isLoggedIn = false;
                statusDiv.textContent = `Login failed: ${chrome.runtime.lastError?.message || 'User cancelled or unknown error.'}`;
                loginButton.textContent = 'Login to YouTube / Check Auth';
                loadPlaylistsButton.disabled = true;
                loadSubsButton.disabled = true;
                playlistSelect.innerHTML = '<option value="">Login first, then Load</option>';
            }
             setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
        });
    });


    if(loadPlaylistsButton) loadPlaylistsButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
         if (!isLoggedIn) {
             statusDiv.textContent = 'Please login first.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 3000); return;
        }
        const currentlySelectedValue = playlistSelect.value;
        playlistSelect.innerHTML = '<option value="">Loading...</option>';
        loadPlaylistsButton.disabled = true;
        chrome.runtime.sendMessage({ action: 'getPlaylists' }, (response) => {
            loadPlaylistsButton.disabled = false;
            playlistSelect.innerHTML = '';
            if (response && response.success && response.playlists.length > 0) {
                let foundSaved = false;
                response.playlists.forEach(playlist => {
                    const option = document.createElement('option');
                    option.value = playlist.id;
                    option.textContent = playlist.snippet.title;
                    playlistSelect.appendChild(option);
                    if (playlist.id === savedPlaylistId) foundSaved = true;
                });
                if (foundSaved) playlistSelect.value = savedPlaylistId;
                else if (currentlySelectedValue && Array.from(playlistSelect.options).some(o=> o.value === currentlySelectedValue)) playlistSelect.value = currentlySelectedValue;
                else if (playlistSelect.options.length > 0) playlistSelect.selectedIndex = 0;
            } else {
                playlistSelect.innerHTML = '<option value="">Failed to load</option>';
                statusDiv.textContent = response?.error || 'Failed to load playlists.'; statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
                displaySavedPlaylist();
            }
        });
    });

    if(loadSubsButton) loadSubsButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
         if (!isLoggedIn) {
             statusDiv.textContent = 'Please login first.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 3000); return;
        }
        channelCountDisplay.textContent = 'Loading...';
        loadSubsButton.disabled = true;
        chrome.runtime.sendMessage({ action: 'getSubscriptions' }, (response) => {
            loadSubsButton.disabled = false;
            if (response && response.success) {
                const channelsFromYouTube = response.subscriptions.map(sub => ({
                     id: sub.snippet.resourceId.channelId,
                     name: sub.snippet.title
                }));
                const uniqueChannels = channelsFromYouTube.filter((channel, index, self) =>
                     index === self.findIndex((c) => (c.id === channel.id))
                 );
                currentSelectedChannels = uniqueChannels;
                updateChannelCountDisplay();
                statusDiv.textContent = `Loaded ${currentSelectedChannels.length} subscriptions. Save settings to keep.`; statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
            } else {
                updateChannelCountDisplay();
                statusDiv.textContent = response?.error || 'Failed to load subscriptions.'; statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
            }
        });
    });

    if(importSubsButton) importSubsButton.addEventListener('click', () => fileInput.click());

    if(fileInput) fileInput.addEventListener('change', (event) => {
       // ... (Keep this function exactly the same as before) ...
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!Array.isArray(importedData)) throw new Error('JSON is not an array.');
                const videoIdRegex = /channel_id=([a-zA-Z0-9_-]+)/;
                const channelsFromFile = importedData
                    .map(item => {
                        let id = null;
                        let name = "Unknown (Imported)";
                        if (typeof item === 'string') {
                            const match = item.match(videoIdRegex);
                            if (match) id = match[1];
                        } else if (typeof item === 'object' && item !== null && item.rssUrl) {
                             const match = String(item.rssUrl).match(videoIdRegex);
                             if (match) id = match[1];
                             if (item.channelName) name = item.channelName;
                        }
                        return id ? { id: id, name: name } : null;
                    })
                    .filter(channel => channel !== null)
                    .filter((channel, index, self) => index === self.findIndex((c) => c.id === channel.id));
                currentSelectedChannels = channelsFromFile;
                updateChannelCountDisplay();
                statusDiv.textContent = `Imported ${currentSelectedChannels.length} unique channels. Save settings to keep.`; statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
            } catch (error) {
                statusDiv.textContent = `Error: ${error.message}`; statusDiv.style.display = 'block';
                console.error('Error parsing JSON:', error);
                setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
            }
        };
        reader.readAsText(file);
        event.target.value = null;
    });

    if(exportSubsButton) exportSubsButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
        if (currentSelectedChannels.length === 0) {
            statusDiv.textContent = 'No channels loaded to export.'; statusDiv.style.display = 'block';
            setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
            return;
        }
        const jsonData = currentSelectedChannels.map(channel => ({
             channelName: channel.name,
             rssUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`
        }));
        const jsonString = JSON.stringify(jsonData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'youtube_channels_rss.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        statusDiv.textContent = `Exported ${currentSelectedChannels.length} channels with names.`; statusDiv.style.display = 'block';
        setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
    });

    if(saveSettingsButton) saveSettingsButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
         if (!isLoggedIn) {
             statusDiv.textContent = 'Please login before saving settings.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 3000); return;
        }
        const playlistId = playlistSelect.value;
        const frequency = parseInt(syncFrequencyInput.value, 10);
        const selectedOption = playlistSelect.options[playlistSelect.selectedIndex];
        const playlistTitle = selectedOption ? selectedOption.textContent.replace(' (Saved)', '') : null;
        if (!playlistId || playlistSelect.options.length === 0 || playlistSelect.options[0].textContent.includes('Click')) {
             statusDiv.textContent = 'Load and select a playlist before saving.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000); return;
        }
        if (isNaN(frequency) || frequency < 0) {
            statusDiv.textContent = 'Error: Sync frequency must be 0 (disabled) or a positive number.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000); return;
        }
        saveSettingsButton.disabled = true;
        autoSyncStatusDiv.textContent = "Updating auto-sync status...";
        autoSyncStatusDiv.style.backgroundColor = '#fff9c4'; autoSyncStatusDiv.style.borderColor = '#fff176'; autoSyncStatusDiv.style.color = '#795548';
        chrome.storage.sync.set({
            playlistId: playlistId, playlistTitle: playlistTitle,
            selectedChannels: currentSelectedChannels, syncFrequency: frequency
        }, () => {
            savedPlaylistId = playlistId; savedPlaylistTitle = playlistTitle;
            displaySavedPlaylist();
            chrome.runtime.sendMessage({ action: 'settingsUpdated' }, (response) => {
                 saveSettingsButton.disabled = false;
                 if (chrome.runtime.lastError || !(response && response.success)) {
                      console.error("Error receiving response from settingsUpdated:", chrome.runtime.lastError?.message || response?.error);
                      autoSyncStatusDiv.textContent = "Error updating auto-sync status."; autoSyncStatusDiv.style.backgroundColor = '#ffcdd2'; autoSyncStatusDiv.style.borderColor = '#ef9a9a'; autoSyncStatusDiv.style.color = '#b71c1c';
                 } else {
                      console.log("Background confirmed alarm update. Fetching new status.");
                      fetchAutoSyncStatus();
                 }
                 statusDiv.textContent = (response && response.success) ? "Settings Saved." : "Save Error."; statusDiv.style.display = 'block';
                 setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 3000);
            });
        });
    });


    if(syncButton) syncButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
         if (!isLoggedIn) {
             statusDiv.textContent = 'Please login before syncing.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 3000); return;
        }
        const playlistId = playlistSelect.value;
        const selectedOption = playlistSelect.options[playlistSelect.selectedIndex];
        const playlistTitle = selectedOption ? selectedOption.textContent.replace(' (Saved)', '') : null;
        if (!playlistId || playlistSelect.options.length === 0 || playlistSelect.options[0].textContent.includes('Click')) {
            statusDiv.textContent = 'Error: Load and select a playlist first.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000); return;
        }
        if (currentSelectedChannels.length === 0) {
             statusDiv.textContent = 'Error: Load/Import channels before syncing.'; statusDiv.style.display = 'block'; setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000); return;
        }
        chrome.storage.sync.set({ playlistId: playlistId, playlistTitle: playlistTitle }, () => {
            savedPlaylistId = playlistId; savedPlaylistTitle = playlistTitle;
            const channelIdsToSync = currentSelectedChannels.map(ch => ch.id);
            statusDiv.textContent = `Starting manual sync for ${channelIdsToSync.length} channels...`; statusDiv.style.display = 'block';
            [syncButton, importSubsButton, exportSubsButton, loadSubsButton, loadPlaylistsButton, resetAuthButton, saveSettingsButton].forEach(btn => btn.disabled = true);
            chrome.runtime.sendMessage({ action: 'runManualSyncNow', channelsToSync: channelIdsToSync }, (response) => {
                 [syncButton, importSubsButton, exportSubsButton, loadSubsButton, loadPlaylistsButton, resetAuthButton, saveSettingsButton].forEach(btn => btn.disabled = false);
                 if(response && response.success) {
                      statusDiv.textContent = `Manual Sync finished! Added ${response.videosAdded} videos.`;
                      fetchLastSyncStatus(); // Refresh history
                 } else {
                      statusDiv.textContent = `Manual Sync failed: ${response?.error || 'Unknown error'}. Check console.`;
                 }
                  displaySavedPlaylist();
                 setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 7000);
            });
        });
    });

    if(resetAuthButton) resetAuthButton.addEventListener('click', () => {
        // ... (Keep this function exactly the same as before) ...
        statusDiv.textContent = 'Resetting authentication...'; statusDiv.style.display = 'block';
        resetAuthButton.disabled = true;
        chrome.runtime.sendMessage({ action: 'resetAuth' }, (response) => {
            resetAuthButton.disabled = false;
            statusDiv.textContent = response.success ? 'Reset complete! Close and reopen popup.' : 'Reset failed.';
            playlistSelect.innerHTML = '<option value="">Login first, then Load</option>';
            currentSelectedChannels = [];
            savedPlaylistId = null; savedPlaylistTitle = null;
            isLoggedIn = false;
            updateChannelCountDisplay();
            syncHistoryDiv.textContent = 'Last Sync: Never';
            fetchAutoSyncStatus(); // Show disabled status
            loadPlaylistsButton.disabled = true;
            loadSubsButton.disabled = true;
            loginButton.textContent = 'Login to YouTube / Check Auth';
             setTimeout(() => { statusDiv.textContent = ''; statusDiv.style.display = 'none'; }, 5000);
        });
    });

    // --- Initialize ---
    loadInitialData();
});