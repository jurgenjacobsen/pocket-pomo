const completionChime = new Audio(chrome.runtime.getURL('assets/chime.mp3'));
completionChime.preload = 'auto';

function playCompletionChime(): void {
  completionChime.currentTime = 0;
  void completionChime.play().catch((error) => {
    console.debug('Unable to play completion chime:', error);
  });
}

chrome.runtime.onMessage.addListener((message: { action?: string }) => {
  if (message.action !== 'playCompletionChime') {
    return;
  }

  playCompletionChime();
});

export {};
