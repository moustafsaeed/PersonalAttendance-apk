window.saveVoiceSettings = function() {
  let el = document.getElementById('voiceFeedbackIn');
  if (el) {
    settings.voiceFeedback = el.value;
    saveSettings();
    toast(`<i class="fa-solid fa-check ml-1"></i> تم حفظ إعداد الصوت`, 'ok');
  }
};
