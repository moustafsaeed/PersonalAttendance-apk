window.playActionVoice = function(type) {
  // Always play the beep first if setting is not "none"
  let voiceSetting = settings.voiceFeedback || 'none';
  if (voiceSetting === 'none') return;
  
  // Play Fingerprint beep
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch(e) {}
  
  // Text to speech
  if ('speechSynthesis' in window) {
    let text = type === 'in' ? "تَمَّ بَصْمَةُ الدُّخُول" : "تَمَّ بَصْمَةُ الْخُرُوج";
    let msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'ar-SA';
    // Modify pitch based on gender
    if (voiceSetting === 'male') {
      msg.pitch = 0.6;
      msg.rate = 0.9;
    } else {
      msg.pitch = 1.3;
      msg.rate = 1.0;
    }
    
    // Optional: Try to find a matching voice if possible
    let voices = window.speechSynthesis.getVoices();
    if(voices.length > 0) {
       // Just a best effort to find an Arabic voice, browser might not support gender specific
       let arVoices = voices.filter(v => v.lang.startsWith('ar'));
       if(arVoices.length > 0) msg.voice = arVoices[0];
    }
    
    window.speechSynthesis.speak(msg);
  }
};
