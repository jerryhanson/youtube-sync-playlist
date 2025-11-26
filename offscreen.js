chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parseRSS') {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(request.rssText, "text/xml");

            const parserError = xmlDoc.querySelector("parsererror");
            if (parserError) {
                console.error("XML parsing error:", parserError.textContent);
                throw new Error("Invalid XML content in feed.");
            }

            const entries = xmlDoc.querySelectorAll("entry");
            let videoData = [];

            entries.forEach(entry => {
                const videoIdNode = entry.querySelector("videoId"); 
                const publishedNode = entry.querySelector("published");
                const alternateLinkNode = entry.querySelector("link[rel='alternate']"); // Use selector

                if (videoIdNode && publishedNode && alternateLinkNode) {
                    const videoId = videoIdNode.textContent;
                    const publishedTime = new Date(publishedNode.textContent).getTime();
                    const videoUrl = alternateLinkNode.getAttribute('href'); // Get the URL attribute

                    // --- QUOTA-FREE SHORTS FILTER ---
                    if (videoUrl && videoUrl.includes('/shorts/')) {
                        console.log(`[Parser] Skipping video ${videoId} (Detected as Short).`);
                        return; // Skip this entry
                    }
                    // --- END FILTER ---

                    if (videoId.length === 11 && !isNaN(publishedTime)) {
                        videoData.push({
                            id: videoId,
                            published: publishedTime
                        });
                    }
                }
            });

            const uniqueVideoData = videoData.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
            sendResponse({ success: true, videoData: uniqueVideoData });

        } catch (error) {
            console.error("Error parsing Atom Feed in offscreen document:", error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }
    return false;
});
