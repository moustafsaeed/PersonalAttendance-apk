window.generateFakeYearData = async function() {
  if(!confirm("هل أنت متأكد من توليد سجلات وهمية لمدة سنة كاملة (365 يوم)؟ سيتم دمجها مع السجلات الحالية.")) return;
  toast("جاري توليد البيانات...", "info");
  
  // Starting from Jan 1st of current year to Dec 31st
  let y = new Date().getFullYear();
  let startD = new Date(y, 0, 1);
  let endD = new Date(y, 11, 31);
  
  let recs = [];
  let d = new Date(startD);
  while(d <= endD) {
    let dayNum = d.getDay();
    let isWeekend = (dayNum === 5 || dayNum === 6); // Fri, Sat
    
    // YYYY-MM-DD
    let dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    
    if (isWeekend) {
      recs.push({
        id: 'fake_' + Date.now() + Math.random(),
        date: dateStr,
        state: 'custom',
        customText: 'إجازة أسبوعية',
        color: '#94a3b8'
      });
    } else {
      // 90% present, 5% absent, 5% late
      let rand = Math.random();
      if(rand < 0.85) {
        // Present
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          state: 'present',
          ci: '08:00',
          co: '16:00'
        });
      } else if (rand < 0.90) {
        // Late
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          state: 'present',
          ci: '08:30',
          co: '16:00'
        });
      } else if (rand < 0.95) {
        // Overtime
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          state: 'present',
          ci: '08:00',
          co: '18:00'
        });
      } else {
        // Absent
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          state: 'absent'
        });
      }
    }
    
    d.setDate(d.getDate() + 1);
  }
  
  // Add to DB
  let tx = db.transaction("recs", "readwrite");
  let store = tx.objectStore("recs");
  for(let i=0; i<recs.length; i++){
    store.put(recs[i]);
  }
  
  tx.oncomplete = function() {
    toast("تم توليد بيانات سنة كاملة بنجاح", "ok");
    renderRecords();
    renderHome();
  };
};
