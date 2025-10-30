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

            // Works for Atom (<entry>, <yt:videoId>)
            const entries = xmlDoc.querySelectorAll("entry");
            let videoIds = [];

            if (entries.length > 0) {
                entries.forEach(entry => {
                    const videoIdNode = entry.querySelector("videoId"); // Note: No 'yt:' prefix needed
                    if (videoIdNode && videoIdNode.textContent && videoIdNode.textContent.length === 11) {
                        videoIds.push(videoIdNode.textContent);
                    } else {
                        const idNode = entry.querySelector("id");
                        if (idNode && idNode.textContent.includes('yt:video:')) {
                            const id = idNode.textContent.split(':').pop();
                             if (id && id.length === 11) videoIds.push(id);
                        }
                    }
                });
            } else {
                // Fallback for RSS (<item>, <link>)
                const items = xmlDoc.querySelectorAll("item");
                const videoIdRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
                items.forEach(item => {
                     const linkNode = item.querySelector("link");
                     if (linkNode) {
                         const match = linkNode.textContent.match(videoIdRegex);
                         if (match && match[1]) videoIds.push(match[1]);
                     } else {
                          const guidNode = item.querySelector("guid");
                          if(guidNode && guidNode.textContent.includes('yt:video:')) {
                               const guidId = guidNode.textContent.split(':').pop();
                               if (guidId && guidId.length === 11) videoIds.push(guidId);
                          }
                     }
                });
            }

            // Remove duplicates
            const uniqueVideoIds = [...new Set(videoIds)];
            sendResponse({ success: true, videoIds: uniqueVideoIds });

        } catch (error) {
            console.error("Error parsing Feed in offscreen document:", error);
            sendResponse({ success: false, error: error.message });
        }
        // Indicate that the response will be sent asynchronously
        return true;
    }
    // Handle other messages if needed
    return false;
});