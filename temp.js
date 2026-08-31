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
    
    // YYYY/MM/DD using slash format (app default)
    let dateStr = d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
    
    // Meta fields
    let yr = String(d.getFullYear());
    let ym = yr + '-' + String(d.getMonth()+1).padStart(2,'0');

    if (isWeekend) {
      recs.push({
        id: 'fake_' + Date.now() + Math.random(),
        date: dateStr,
        status: 'إجازة أسبوعية',
        color: '#94a3b8',
        yr: yr,
        ym: ym
      });
    } else {
      // 90% present, 5% absent, 5% late
      let rand = Math.random();
      if(rand < 0.85) {
        // Present
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          status: 'present',
          ci: '08:00',
          co: '16:00',
          yr: yr,
          ym: ym
        });
      } else if (rand < 0.90) {
        // Late
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          status: 'present',
          ci: '08:30',
          co: '16:00',
          yr: yr,
          ym: ym
        });
      } else if (rand < 0.95) {
        // Overtime
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          status: 'present',
          ci: '08:00',
          co: '18:00',
          yr: yr,
          ym: ym
        });
      } else {
        // Absent
        recs.push({
          id: 'fake_' + Date.now() + Math.random(),
          date: dateStr,
          status: 'absent',
          absenceType: 'بدون عذر',
          yr: yr,
          ym: ym
        });
      }
    }
    
    d.setDate(d.getDate() + 1);
  }
  
  // Add to DB using RECDB
  try {
     await RECDB.putAll(recs);
     toast("تم توليد بيانات سنة كاملة بنجاح", "ok");
     
     // Update cache if current month
     let nowD = new Date();
     _monthCache = await RECDB.getMonth(nowD.getFullYear(), nowD.getMonth());
     _monthCacheKey = `${nowD.getFullYear()}-${nowD.getMonth()}`;
     
     renderRecords();
     renderHome();
  } catch(err) {
     console.error(err);
     toast("حدث خطأ أثناء التوليد", "err");
  }
};
