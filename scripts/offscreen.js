const completionChime = new Audio(chrome.runtime.getURL('assets/chime.mp3'));
completionChime.preload = 'auto';
function playFileChime() {
    completionChime.currentTime = 0;
    void completionChime.play().catch((error) => {
        console.debug('Unable to play completion chime:', error);
    });
}
function playSynthesizedSound(type) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn('Web Audio API not supported in this context.');
            return;
        }
        const audioCtx = new AudioContextClass();
        const now = audioCtx.currentTime;
        if (type === 'digital') {
            // Short double beep
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now); // A5
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880, now + 0.18);
            gain2.gain.setValueAtTime(0.1, now + 0.18);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.start(now + 0.18);
            osc2.stop(now + 0.33);
        }
        else if (type === 'bell') {
            // Elegant crystal bell sound using frequency harmonics
            const frequencies = [523.25, 783.99, 1046.50, 1318.51]; // C5, G5, C6, E6
            const gains = [0.15, 0.08, 0.05, 0.03];
            frequencies.forEach((freq, index) => {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now);
                gainNode.gain.setValueAtTime(gains[index], now);
                // Exponential decay for ring-out
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5 - (index * 0.2));
                osc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1.5);
            });
        }
        else if (type === 'synth') {
            // Arpeggio chime: ascending pleasant sequence
            const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
            notes.forEach((freq, index) => {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + index * 0.12);
                gainNode.gain.setValueAtTime(0.08, now + index * 0.12);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * 0.12 + 0.4);
                osc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                osc.start(now + index * 0.12);
                osc.stop(now + index * 0.12 + 0.4);
            });
        }
    }
    catch (error) {
        console.debug('Failed to play synthesized sound:', error);
    }
}
chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== 'playCompletionChime') {
        return;
    }
    const type = message.chimeType || 'chime';
    if (type === 'chime') {
        playFileChime();
    }
    else {
        playSynthesizedSound(type);
    }
});
export {};
