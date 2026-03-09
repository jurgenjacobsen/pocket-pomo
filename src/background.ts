chrome.runtime.onMessage.addListener(
  (
    message: { action: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown>) => void,
  ): boolean | undefined => {
    if (message.action === 'getStorage') {
      chrome.storage.sync.get(null, sendResponse);
      return true;
    }
    return undefined;
  },
);