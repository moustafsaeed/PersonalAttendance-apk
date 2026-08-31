// Persistent Storage Check
(async function initAppPersistence(){
  try {
    if(navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persisted();
      if(!persisted) await navigator.storage.persist();
    }
  } catch(e){}
})();
// ── Constants & State ──────────────────────────────────────
var DEFAULT_SETTINGS={
  name:``,workDays:[0,1,2,3,4,6],baseStart:`08:00`,baseEnd:`16:00`,baseOvertimeStart:``,
  autoBackup:true, cloudAutoSync:false,
  backupInterval:'daily', backupTime:'00:00', backupDay:0, backupDate:1, lastBackupDate:'',
  daySchedules:{},schedules:[],alertOffset:15,
  absenceType: '',
  note: '',
  absenceTypes:[``,`إجازة سنوية`,`إجازة طارئة`,`بدون عذر`,`مهمة رسمية`],
  customStatuses:[`إضافي`,`مغادرة مبكرة`,`إجازة مدفوعة`,`إجازة غير مدفوعة`,`عمل عن بعد`,`تكليف سفر`,`إجازة من الإضافي`],
  holidays:[],dark:false,themeColor:'blue',timeFormat:'hhmm',
  noteFont: 'Amiri', customFonts: [],
  enableBiometric: false,
  compensations: [],
  travelAssignments: [],
  exportColumns: { date:true, day:true, checkIn:true, checkOut:true, status:true, late:true, early:true, overtime:true, absenceType:true, note:true },
  reportHeaders: [],
  reportFooters: [],
  activeHeaderId: "",
  activeFooterId: ""
};
var DB_KEYS={S:`pa_s`,R:`pa_r`};
var DAYS=[`الأحد`,`الاثنين`,`الثلاثاء`,`الأربعاء`,`الخميس`,`الجمعة`,`السبت`];
var MONTHS=[`يناير`,`فبراير`,`مارس`,`أبريل`,`مايو`,`يونيو`,`يوليو`,`أغسطس`,`سبتمبر`,`أكتوبر`,`نوفمبر`,`ديسمبر`];
var settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), records = [], viewYear, viewMonth, calYear, calMonth, periodMode=`current`;
var monthSummary={p:0,a:0,l:0},timerHandle=null,clockInterval=null,chartInstances={};
var todayDay=new Date().getDate(),alertedToday=false,initDate=new Date();
var googleUser = null; // Stores current Google session user info
var CACHED_CLOUD_USER = null; // Instant bootstrap cache
try {
   let c = localStorage.getItem('PA_CLOUD_CACHE');
   if(c) CACHED_CLOUD_USER = JSON.parse(c);
} catch(e) {}

viewYear=initDate.getFullYear(); viewMonth=initDate.getMonth();
calYear=viewYear; calMonth=viewMonth;

// ── Error tracking ────────────────────────────────────────
var _appErrors=[];
function trackError(src,msg,detail){
  _appErrors.push({src,msg:msg?.toString?.()||msg,detail:detail?.toString?.()||'',time:new Date().toISOString()});
  if(_appErrors.length>50)_appErrors.shift();
  try{IDB.set('pa_errors',_appErrors);}catch(e){}
}

// ── Undo system ──────────────────────────────────────────
var _undoAction=null,_undoTimeout=null;
function showUndoable(message,doUndo){
  _undoAction=doUndo;
  if(_undoTimeout)clearTimeout(_undoTimeout);
  toast(message+` <button onclick="performUndo()" style="color:#60a5fa;font-weight:900;margin-right:6px">تراجع</button>`,`ok`);
  _undoTimeout=setTimeout(()=>{_undoAction=null;_undoTimeout=null;},8000);
}
window.performUndo=function(){if(_undoAction){_undoAction();_undoAction=null;if(_undoTimeout)clearTimeout(_undoTimeout);_undoTimeout=null;}};

// ── App Folder & Path Config ───────────────────────────────
var APP_FOLDER   = `Personal Attendance`;
var BACKUP_FOLDER= `Personal Attendance/Backup`;

// ── Utility: get status color (Theme Aware) ───────────────
function stClr(type){
  if(type===`p`) return (settings && settings.themeColor===`green`)?`#10b981` : `#3b82f6`;
  if(type===`a`) return `#ef4444`; 
  if(type===`l`) return `#f59e0b`;
  if(type===`o`) return (settings && settings.themeColor===`green`) ? `#10b981` : `#3b82f6`;
  return `#64748b`;
}

// ── Utility: get status badge HTML (Distinct Modern Colors) ─
window.getStatusBadgeHTML = function(status, rawLate = 0, isLateComp = false) {
  if (status === 'absent') {
    return `<span class="status-badge status-badge-absent"><i class="fa-solid fa-circle-xmark"></i><span>غائب</span></span>`;
  }
  if (status === 'إجازة رسمية' || status === 'إجازة' || status === 'عطلة') {
    return `<span class="status-badge status-badge-holiday"><i class="fa-solid fa-umbrella-beach"></i><span>إجازة رسمية</span></span>`;
  }
  if (status === 'تكليف سفر') {
    return `<span class="status-badge status-badge-travel"><i class="fa-solid fa-plane-departure"></i><span>تكليف سفر (حاضر)</span></span>`;
  }
  if (status === 'عمل عن بعد') {
    return `<span class="status-badge status-badge-custom"><i class="fa-solid fa-laptop-house"></i><span>عمل عن بعد</span></span>`;
  }
  if (status === 'إجازة من الإضافي') {
    return `<span class="status-badge status-badge-compensated"><i class="fa-solid fa-calendar-check"></i><span>إجازة من الإضافي</span></span>`;
  }
  
  if (isPresent(status)) {
    if (status && status !== 'present' && settings && settings.customStatuses && settings.customStatuses.includes(status)) {
      return `<span class="status-badge status-badge-custom"><i class="fa-solid fa-tag"></i><span>${esc(status)}</span></span>`;
    }
    return `<span class="status-badge status-badge-present"><i class="fa-solid fa-circle-check"></i><span>حاضر</span></span>`;
  }
  
  return `<span class="status-badge status-badge-custom"><i class="fa-solid fa-tag"></i><span>${esc(status)}</span></span>`;
};

// ── Utility: escape HTML (XSS prevention) ─────────────────
function esc(s){
  if(s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Utility: UUID v4 (unique record IDs) ──────────────────
function uuid(){return`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g,c=>{let r=Math.random()*16|0;return(c===`x`?r:(r&0x3|0x8)).toString(16)});}

// ── Utility: safe filename (no overwrite) ─────────────────
// Returns a unique filename like "file.pdf", "file(1).pdf", "file(2).pdf"...
async function uniqueFilePath(basePath, baseDir){
  if(!window.Capacitor||!window.Capacitor.Plugins.Filesystem) return basePath;
  let ext=``, name=basePath;
  let dot=basePath.lastIndexOf(`.`);
  if(dot>-1){ ext=basePath.slice(dot); name=basePath.slice(0,dot); }
  let candidate=basePath, i=1;
  while(true){
    try{
      await window.Capacitor.Plugins.Filesystem.stat({path:candidate,directory:baseDir});
      candidate=`${name}(${i})${ext}`; i++;
    } catch(e){ break; }
  }
  return candidate;
}

// ── Utility: ensure folder exists ────────────────────────
async function ensureDir(path, dir){
  if(!window.Capacitor||!window.Capacitor.Plugins.Filesystem) return;
  try{ await window.Capacitor.Plugins.Filesystem.mkdir({path,directory:dir,recursive:true}); }
  catch(e){ /* already exists */ }
}

// ── Utility: request storage permission ──────────────────
async function requestStoragePermission(){
  if(!window.Capacitor||!window.Capacitor.Plugins.Filesystem) return true;
  try{
    let perm=await window.Capacitor.Plugins.Filesystem.requestPermissions();
    return perm&&(perm.publicStorage==='granted'||perm.publicStorage==='prompt');
  } catch(e){ return true; }
}

function normalizeSlashDate(d){
  if(!d||typeof d!==`string`) return `00/00/0000`;
  let s=d.trim().split(`/`).map(Number);
  if(s.length!==3||isNaN(s[0])||isNaN(s[1])||isNaN(s[2])) return d;
  if(s[0]>1000){
    // YYYY/MM/DD -> DD/MM/YYYY
    return `${String(s[2]).padStart(2,'0')}/${String(s[1]).padStart(2,'0')}/${s[0]}`;
  }
  // DD/MM/YYYY
  return `${String(s[0]).padStart(2,'0')}/${String(s[1]).padStart(2,'0')}/${s[2]}`;
}

function slashToISO(d){
  if(!d||typeof d!==`string`) return `0000-00-00`;
  let norm = normalizeSlashDate(d);
  let t=norm.split(`/`).map(Number);
  if(t.length<3||isNaN(t[0])||isNaN(t[1])||isNaN(t[2])) return `0000-00-00`;
  return `${t[2]}-${String(t[1]).padStart(2,`0`)}-${String(t[0]).padStart(2,`0`)}`;
}

function isoToSlash(d){
  if(!d||typeof d!==`string`) return `00/00/0000`;
  let t=d.trim().split(`-`).map(Number);
  if(t.length<3||isNaN(t[0])||isNaN(t[1])||isNaN(t[2])) return `00/00/0000`;
  return `${String(t[2]).padStart(2,'0')}/${String(t[1]).padStart(2,'0')}/${t[0]}`;
}

function makeDateKey(y,m,d){
  return `${String(d).padStart(2,'0')}/${String(m+1).padStart(2,'0')}/${y}`;
}
function fmt12(t){if(!t||typeof t!==`string`||t===`---`||!t.includes(`:`))return t||`---`;let[h,m]=t.split(`:`).map(Number),p=h>=12?`مساءً`:`صباحاً`,hh=h%12||12;return`${String(hh).padStart(2,`0`)}:${String(m).padStart(2,`0`)} ${p}`}
function nowHHMM(){let d=new Date;return`${String(d.getHours()).padStart(2,`0`)}:${String(d.getMinutes()).padStart(2,`0`)}`}
function isPresent(s){return s!==`absent` && s!==`إجازة رسمية` && s!==`إجازة` && s!==`إجازة من الإضافي`}
function isTravel(s){return s===`تكليف سفر`}
function isOTLeave(s){return s===`إجازة من الإضافي`}
function formatMin(v){
  if(!v||v<=0)return settings.timeFormat===`mins`?`0 د`:settings.timeFormat===`text`?`0 د`:`00:00`;
  let h=Math.floor(v/60),m=Math.floor(v%60);
  if(settings.timeFormat===`mins`) return `${Math.floor(v)} د`;
  if(settings.timeFormat===`text`) return (h>0?`${h} س `:'') + (m>0||h===0?`${m} د`:'').trim();
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function getSchedule(y,m,dayObj=null){
  let key=`${y}-${String(m+1).padStart(2,`0`)}`,sch={start:settings.baseStart||`08:00`,end:settings.baseEnd||`16:00`,overtimeStart:settings.baseOvertimeStart||``,label:`دوام عادي`};
  let found=settings.schedules.find(s=>s.key===key);
  if(!found){let prev=settings.schedules.filter(s=>s.key<=key).sort((a,b)=>b.key.localeCompare(a.key));if(prev.length)found=prev[0];}
  if(found){sch={...found};}
  if(dayObj&&settings.daySchedules&&settings.daySchedules[dayObj.getDay()])
    {
      let ds = settings.daySchedules[dayObj.getDay()];
      sch.start=ds.start||sch.start;
      sch.end=ds.end||sch.end;
      sch.overtimeStart=ds.overtimeStart||sch.overtimeStart;
      sch.label=`توقيت يوم `+DAYS[dayObj.getDay()];
    }
  // Default overtimeStart to end if still empty
  if(!sch.overtimeStart) sch.overtimeStart = sch.end;
  return sch;
}
function isWorkDay(d){ if(!d || typeof d.getDay !== "function") return false; return (settings && Array.isArray(settings.workDays)) ? settings.workDays.includes(d.getDay()) : false; }
var _holidayMap = new Map();
function updateHolidayCache(){
  _holidayMap.clear();
  if(settings && Array.isArray(settings.holidays)){
    settings.holidays.forEach(h => { if(h && h.date) _holidayMap.set(h.date, h.label || 'إجازة رسمية'); });
  }
}
function isHoliday(d){
  if(!d || typeof d.getFullYear !== "function" || isNaN(d.getTime())) return false;
  let k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,`0`)}-${String(d.getDate()).padStart(2,`0`)}`;
  return _holidayMap.has(k);
}
function getHolidayLabel(d){
  if(!d || typeof d.getFullYear !== "function" || isNaN(d.getTime())) return `إجازة رسمية`;
  let k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,`0`)}-${String(d.getDate()).padStart(2,`0`)}`;
  return _holidayMap.get(k) || `إجازة رسمية`;
}

function lateMin(ci,s){
  if(!ci||!s||typeof ci!==`string`||typeof s!==`string`)return 0;
  let[h,m]=ci.split(`:`).map(Number),[hs,ms]=s.split(`:`).map(Number);
  let v=h*60+m-(hs*60+ms);
  if(v < -720) v += 1440; // Handle cross-midnight (e.g. check-in at 00:30 for 23:00 shift)
  return v>0?v:0;
}
function earlyMin(co,e){
  if(!co||!e||typeof co!==`string`||typeof e!==`string`)return 0;
  let[h,m]=co.split(`:`).map(Number),[he,me]=e.split(`:`).map(Number);
  let v=he*60+me-(h*60+m);
  if(v < -720) v += 1440; // Handle cross-midnight end times
  return v>0?v:0;
}

function hasOvertime(r) {
  if(!r || !r.status || !isPresent(r.status) || !r.checkOut || !r.date) return false;
  let d = new Date(slashToISO(r.date)), sch = getSchedule(d.getFullYear(), d.getMonth(), d);
  let isHol = isHoliday(d) || !isWorkDay(d);
  if (isHol && r.checkIn && r.checkOut) {
    let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, em] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
    let extra = (eh*60+em) - (sh*60+sm);
    if (extra < 0) extra += 1440;
    return extra > 0;
  }
  return extraMin(r.checkOut, sch.overtimeStart) > 0;
}
function extraMin(co,e){
  if(!co||!e||typeof co!==`string`||typeof e!==`string`)return 0;
  let[h,m]=co.split(`:`).map(Number),[he,me]=e.split(`:`).map(Number);
  let v=h*60+m-(he*60+me);
  if(v < -720) v += 1440; // Handle cross-midnight extra hours
  return v>0?v:0;
}
// findRecord and todayKey remain here as stubs; real findRecord is defined after RECDB
function todayKey(){return makeDateKey(new Date().getFullYear(),new Date().getMonth(),new Date().getDate());}

// ── IndexedDB & Fallback Storage ─────────────────────────────────────────────
// v6.0: Upgraded to DB version 2 with dedicated high-performance records store.
// The 'records' object store uses 'date' as keyPath and has two indexes:
//   - 'ym_idx': year-month composite string (e.g. '2026-06') for fast monthly queries.
//   - 'year_idx': year string for annual stats without full table scan.
var IDB={db:null,
  init(){return new Promise(res=>{
    try{
      let r=indexedDB.open(`PA_BigStorage`,2);
      r.onupgradeneeded=e=>{
        let db=e.target.result;
        // Always ensure legacy key-value store exists
        if(!db.objectStoreNames.contains(`store`)) db.createObjectStore(`store`);
        // New high-performance records store (v2)
        if(!db.objectStoreNames.contains(`records`)){
          let rs=db.createObjectStore(`records`,{keyPath:`date`});
          rs.createIndex(`ym_idx`,`ym`,{unique:false});
          rs.createIndex(`year_idx`,`yr`,{unique:false});
        }
      };
      r.onsuccess=e=>{IDB.db=e.target.result;res()};
      r.onerror=()=>res();
    }catch(e){res();}
  })},
  get(k){return new Promise(res=>{
    let fallback = null; try { fallback = JSON.parse(localStorage.getItem(k)); } catch(e){}
    if(!IDB.db) return res(fallback);
    try{ let r=IDB.db.transaction(`store`).objectStore(`store`).get(k); r.onsuccess=()=>res(r.result||fallback); r.onerror=()=>res(fallback); }catch(e){res(fallback);}
  })},
  set(k,v){return new Promise(res=>{
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} // Mirror to localStorage
    if(!IDB.db) return res();
    try{ let r=IDB.db.transaction(`store`,`readwrite`).objectStore(`store`).put(v,k); r.onsuccess=res; r.onerror=res; }catch(e){res();}
  })},
  clear(){return new Promise(res=>{
    try{
      localStorage.removeItem(DB_KEYS.S);
      localStorage.removeItem(DB_KEYS.R);
      localStorage.removeItem('pa_errors');
      localStorage.removeItem('pa_install_meta');
      localStorage.removeItem('pa_activation_status');
    }catch(e){}
    if(!IDB.db) return res();
    // Clear both stores
    try{ IDB.db.transaction([`store`,`records`],`readwrite`).objectStore(`records`).clear(); }catch(e){}
    try{ let r=IDB.db.transaction(`store`,`readwrite`).objectStore(`store`).clear(); r.onsuccess=res; r.onerror=res; }catch(e){res();}
  })}
};

// ── RECDB: High-Performance Records Store API ────────────────────────────────
// All reads go directly to IndexedDB by index — no full array scan in memory.
var RECDB={
  _getLSFallback(){
    try {
      let d = JSON.parse(localStorage.getItem('pa_r_records_fallback') || '[]');
      return Array.isArray(d) ? d : [];
    } catch(e){ return []; }
  },
  _setLSFallback(list){
    try { localStorage.setItem('pa_r_records_fallback', JSON.stringify(list)); } catch(e){}
  },
  // Compute the 'ym' and 'yr' fields from a date string 'DD/MM/YYYY'
  _meta(date){
    if(!date||typeof date!==`string`) return {};
    let p=normalizeSlashDate(date).split('/'); if(p.length!==3) return {};
    let yr=p[2], ym=`${p[2]}-${String(p[1]).padStart(2,'0')}`;
    return {ym,yr};
  },
  // Add index fields to a record before storing
  _stamp(rec){
    if(rec&&rec.date) rec.date = normalizeSlashDate(rec.date);
    let m=RECDB._meta(rec ? rec.date : '');
    return Object.assign({},rec,m);
  },
  // Put (insert or update) a single record
  put(rec){return new Promise(res=>{
    if(!rec) return res();
    let s=RECDB._stamp(rec);
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      let idx = list.findIndex(r => r.date === s.date);
      if(idx >= 0) list[idx] = s; else list.push(s);
      RECDB._setLSFallback(list);
      return res();
    }
    try{
      let r=IDB.db.transaction(`records`,`readwrite`).objectStore(`records`).put(s);
      r.onsuccess=res; r.onerror=res;
    }catch(e){
      let list = RECDB._getLSFallback();
      let idx = list.findIndex(r => r.date === s.date);
      if(idx >= 0) list[idx] = s; else list.push(s);
      RECDB._setLSFallback(list);
      res();
    }
  })},
  // Get a single record by exact date string 'DD/MM/YYYY'
  get(date){return new Promise(res=>{
    if(!date) return res(null);
    let norm = normalizeSlashDate(date);
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      let r = list.find(x => x.date === norm || x.date === date);
      return res(r || null);
    }
    try{
      let r=IDB.db.transaction(`records`).objectStore(`records`).get(norm);
      r.onsuccess=()=>{
        if(r.result) return res(r.result);
        if(date !== norm) {
          try {
            let r2 = IDB.db.transaction(`records`).objectStore(`records`).get(date);
            r2.onsuccess=()=>res(r2.result||null);
            r2.onerror=()=>res(null);
          }catch(e2){res(null);}
        } else {
          res(null);
        }
      }; 
      r.onerror=()=>{
        let list = RECDB._getLSFallback();
        let fallback = list.find(x => x.date === norm || x.date === date);
        res(fallback || null);
      };
    }catch(e){
      let list = RECDB._getLSFallback();
      let fallback = list.find(x => x.date === norm || x.date === date);
      res(fallback || null);
    }
  })},
  // Get all records for a specific month: year (number), month 0-indexed
  getMonth(year,month){return new Promise(res=>{
    let ym=`${year}-${String(month+1).padStart(2,'0')}`;
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      return res(list.filter(r => r.ym === ym || (RECDB._meta(r.date).ym === ym)));
    }
    try{
      let tx=IDB.db.transaction(`records`).objectStore(`records`).index(`ym_idx`);
      let r=tx.getAll(ym);
      r.onsuccess=()=>res(r.result||[]); r.onerror=()=>{
        let list = RECDB._getLSFallback();
        res(list.filter(item => item.ym === ym || (RECDB._meta(item.date).ym === ym)));
      };
    }catch(e){
      let list = RECDB._getLSFallback();
      res(list.filter(item => item.ym === ym || (RECDB._meta(item.date).ym === ym)));
    }
  })},
  // Get all records for a specific year
  getYear(year){return new Promise(res=>{
    let yrStr = String(year);
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      return res(list.filter(r => r.yr === yrStr || (RECDB._meta(r.date).yr === yrStr)));
    }
    try{
      let tx=IDB.db.transaction(`records`).objectStore(`records`).index(`year_idx`);
      let r=tx.getAll(yrStr);
      r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]);
    }catch(e){res([]);}
  })},
  // Get all records in a date range (ISO strings 'YYYY-MM-DD' for comparison)
  getRange(startISO,endISO){return new Promise(res=>{
    let s=Number(startISO.replace(/-/g,'')), e2=Number(endISO.replace(/-/g,''));
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      return res(list.filter(r => {
        let n = Number(slashToISO(r.date).replace(/-/g, ''));
        return n >= s && n <= e2;
      }));
    }
    try{
      let results=[];
      let r=IDB.db.transaction(`records`).objectStore(`records`).openCursor();
      r.onsuccess=ev=>{
        let cursor=ev.target.result;
        if(!cursor){res(results);return;}
        let n=Number(slashToISO(cursor.key).replace(/-/g,''));
        if(n>=s && n<=e2) results.push(cursor.value);
        cursor.continue();
      };
      r.onerror=()=>res(results);
    }catch(e){res([]);}
  })},
  // Delete a record by date
  del(date){return new Promise(res=>{
    if(!date) return res();
    let norm = normalizeSlashDate(date);
    let list = RECDB._getLSFallback();
    RECDB._setLSFallback(list.filter(r => r.date !== norm && r.date !== date));
    if(!IDB.db) return res();
    try{
      let tx=IDB.db.transaction(`records`,`readwrite`);
      let os=tx.objectStore(`records`);
      os.delete(norm);
      if(date !== norm) os.delete(date);
      tx.oncomplete=res; tx.onerror=res;
    }catch(e){res();}
  })},
  // Count all records
  count(){return new Promise(res=>{
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      return res(list.length);
    }
    try{
      let r=IDB.db.transaction(`records`).objectStore(`records`).count();
      r.onsuccess=()=>res(r.result||0); r.onerror=()=>res(0);
    }catch(e){res(0);}
  })},
  // Get all records (for backup/export purposes only)
  getAll(){return new Promise(res=>{
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      return res(list);
    }
    try{
      let r=IDB.db.transaction(`records`).objectStore(`records`).getAll();
      r.onsuccess=()=>res(r.result||[]); r.onerror=()=>{
        res(RECDB._getLSFallback());
      };
    }catch(e){res(RECDB._getLSFallback());}
  })},
  // Bulk put array of records (for restore/import)
  putAll(recs){return new Promise(res=>{
    if(!recs||!recs.length) return res();
    let stamped = recs.map(rec=>RECDB._stamp(rec));
    if(!IDB.db){
      let list = RECDB._getLSFallback();
      let map = new Map();
      list.forEach(r => map.set(r.date, r));
      stamped.forEach(r => map.set(r.date, r));
      RECDB._setLSFallback(Array.from(map.values()));
      return res();
    }
    try{
      let tx=IDB.db.transaction(`records`,`readwrite`);
      let os=tx.objectStore(`records`);
      stamped.forEach(rec=>os.put(rec));
      tx.oncomplete=res; tx.onerror=res;
    }catch(e){
      let list = RECDB._getLSFallback();
      let map = new Map();
      list.forEach(r => map.set(r.date, r));
      stamped.forEach(r => map.set(r.date, r));
      RECDB._setLSFallback(Array.from(map.values()));
      res();
    }
  })},
  // Clear all records
  clearAll(){return new Promise(res=>{
    RECDB._setLSFallback([]);
    if(!IDB.db) return res();
    try{
      let r=IDB.db.transaction(`records`,`readwrite`).objectStore(`records`).clear();
      r.onsuccess=res; r.onerror=res;
    }catch(e){res();}
  })}
};

// ── Load / Save ──────────────────────────────────────────────────────────────
// v6.0: loadData migrates legacy flat array from 'pa_r' into the new
// high-performance RECDB store, then works purely from RECDB going forward.
async function loadData(){
  await IDB.init();
  let s=await IDB.get(DB_KEYS.S);
  
  settings=s||{...DEFAULT_SETTINGS};
  settings.daySchedules=settings.daySchedules||{};
  settings.baseStart=settings.baseStart||`08:00`;
  settings.baseEnd=settings.baseEnd||`16:00`;
  settings.baseOvertimeStart=settings.baseOvertimeStart||``;
  settings.autoBackup=settings.autoBackup!==false;
  settings.cloudAutoSync=!!settings.cloudAutoSync;
  settings.exportColumns=settings.exportColumns||JSON.parse(JSON.stringify(DEFAULT_SETTINGS.exportColumns));
  settings.alertOffset=settings.alertOffset===undefined?15:settings.alertOffset;
  settings.lastAbsenceFill=settings.lastAbsenceFill||'';
  settings.backupInterval=settings.backupInterval||'daily';
  settings.backupTime=settings.backupTime||'00:00';
  settings.backupDay=settings.backupDay||0;
  settings.backupDate=settings.backupDate||1;
  settings.timeFormat=settings.timeFormat||'hhmm';
  settings.enableBiometric=!!settings.enableBiometric;
  settings.compensations=settings.compensations||[];
  settings.travelAssignments=settings.travelAssignments||[];
  settings.reportHeaders=settings.reportHeaders||[];
  settings.reportFooters=settings.reportFooters||[];
  settings.activeHeaderId=settings.activeHeaderId||"";
  settings.activeFooterId=settings.activeFooterId||"";

  // Sanitize absenceTypes: Ensure "إجازة رسمية" is not treated as an absence type
  if(settings.absenceTypes && Array.isArray(settings.absenceTypes)) {
    settings.absenceTypes = settings.absenceTypes.filter(t => t !== 'إجازة رسمية');
  }

  // ── Migration: Move legacy flat array (pa_r) → new RECDB store ──
  // Only runs once per install; after migration pa_r is cleared.
  let needsMigration = !settings._recdbMigrated;
  if(needsMigration){
    let rawRecs = await IDB.get(DB_KEYS.R) || [];
    if(rawRecs && rawRecs.length > 0){
      let seenDates = new Set();
      let validRecs = [];
      rawRecs.forEach(rc => {
        if (!rc || typeof rc !== 'object' || !rc.date) return;
        // Normalize date
        let parts = rc.date.split('/');
        if (parts.length === 3) {
          let [dd, mm, yy] = parts.map(Number);
          if (yy < 100 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) {
            if (Number(parts[0]) > 1000) rc.date = makeDateKey(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
          } else {
            let normal = makeDateKey(yy, mm-1, dd);
            if (rc.date !== normal) rc.date = normal;
          }
        }
        if (!rc.id) rc.id = uuid();
        if (!rc.status) rc.status = 'absent';
        // De-duplicate: keep the record with checkIn
        if (seenDates.has(rc.date)) {
          let ei = validRecs.findIndex(v => v.date === rc.date);
          if (rc.checkIn && !validRecs[ei].checkIn) validRecs[ei] = rc;
          return;
        }
        validRecs.push(rc);
        seenDates.add(rc.date);
      });
      await RECDB.putAll(validRecs);
      console.log(`[RECDB] Migrated ${validRecs.length} records from legacy store.`);
    }
    // Clear legacy store and mark migration done
    try{ localStorage.removeItem(DB_KEYS.R); }catch(e){}
    settings._recdbMigrated = true;
    await IDB.set(DB_KEYS.S, settings);
  }

  // After migration, keep a small in-memory cache only for the current day
  // for functions that call findRecord(todayKey()) synchronously.
  let todayRec = await RECDB.get(todayKey());
  records = todayRec ? [todayRec] : []; // Minimal bootstrap cache (today only)

  // Data Sanitizer & Auto-Repair Routine (normalizes all dates in RECDB and syncs compensations)
  try {
    let allExisting = await RECDB.getAll();
    if (allExisting && allExisting.length > 0) {
      let seen = new Map();
      let toDel = [];
      let toPut = [];
      
      for (let r of allExisting) {
        if (!r || !r.date) continue;
        let oldDate = r.date;
        let normDate = normalizeSlashDate(oldDate);
        
        if (oldDate !== normDate) {
          toDel.push(oldDate);
          r.date = normDate;
        }
        
        if (seen.has(normDate)) {
          let prev = seen.get(normDate);
          if (r.checkIn && !prev.checkIn) {
            seen.set(normDate, r);
            toPut.push(r);
          } else if (r.status === 'إجازة من الإضافي' || r.status === 'تكليف سفر') {
            seen.set(normDate, r);
            toPut.push(r);
          }
        } else {
          seen.set(normDate, r);
          if (oldDate !== normDate) {
            toPut.push(r);
          }
        }
      }
      
      for (let d of toDel) await RECDB.del(d);
      if (toPut.length > 0) await RECDB.putAll(toPut);
    }
    
    if (settings.compensations && settings.compensations.length > 0) {
      settings.compensations.forEach(c => {
        if (c.date) c.date = normalizeSlashDate(c.date);
        if (c.sourceDate) c.sourceDate = normalizeSlashDate(c.sourceDate);
        if (Array.isArray(c.sourceDetails)) {
          c.sourceDetails.forEach(sd => {
            if (sd.date) sd.date = normalizeSlashDate(sd.date);
          });
        }
      });
    }
  } catch(e) {
    console.error('Data sanitization error:', e);
  }

  // Also cache current month for renderHome month stats
  let now = new Date();
  _monthCache = await RECDB.getMonth(now.getFullYear(), now.getMonth());
  _monthCacheKey = `${now.getFullYear()}-${now.getMonth()}`;

  if(settings.dark) document.documentElement.classList.add(`dark`);
  if(settings.themeColor==='green') document.body.classList.add(`theme-green`);
  
  window.applyExportColSettings();
  updateHolidayCache();
  settings.v = 6.0; saveSettings();
}

// ── Month cache (for renderHome & week strip) ─────────────
var _monthCache = []; // Cached records for the currently displayed month
var _monthCacheKey = ''; // 'YYYY-M' key of the cached month

// Ensure month cache is loaded; reloads only when month changes.
async function generateAutoAbsentRecords(recs, year, month) {
  recs = Array.isArray(recs) ? recs : [];
  let now = new Date();
  let daysInMonth = new Date(year, month + 1, 0).getDate();
  let modified = false;
  let comps = settings.compensations || [];
  
  let recDateMap = new Map();
  recs.forEach(r => {
    if (r && r.date) {
      recDateMap.set(normalizeSlashDate(r.date), r);
    }
  });
  
  let compLeaveSet = new Set(comps.filter(c => c.type === 'leave').map(c => normalizeSlashDate(c.date)));

  for (let i = 1; i <= daysInMonth; i++) {
    let d = new Date(year, month, i);
    // For current month, don't generate beyond today unless already in recs
    if (year === now.getFullYear() && month === now.getMonth() && d > now) continue;
    
    let dStr = makeDateKey(year, month, i);
    let existRec = recDateMap.get(dStr);
    
    if (!existRec) {
      let isHol = isHoliday(d);
      let isWork = isWorkDay(d);
      let isCompLeave = compLeaveSet.has(dStr);
      
      let status = 'absent';
      let absenceType = '';
      let note = '';
      let auto = true;
      
      if (isHol) {
        status = 'إجازة';
        note = getHolidayLabel(d);
      } else if (!isWork) {
        status = 'إجازة';
        note = 'إجازة أسبوعية';
      } else if (isCompLeave) {
        status = 'إجازة من الإضافي';
        absenceType = 'إجازة تعويض إضافي';
        note = 'إجازة من الإضافي';
        auto = false;
      }
      
      let newRec = {
        id: uuid(),
        date: dStr,
        status: status,
        absenceType: absenceType,
        note: note,
        auto: auto,
        checkIn: null,
        checkOut: null
      };
      
      await RECDB.put(newRec);
      recs.push(newRec);
      recDateMap.set(dStr, newRec);
      modified = true;
    }
  }
  if(modified) {
    recs.sort((a,b)=>slashToISO(a.date).localeCompare(slashToISO(b.date)));
  }
  return recs;
}
async function ensureMonthCache(year, month){
  let key = `${year}-${month}`;
  if(_monthCacheKey === key && _monthCache && _monthCache.length > 0) return _monthCache;
  let rawRecs = await RECDB.getMonth(year, month);
  _monthCache = await generateAutoAbsentRecords(rawRecs, year, month);
  _monthCacheKey = key;
  return _monthCache;
}

// Synchronous find within the month cache (for renderHome/renderWeekStrip)
function findRecord(date){
  if(!date) return null;
  let norm = normalizeSlashDate(date);
  // Try month cache first for today or current-view month
  let r = _monthCache.find(rc=>rc.date===norm || rc.date===date);
  if(r) return r;
  // Fallback: check small records array (today's record)
  return (records||[]).find(rc=>rc.date===norm || rc.date===date)||null;
}

async function saveSettings(){updateHolidayCache(); await IDB.set(DB_KEYS.S,settings);}

// saveRecord: persist a SINGLE record to RECDB (fast, O(1))
async function saveRecord(rec){
  if(!rec||!rec.date) return;
  rec.date = normalizeSlashDate(rec.date);
  if(!rec.id) rec.id=uuid();
  await RECDB.put(rec);
  // Update month cache if this record belongs to the cached month
  let parts=rec.date.split('/');
  if(parts.length===3){
    let ck=`${parts[2]}-${Number(parts[1])-1}`;
    if(_monthCacheKey===ck){
      let idx=_monthCache.findIndex(r=>r.date===rec.date);
      if(idx>=0) _monthCache[idx]=rec; else _monthCache.push(rec);
      _monthCache.sort((a,b)=>slashToISO(a.date).localeCompare(slashToISO(b.date)));
    }
  }
  // Update today cache
  if(rec.date===todayKey()){
    let ti=records.findIndex(r=>r.date===rec.date);
    if(ti>=0) records[ti]=rec; else records=[rec];
  }
}

// deleteRecord: remove a single record from RECDB
async function deleteRecord(date){
  let norm = normalizeSlashDate(date);
  await RECDB.del(norm);
  if(date !== norm) await RECDB.del(date);
  // Remove from month cache
  _monthCache=_monthCache.filter(r=>r.date!==norm && r.date!==date);
  // Remove from today cache
  records=records.filter(r=>r.date!==norm && r.date!==date);
}

// Legacy saveRecords: only used for bulk save during migration or undo
function saveRecords(){
  // No-op for new code paths; individual saves use saveRecord().
  // Kept for backward compatibility with undo/redo system.
}

// ── Biometric Authentication ──────────────────────────────
window.toggleBiometricLock = async function() {
  const bioCB = document.getElementById('biometricLockCB');
  if(!bioCB) return;
  const enable = bioCB.checked;
  
  if(!window.Capacitor || !window.Capacitor.Plugins.NativeBiometric) {
    toast("هذه الميزة مدعومة فقط على الهواتف الذكية","err");
    bioCB.checked = false;
    return;
  }

  const NB = window.Capacitor.Plugins.NativeBiometric;
  try {
    const res = await NB.isAvailable();
    if(!res.isAvailable) {
      toast("جهازك لا يدعم المصادقة الحيوية","err");
      bioCB.checked = false;
      return;
    }

    if(enable) {
      // Verify identity before enabling
      try {
        await NB.verifyIdentity({
          reason: "لتفعيل قفل التطبيق، يرجى التحقق من هويتك",
          title: "تأكيد الهوية",
          subtitle: "المصادقة الحيوية"
        });
        settings.enableBiometric = true;
        saveSettings();
        toast(`<i class="fa-solid fa-shield-check ml-1"></i> تم تفعيل قفل البصمة بنجاح`,`ok`);
      } catch(e) {
        bioCB.checked = false;
        toast("فشل التحقق من الهوية","err");
      }
    }
  } catch(e) {
    bioCB.checked = false;
    toast("حدث خطأ ما","err");
  }
};

async function fillAbsences(){
  let now=new Date(),y=now.getFullYear(),m=now.getMonth();
  let from=new Date(y,m,1); from.setMonth(from.getMonth()-6);
  let existingMap = new Map(); // date -> record
  let cur2 = new Date(from);
  let lastProcessedYM = '';
  while(cur2<=now){
    let ym=`${cur2.getFullYear()}-${cur2.getMonth()}`;
    if(ym!==lastProcessedYM){
      lastProcessedYM=ym;
      let monthRecs = await RECDB.getMonth(cur2.getFullYear(), cur2.getMonth());
      monthRecs.forEach(r=>{
        let norm = normalizeSlashDate(r.date);
        existingMap.set(norm, r);
      });
    }
    cur2.setDate(cur2.getDate()+1);
  }

  let toSave=[]; // records to insert/update
  let toDelete=[]; // dates to delete
  let cur=new Date(from);
  let comps = settings.compensations || [];
  
  while(cur<=now){
    let k=makeDateKey(cur.getFullYear(),cur.getMonth(),cur.getDate());
    let existRec = existingMap.get(k);
    let isCompLeave = comps.some(c => c.date === k && c.type === 'leave');

    if (isHoliday(cur)) {
      let holLabel = getHolidayLabel(cur);
      if (existRec && existRec.auto && (existRec.status === 'absent' || existRec.status === 'إجازة رسمية' || existRec.status === 'إجازة')) {
        existRec.status='إجازة'; existRec.absenceType=''; existRec.note=holLabel;
        toSave.push(existRec);
      } else if (!existRec) {
        let nr={id:uuid(),date:k,checkIn:null,checkOut:null,status:'إجازة',absenceType:'',note:holLabel,auto:true};
        existingMap.set(k,nr); toSave.push(nr);
      }
    } else if (!isWorkDay(cur)) {
      if (existRec && existRec.auto && (existRec.status === 'absent' || existRec.status === 'إجازة رسمية' || existRec.status === 'إجازة')) {
        existRec.status='إجازة'; existRec.absenceType=''; existRec.note='إجازة أسبوعية';
        toSave.push(existRec);
      } else if (!existRec) {
        let nr={id:uuid(),date:k,checkIn:null,checkOut:null,status:'إجازة',absenceType:'',note:'إجازة أسبوعية',auto:true};
        existingMap.set(k,nr); toSave.push(nr);
      }
    } else {
      if (isCompLeave) {
        if (existRec && existRec.status !== 'إجازة من الإضافي') {
          existRec.status = 'إجازة من الإضافي';
          existRec.absenceType = 'إجازة تعويض إضافي';
          existRec.auto = false;
          toSave.push(existRec);
        } else if (!existRec) {
          let nr={id:uuid(),date:k,checkIn:null,checkOut:null,status:'إجازة من الإضافي',absenceType:'إجازة تعويض إضافي',note:'إجازة من الإضافي',auto:false};
          existingMap.set(k,nr); toSave.push(nr);
        }
      } else if (existRec && existRec.auto && (existRec.status==='إجازة رسمية' || existRec.status==='إجازة')) {
        existRec.status='absent'; existRec.absenceType=''; existRec.note='';
        toSave.push(existRec);
      } else if (!existingMap.has(k)) {
        let nr={id:uuid(),date:k,checkIn:null,checkOut:null,status:'absent',absenceType:'',note:'',auto:true};
        existingMap.set(k,nr); toSave.push(nr);
      }
    }
    cur.setDate(cur.getDate()+1);
  }
  
  // Batch save/delete
  if(toSave.length>0) await RECDB.putAll(toSave);
  for(let d of toDelete) await RECDB.del(d);
  
  if(toSave.length>0||toDelete.length>0){
    settings.lastAbsenceFill=todayKey();
    saveSettings();
    // Refresh month cache after fill
    let nowD=new Date();
    _monthCache=await RECDB.getMonth(nowD.getFullYear(),nowD.getMonth());
    _monthCacheKey=`${nowD.getFullYear()}-${nowD.getMonth()}`;
  }
}
window.fillAbsences=fillAbsences;

// ── Clock / Header ────────────────────────────────────────
function tickClock(){
  let now=new Date();
  let cl=document.getElementById(`hdrClock`);
  if(cl) cl.textContent=now.toLocaleTimeString(`en-US`,{hour:`2-digit`,minute:`2-digit`,hour12:true}).replace(`AM`,`ص`).replace(`PM`,`م`);
  
  let dy=document.getElementById(`hdrDay`);
  if(dy) dy.textContent=DAYS[now.getDay()];
  
  let dt=document.getElementById(`hdrDate`);
  if(dt) dt.textContent=now.toLocaleDateString(`ar-EG-u-nu-latn`,{year:`numeric`,month:`long`,day:`numeric`});
  
  if(now.getDate()!==todayDay){todayDay=now.getDate();fillAbsences();renderHome();alertedToday=false;}
  checkAlert(now);
}
function checkAlert(now){
  if(!settings.alertOffset||!isWorkDay(now)||isHoliday(now)) return;
  // Fallback for Web/Desktop if not using Native LocalNotifications
  if(window.Capacitor && window.Capacitor.isNativePlatform) return; 

  let rec=findRecord(todayKey());
  if(rec&&rec.checkIn) return;
  let sch=getSchedule(now.getFullYear(),now.getMonth(),now);
  let[h,min]=sch.start.split(`:`).map(Number);
  let start=new Date(now).setHours(h,min,0,0);
  let warn=start-settings.alertOffset*60000;
  if(now.getTime()>=warn&&now.getTime()<start&&!alertedToday){
    alertedToday=true;
    if(Notification.permission===`granted`) new Notification(`تذكير بالدوام`,{body:`اقترب موعد الدوام (${fmt12(sch.start)}) المتبقي ${settings.alertOffset} دقيقة.`});
    else showNotif(`اقترب موعد الدوام، المتبقي أقل من ${settings.alertOffset} دقيقة`,`fa-bell`,`var(--stat-late-text)`);
  }
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg,type){
  let el=document.getElementById(`toast`);
  if(!el) return;
  el.innerHTML=msg;
  // Modern High-Contrast Style (Fixed visible colors and centered horizontally)
  el.className=`fixed bottom-24 left-0 right-0 mx-auto w-max text-center px-6 py-3 rounded-2xl text-sm font-bold shadow-2xl z-[200] transition-all duration-500 pointer-events-none whitespace-nowrap toast-dark animate-modal-in ` + 
    (type===`ok`?`text-emerald-400`:type===`err`?`text-red-400`:`text-cyan-400`);
  
  setTimeout(()=>{
    el.classList.remove(`animate-modal-in`);
    el.classList.add(`opacity-0`,`translate-y-8`,`scale-95`);
  },2800);
}

// ── Notification banner ───────────────────────────────────
function showNotif(msg,icon,color){
  let area=document.getElementById(`notifArea`); if(!area) return;
  let el=document.createElement(`div`);
  el.className=`notif flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold shadow`;
  el.style.cssText=`background:${color}15;color:${color};border:1px solid ${color}30`;
  el.innerHTML=`<i class="fa-solid ${icon}"></i> ${msg}`;
  area.appendChild(el); setTimeout(()=>el.remove(),8000);
}

// ── Navigation ────────────────────────────────────────────
function go(page){
  document.querySelectorAll(`.page`).forEach(p=>p.classList.remove(`active`));
  let pg=document.getElementById(`pg-`+page); if(pg) pg.classList.add(`active`);
  document.querySelectorAll(`.nav-i`).forEach(n=>{n.classList.remove(`on`);n.style.color=`var(--text2)`});
  let idx={home:0,records:1,stats:2,settings:3}[page];
  let navBtns=document.querySelectorAll(`.nav-i`);
  if(navBtns[idx]){navBtns[idx].classList.add(`on`);navBtns[idx].style.color=``;}
  if(page===`home`) renderHome();
  if(page===`records`) renderRecords();
  if(page===`stats`) renderStats();
  if(page===`settings`) renderSettingsPage();
  pdfCanvasesCache = null; // Reset PDF cache on navigation/data change
  if(typeof window.scrollTo === 'function') window.scrollTo(0,0);
}

// ── Theme ─────────────────────────────────────────────────
window.setThemeColor=function(c){
  settings.themeColor=c;
  saveSettings();
  applyTheme();
  toast(`<i class="fa-solid fa-palette ml-1"></i> تم تغيير اللون المطابق`,`ok`);
};

function toggleTheme(){settings.dark=!settings.dark;saveSettings();applyTheme();}

function applyTheme(){
  if(document.documentElement && document.documentElement.classList) document.documentElement.classList.toggle(`dark`,settings.dark);
  
  // Sync the theme toggle checkbox in settings
  let cb=document.getElementById('themeToggleCB');
  if(cb) cb.checked=settings.dark;
  
  // Ensure we use settings.themeColor as the primary key
  if(document.body && document.body.classList) {
    if(settings.themeColor===`green`){
      document.body.classList.add(`theme-green`);
      if(document.body.setAttribute) document.body.setAttribute('data-accent', 'green');
    }else{
      document.body.classList.remove(`theme-green`);
      if(document.body.setAttribute) document.body.setAttribute('data-accent', 'blue');
    }
  }
  if(document.documentElement && document.documentElement.setAttribute) {
    document.documentElement.setAttribute('data-accent', settings.themeColor===`green` ? 'green' : 'blue');
  }
  let ic=document.getElementById(`themeIcon`); if(ic) ic.className=`fa-solid `+(settings.dark?`fa-sun`:`fa-moon`);
  
  // Also sync charts if visible
  if(document.getElementById('pg-stats') && document.getElementById('pg-stats').classList.contains('active')) renderStats();
}


// ── Home Page ─────────────────────────────────────────────
// Flag: whether user enabled work on today's holiday
var holidayWorkEnabled = false;

window.toggleHolidayWork = function() {
  holidayWorkEnabled = !holidayWorkEnabled;
  renderHome();
};

function renderHome(){
  let name=settings.name||`المستخدم`;
  let av=document.getElementById(`homeAvatar`); if(av) av.textContent=name.charAt(0);
  let gr=document.getElementById(`homeGreeting`); if(gr) gr.textContent=`مرحباً، `+name;
  let now=new Date(),sch=getSchedule(now.getFullYear(),now.getMonth(),now),isHol=isHoliday(now),isWork=isWorkDay(now);
  let schLabel=sch.label+` `+fmt12(sch.start)+` - `+fmt12(sch.end);
  if(!isWork) schLabel=`اليوم غير يوم عمل`; if(isHol) schLabel=`اليوم إجازة رسمية`;
  let hs=document.getElementById(`homeSchedule`); if(hs) hs.textContent=schLabel;
  let rec=findRecord(todayKey());
  let infoEl=document.getElementById(`homeTodayInfo`),badge=document.getElementById(`homeStatusBadge`);
  let btnIn=document.getElementById(`btnCheckIn`),btnOut=document.getElementById(`btnCheckOut`);
  let timer=document.getElementById(`homeTimer`),notifArea=document.getElementById(`notifArea`);
  if(notifArea) notifArea.innerHTML=``;
  // Show/hide holiday work banner
  let holBanner = document.getElementById('holidayWorkBanner');
  let holLabel  = document.getElementById('holidayBannerLabel');
  let holMsg    = document.getElementById('holidayWorkActiveMsg');
  let holBtn    = document.getElementById('btnWorkOnHoliday');
  if(isHol||!isWork){
    let holText = isHol ? getHolidayLabel(now) : `غير يوم عمل`;
    if(badge) badge.innerHTML=`<span class="px-3 py-1 rounded-full text-[11px] font-bold text-white" style="background:var(--c-text-3)">${holText}</span>`;
    if(infoEl) infoEl.innerHTML=``;
    // Show the holiday banner
    if(holBanner) holBanner.classList.remove('hidden');
    if(holLabel)  holLabel.textContent = holText;
    if(!holidayWorkEnabled) {
      // Buttons stay DISABLED
      if(btnIn){btnIn.disabled=true;btnIn.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);btnIn.classList.remove(`pulse-a`);}
      if(btnOut){btnOut.disabled=true;btnOut.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
      if(timer) timer.classList.add(`hidden`); stopTimer();
      if(holMsg) holMsg.classList.add('hidden');
      if(holBtn) { holBtn.innerHTML = '<i class="fa-solid fa-unlock ml-1"></i>تفعيل التسجيل'; holBtn.style.background='var(--c-info)'; }
    } else {
      // Holiday work ENABLED – let the rest of the function handle the record state
      if(holMsg) holMsg.classList.remove('hidden');
      if(holBtn) { holBtn.innerHTML = '<i class="fa-solid fa-lock ml-1"></i>إلغاء التفعيل'; holBtn.style.background='#ef4444'; }
      // Fall through to normal work-day logic below for button states
      if(!rec||rec.status===`absent`||rec.status===`إجازة`){
        if(btnIn){btnIn.disabled=false;btnIn.classList.remove(`opacity-50`,`cursor-not-allowed`,`disabled`);btnIn.classList.add(`pulse-a`);}
        if(btnOut){btnOut.disabled=true;btnOut.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
        if(timer) timer.classList.add(`hidden`); stopTimer();
      } else {
        if(btnIn){btnIn.classList.remove(`pulse-a`);btnIn.disabled=true;btnIn.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
        if(rec.checkOut){
          if(btnOut){btnOut.disabled=true;btnOut.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
          if(timer) timer.classList.add(`hidden`); stopTimer();
          let d=new Date(slashToISO(rec.date)),sch2=getSchedule(d.getFullYear(),d.getMonth(),d);
          let [sh, sm] = (rec.checkIn && rec.checkIn.includes(":") ? rec.checkIn : "00:00").split(":").map(Number), [eh, em] = (rec.checkOut && rec.checkOut.includes(":") ? rec.checkOut : "00:00").split(":").map(Number);
          let ex=(eh*60+em)-(sh*60+sm); if(ex<0)ex+=1440;
          let html=`<div class="flex justify-between"><span>حضور</span><span class="font-bold" style="color:var(--stat-present-text)">${fmt12(rec.checkIn)}</span></div>`;
          html+=`<div class="flex justify-between"><span>انصراف</span><span class="font-bold" style="color:var(--c-blue)">+${formatMin(ex)} ${fmt12(rec.checkOut)}</span></div>`;
          if(infoEl) infoEl.innerHTML=html;
        } else {
          if(btnOut){btnOut.disabled=false;btnOut.classList.remove(`opacity-50`,`cursor-not-allowed`,`disabled`);}
          startTimer(rec.checkIn, null);
        }
      }
      renderWeekStrip();
      return; // Skip the rest of renderHome
    }
    renderWeekStrip();
    return;
  } else {
    // Normal workday – hide the holiday banner and reset flag
    holidayWorkEnabled = false;
    if(holBanner) holBanner.classList.add('hidden');
  }
  if(!rec||rec.status===`absent`){
    if(badge) badge.innerHTML=`<span class="status-badge status-badge-absent py-1 px-3 text-xs"><i class="fa-solid fa-circle-xmark"></i><span>غائب اليوم</span></span>`;
    if(infoEl) infoEl.innerHTML=``;
    if(btnIn){btnIn.disabled=false;btnIn.classList.remove(`opacity-50`,`cursor-not-allowed`,`disabled`);btnIn.classList.add(`pulse-a`);}
    if(btnOut){btnOut.disabled=true;btnOut.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
    if(timer) timer.classList.add(`hidden`); stopTimer();
  } else {
    if(btnIn){btnIn.classList.remove(`pulse-a`);btnIn.disabled=true;btnIn.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
    let late=lateMin(rec.checkIn,sch.start),early=rec.checkOut?earlyMin(rec.checkOut,sch.end):0,extra=rec.checkOut?extraMin(rec.checkOut,sch.overtimeStart):0;
    let isLateComp = (settings.compensations || []).some(c => c.date === rec.date && c.type === 'late');
    let isEarlyComp = (settings.compensations || []).some(c => c.date === rec.date && c.type === 'early');
    
    if(badge) badge.innerHTML=getStatusBadgeHTML(rec.status, late, isLateComp);
    
    let inColorClass = (late > 0 && !isLateComp) ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
    let outColorClass = extra > 0 ? 'text-blue-600 dark:text-blue-400' : ((early > 0 && !isEarlyComp) ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400');

    let html=`<div class="flex justify-between items-center py-0.5"><span>حضور</span><span class="font-black ${inColorClass}">${fmt12(rec.checkIn)}${late && !isLateComp ? ` (+`+formatMin(late)+` تأخير)` : (late && isLateComp ? ` (معوّض ✓)` : ``)}</span></div>`;
    html+=`<div class="flex justify-between items-center py-0.5"><span>انصراف</span><span class="font-black ${outColorClass}">${fmt12(rec.checkOut)}${early && !isEarlyComp ? ` (-`+formatMin(early)+` مبكر)` : (early && isEarlyComp ? ` (معوّض ✓)` : ``)}${extra ? ` (+`+formatMin(extra)+` إضافي)` : ``}</span></div>`;
    if(infoEl) infoEl.innerHTML=html;
    if(rec.checkOut){
      if(btnOut){btnOut.disabled=true;btnOut.classList.add(`opacity-50`,`cursor-not-allowed`,`disabled`);}
      if(timer) timer.classList.add(`hidden`); stopTimer();
    } else {
      if(btnOut){btnOut.disabled=false;btnOut.classList.remove(`opacity-50`,`cursor-not-allowed`,`disabled`);}
      startTimer(rec.checkIn,sch.end);
    }
  }
  renderWeekStrip();
  
  // ── AI Intelligence Tip 🧠 ──
  (async function(){
    try {
      let recs = await RECDB.getAll();
      let patterns = analyzeLatenessPatterns(recs);
      let tipEl = document.getElementById(`aiHomeTip`);
      let tipContent = document.getElementById(`aiTipContent`);
      if(!patterns || !tipEl || !tipContent) return;

      let tomorrowIdx = (new Date().getDay() + 1) % 7;
      let p = patterns[tomorrowIdx];
      
      // If probability > 25% and we have at least 2 samples
      if(p && p.prob >= 25 && p.count >= 2) {
        tipEl.classList.remove(`hidden`);
        setTimeout(()=>{
          tipEl.classList.remove(`opacity-0`,`translate-y-2`);
        }, 100);
        tipContent.innerHTML = `تنبيه ذكي: لاحظت أنك تميل للتأخر غالباً يوم <span class="text-blue-600">(${esc(p.label)})</span>. استعد غداً بشكل مبكر لتجنب التأخير!`;
      } else {
        tipEl.classList.add(`hidden`,`opacity-0`,`translate-y-2`);
      }
    } catch(e) { console.warn("AI Tip Engine failed:", e); }
  })();

  // month stats
  let curYear = now.getFullYear();
  let curMonth = now.getMonth();
  ensureMonthCache(curYear, curMonth).then(monthRecs => {
    let p=0,a=0,l=0;
    monthRecs.forEach(r=>{
      if(r&&isPresent(r.status)){
        p++;
        let d=new Date(slashToISO(r.date)),s=getSchedule(d.getFullYear(),d.getMonth(),d);
        if(lateMin(r.checkIn,s.start)>0)l++;
      }else if(r&&r.status===`absent`)a++;
    });
    let hp=document.getElementById(`hsPresent`); if(hp) hp.textContent=p;
    let ha=document.getElementById(`hsAbsent`); if(ha) ha.textContent=a;
    let hl=document.getElementById(`hsLate`); if(hl) hl.textContent=l;
  });
}

// ── Week strip ────────────────────────────────────────────
function renderWeekStrip(){
  let labels=document.getElementById(`weekDayLabels`);
  if(labels) labels.innerHTML=DAYS.map(d=>`<span>${d}</span>`).join(``);
  let now=new Date(),startOfWeek=new Date(now);
  startOfWeek.setDate(now.getDate()-now.getDay());
  let html=``;
  for(let i=0;i<7;i++){
    let d=new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i);
    let k=makeDateKey(d.getFullYear(),d.getMonth(),d.getDate());
    let future=d>now,isW=isWorkDay(d),isH=isHoliday(d),rec=findRecord(k),dot=``,dim=``;
    if(future||!isW||isH){dot=``;dim=`opacity-30`;}
    else if(rec&&rec.status===`present`){let s=getSchedule(d.getFullYear(),d.getMonth(),d);dot=lateMin(rec.checkIn,s.start)?`<div class="w-4 h-4 rounded-full mx-auto" style="background:var(--stat-late-text)"></div>`:`<div class="w-4 h-4 rounded-full mx-auto" style="background:var(--stat-present-text)"></div>`;}
    else if(rec&&isPresent(rec.status)){dot=`<div class="w-4 h-4 rounded-full mx-auto" style="background:var(--theme-primary)"></div>`;}
    else dot=rec?`<div class="w-4 h-4 rounded-full mx-auto" style="background:var(--stat-absent-text)"></div>`:``;
    html+=`<div class="text-center ${dim}"><div class="text-[10px] mb-1" style="color:var(--text2)">${d.getDate()}</div>${dot}</div>`;
  }
  let wd=document.getElementById(`weekDays`); if(wd) wd.innerHTML=html;
}

// ── Timer ─────────────────────────────────────────────────
var _activeTimerCheckIn = null;
function startTimer(checkIn,endTime){
  stopTimer();
  if(!checkIn || typeof checkIn !== 'string' || !checkIn.includes(':')) return;
  _activeTimerCheckIn = checkIn;
  let timer=document.getElementById(`homeTimer`); if(timer) timer.classList.remove(`hidden`);
  let parts=checkIn.split(`:`).map(Number);
  let h=isNaN(parts[0])?0:parts[0], m=isNaN(parts[1])?0:parts[1];
  let startMs=new Date().setHours(h,m,0,0);
  if(isNaN(startMs)) return;

  function tick(){
    let elapsed=Math.floor((Date.now()-startMs)/1000);
    if(isNaN(elapsed) || elapsed < 0) elapsed = 0;
    let hh=Math.floor(elapsed/3600),mm=Math.floor(elapsed%3600/60),ss=elapsed%60;
    let td=document.getElementById(`timerDisplay`); if(td) td.textContent=String(hh).padStart(2,`0`)+`:`+String(mm).padStart(2,`0`)+`:`+String(ss).padStart(2,`0`);
  }
  tick(); timerHandle=setInterval(tick,1000);
}
function stopTimer(){
  if(timerHandle){clearInterval(timerHandle);timerHandle=null;}
  _activeTimerCheckIn = null;
}

var _renderRecsDebounceTimer = null;
function debouncedRenderRecords(delay = 150) {
  if (_renderRecsDebounceTimer) clearTimeout(_renderRecsDebounceTimer);
  _renderRecsDebounceTimer = setTimeout(() => {
    renderRecords();
  }, delay);
}
window.debouncedRenderRecords = debouncedRenderRecords;

// ── Action Concurrency Lock Manager ───────────────────────
var _actionLocks = new Set();
function acquireActionLock(key) {
  if (_actionLocks.has(key)) return false;
  _actionLocks.add(key);
  return true;
}
function releaseActionLock(key) {
  _actionLocks.delete(key);
}

// ── Check In / Out ────────────────────────────────────────
window.doCheckIn=async function(){
  if(!acquireActionLock('checkInOut')) return;
  try {
    let now2=new Date(), isHolToday=isHoliday(now2)||!isWorkDay(now2);
    if(isHolToday && !holidayWorkEnabled) return toast(`هذا اليوم إجازة. فعّل التسجيل أولاً من زر التفعيل`,`err`);
    let noteEl=document.getElementById(`noteInput`),note=noteEl?noteEl.value.trim().slice(0, 2000):``;
    let k=todayKey(),time=nowHHMM(),rec=findRecord(k);
    if(rec&&rec.checkIn&&rec.checkOut) return toast(`سُجّل الحضور والانصراف مسبقاً لهذا اليوم`,`err`);
    if(rec&&rec.checkIn) return toast(`عفواً، سُجّل حضورك مسبقاً!`,`err`);
    if(rec){rec.status=`present`;rec.checkIn=time;rec.auto=false;rec.absenceType=``;if(note)rec.note=note;}
    else{rec={id:uuid(),date:k,checkIn:time,checkOut:null,status:`present`,absenceType:``,note:note,auto:false};records.push(rec);}
    await saveRecord(rec);renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تم تسجيل الحضور`,`ok`);if(noteEl)noteEl.value=``;
  } finally {
    releaseActionLock('checkInOut');
  }
};
window.doCheckOut=async function(){
  if(!acquireActionLock('checkInOut')) return;
  try {
    let now2=new Date(), isHolToday=isHoliday(now2)||!isWorkDay(now2);
    if(isHolToday && !holidayWorkEnabled) return toast(`هذا اليوم إجازة. فعّل التسجيل أولاً من زر التفعيل`,`err`);
    let noteEl=document.getElementById(`noteInput`),note=noteEl?noteEl.value.trim().slice(0, 2000):``;
    let k=todayKey(),time=nowHHMM(),rec=findRecord(k);
    if(!rec||!rec.checkIn) return toast(`سجّل الحضور أولاً`,`err`);
    if(rec.checkOut) return toast(`سُجّل الانصراف مسبقاً لهذا اليوم`,`err`);
    rec.checkOut=time;if(note)rec.note=((rec.note?rec.note+`\n`:``)+note).slice(0, 2000);
    await saveRecord(rec);stopTimer();renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تم تسجيل الانصراف`,`ok`);if(noteEl)noteEl.value=``;
  } finally {
    releaseActionLock('checkInOut');
  }
};

// ── Calendar ──────────────────────────────────────────────
window.openCal=function(){let el=document.getElementById(`calM`);if(el){el.classList.remove(`hidden`);renderCal();}};
window.closeCal=function(){let el=document.getElementById(`calM`);if(el)el.classList.add(`hidden`);};
window.calP=function(){calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCal();}
window.calN=function(){calMonth--;if(calMonth<0){calMonth=11;calYear--;}renderCal();}
window.renderCal=async function(){
  let calT=document.getElementById(`calT`); if(calT) calT.textContent=MONTHS[calMonth]+` `+calYear;
  let calHL=document.getElementById(`calHL`); if(calHL) calHL.innerHTML=DAYS.map(d=>`<span>${d.replace('ال','')}</span>`).join(``);
  let startDay=new Date(calYear,calMonth,1).getDay(),daysInMonth=new Date(calYear,calMonth+1,0).getDate(),html=``;
  for(let i=0;i<startDay;i++) html+=`<div></div>`;
  let monthRecs=await RECDB.getMonth(calYear, calMonth);
  for(let d=1;d<=daysInMonth;d++){
    let k=makeDateKey(calYear,calMonth,d),rec=monthRecs.find(r=>r.date===k);
    let bg=`var(--bg)`,color=`var(--text2)`,border=``,day=new Date(calYear,calMonth,d);
    if(!isWorkDay(day)||isHoliday(day)){bg=`transparent`;color=`var(--border)`;}
    else if(rec){if(isPresent(rec.status)){let s=getSchedule(calYear,calMonth,day);bg=lateMin(rec.checkIn,s.start)?`var(--stat-late-bg)` : `var(--stat-present-bg)`;color=lateMin(rec.checkIn,s.start)?`var(--stat-late-text)` : `var(--stat-present-text)`;}else{bg=`var(--stat-absent-bg)`;color=`var(--stat-absent-text)`;}}
    if(viewYear===calYear&&viewMonth===calMonth&&periodMode===`specific`) border=`border:2px solid var(--pri)`;
    html+=`<button onclick="pickMonth(${calYear},${calMonth})" class="cd" style="background:${bg};color:${color};${border}">${d}</button>`;
  }
  let calG=document.getElementById(`calG`); if(calG) calG.innerHTML=html;
};
window.pickMonth=function(y,m){viewYear=y;viewMonth=m;if(typeof closeCal==='function') closeCal(); let pf=document.getElementById(`periodFilter`); if(pf) pf.value=`specific`; periodMode=`specific`; if(typeof window.togglePeriodFilter==='function') window.togglePeriodFilter();};

// ── Records page ──────────────────────────────────────────
window.togglePeriodFilter=function(){
  let pf=document.getElementById(`periodFilter`); if(!pf) return;
  periodMode=pf.value;
  let fs=document.getElementById(`filterSpecific`),fc=document.getElementById(`filterCustom`);
  if(fs) fs.classList.add(`hidden`); if(fc) fc.classList.add(`hidden`);
  let now=new Date();
  if(periodMode===`specific`&&fs) fs.classList.remove(`hidden`);
  else if(periodMode===`custom`&&fc){
    fc.classList.remove(`hidden`);
    if(!document.getElementById(`dateStart`).value){
      document.getElementById(`dateStart`).value=slashToISO(makeDateKey(now.getFullYear(),now.getMonth(),1));
      document.getElementById(`dateEnd`).value=slashToISO(makeDateKey(now.getFullYear(),now.getMonth(),now.getDate()));
    }
  }
  else if(periodMode===`prev`){
    viewYear=now.getFullYear();
    viewMonth=now.getMonth()-1;
    if(viewMonth<0){viewMonth=11;viewYear--;}
  }
  else{
    viewYear=now.getFullYear();
    viewMonth=now.getMonth();
  }
  _monthCacheKey = ''; // Invalidate so data loads freshly
  renderRecords();
};

// Global helper for comprehensive search across record fields
function searchMatch(r, q) {
  if (!q) return true;
  if (!r || typeof r !== 'object') return false;
  let rawDate = r.date || '';
  let d = new Date(slashToISO(rawDate));
  let dayName = (!isNaN(d.getTime()) && DAYS[d.getDay()]) ? DAYS[d.getDay()] : '';
  let statusAr = r.status === 'present' ? 'حاضر' : r.status === 'absent' ? 'غائب' : (r.status === 'إجازة رسمية' || r.status === 'إجازة') ? 'إجازة' : (r.status || '');
  let recType = r.auto ? 'تلقائي' : 'يدوي';
  
  let searchableText = [
    rawDate,
    dayName,
    statusAr,
    r.absenceType || '',
    r.note || '',
    r.checkIn || '',
    r.checkOut || '',
    recType
  ].join(' ').toLowerCase();

  let terms = q.split(' ').filter(t => t);
  return terms.every(term => searchableText.includes(term));
}
async function renderRecords(){
  let body=document.getElementById(`recBody`), noRec=document.getElementById(`noRec`);
  let thDay = document.getElementById('thDay');
  if(thDay) thDay.style.display = settings.exportColumns.day ? '' : 'none';

  // Show loading indicator
  if(body) body.innerHTML=`<tr><td colspan="10" class="text-center py-8 opacity-50"><i class="fa-solid fa-spinner fa-spin ml-2"></i> جارٍ التحميل...</td></tr>`;
  if(noRec) noRec.classList.add(`hidden`);

  let filtered=[];
  let summaryRecs=[];

  if(periodMode===`custom`){
    let ds=document.getElementById(`dateStart`)?.value,de=document.getElementById(`dateEnd`)?.value;
    if(ds&&de){
      filtered = await RECDB.getRange(ds, de);
      summaryRecs = filtered.slice();
    }
  } else {
    // Monthly view (each month = one page)
    let mi=document.getElementById(`monthIn`); if(mi) mi.value=MONTHS[viewMonth]+` `+viewYear;
    filtered = await ensureMonthCache(viewYear, viewMonth);
    filtered = filtered.slice(); // don't mutate cache
    summaryRecs = filtered.slice();
  }

  // Search filter
  let q=document.getElementById(`recSearch`) ? document.getElementById(`recSearch`).value.toLowerCase().trim() : ``;
  if(q) {
    filtered = filtered.filter(r => searchMatch(r, q));
    summaryRecs = filtered.slice();
  }

  // Status filter
  let sf=document.getElementById(`statusFilter`)?.value||``;
  if(sf===`present`) filtered=filtered.filter(r=>isPresent(r.status));
  else if(sf===`absent`) filtered=filtered.filter(r=>r.status===`absent`);
  else if(sf===`holiday`) filtered=filtered.filter(r=>r.status===`إجازة رسمية`||r.status===`إجازة`);
  else if(sf===`travel`) filtered=filtered.filter(r=>r.status===`تكليف سفر`);
  else if(sf===`late`) filtered=filtered.filter(r=>{
    if(!isPresent(r.status))return false;
    let d=new Date(slashToISO(r.date));
    return lateMin(r.checkIn,getSchedule(d.getFullYear(),d.getMonth(),d).start)>0;
  });
  else if(sf===`overtime`) filtered=filtered.filter(r=>hasOvertime(r));

  // Sort newest first
  filtered.sort((a,b)=>slashToISO(b.date).localeCompare(slashToISO(a.date)));

  if(!filtered.length){
    if(body) body.innerHTML=``;
    if(noRec) noRec.classList.remove(`hidden`);
    renderMonthSummary(summaryRecs);
    return;
  }

  if(noRec) noRec.classList.add(`hidden`);
  if(body) body.innerHTML=filtered.map(r=>{
    let d=new Date(slashToISO(r.date)), sch=getSchedule(d.getFullYear(),d.getMonth(),d);
    let dayName = DAYS[d.getDay()];
    let isLateComp = (settings.compensations || []).some(c => c.date === r.date && c.type === 'late');
    let isEarlyComp = (settings.compensations || []).some(c => c.date === r.date && c.type === 'early');
    let lateComp = (settings.compensations || []).find(c => c.date === r.date && c.type === 'late');
    let earlyComp = (settings.compensations || []).find(c => c.date === r.date && c.type === 'early');
    let leaveComp = (settings.compensations || []).find(c => c.date === r.date && c.type === 'leave');

    let rawLate = isPresent(r.status) ? lateMin(r.checkIn,sch.start) : 0;
    let rawEarly = r.checkOut ? earlyMin(r.checkOut,sch.end) : 0;
    let late = isLateComp ? 0 : rawLate;
    let early = isEarlyComp ? 0 : rawEarly;
    let isHol = isHoliday(d) || !isWorkDay(d);
    let extra = 0;
    if (isHol && r.checkIn && r.checkOut) {
      let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, em] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
      extra = (eh*60+em) - (sh*60+sm);
      if (extra < 0) extra += 1440;
    } else if (r.checkOut) {
      extra = extraMin(r.checkOut,sch.overtimeStart);
    }
    
    let rowClass = r.status===`absent` ? "tr-absent" : 
                   (r.status===`إجازة رسمية`||r.status===`إجازة`) ? "tr-holiday" : 
                   r.status===`تكليف سفر` ? "tr-travel" : 
                   (rawLate>0 && !isLateComp) ? "tr-late" : 
                   isPresent(r.status) ? "tr-present" : "tr-custom";

    let statusBadgeHTML = getStatusBadgeHTML(r.status, rawLate, isLateComp);

    let timingArr = [];
    if(isLateComp) {
      let srcTxt = lateComp && lateComp.sourceDate ? ` (من ${lateComp.sourceDate})` : '';
      timingArr.push(`<span class="metric-chip metric-chip-compensated" title="تم تعويض التأخير من رصيد يوم ${lateComp?.sourceDate || ''}"><i class="fa-solid fa-check"></i> تعويض تأخير${srcTxt}</span>`);
    } else if(late > 0) {
      timingArr.push(`<span class="metric-chip metric-chip-late"><i class="fa-solid fa-clock-rotate-left"></i> +${formatMin(late)} تأخير</span>`);
    }

    if(isEarlyComp) {
      let srcTxt = earlyComp && earlyComp.sourceDate ? ` (من ${earlyComp.sourceDate})` : '';
      timingArr.push(`<span class="metric-chip metric-chip-compensated" title="تم تعويض الخروج من رصيد يوم ${earlyComp?.sourceDate || ''}"><i class="fa-solid fa-check"></i> تعويض خروج${srcTxt}</span>`);
    } else if(early > 0) {
      timingArr.push(`<span class="metric-chip metric-chip-early"><i class="fa-solid fa-person-walking-arrow-right"></i> -${formatMin(early)} مبكر</span>`);
    }

    let timingHTML = timingArr.length ? timingArr.join('<div class="h-1"></div>') : `<span class="opacity-30 font-bold">-</span>`;

    let inDisplay = r.checkIn ? 
      (rawLate > 0 && !isLateComp ? 
        `<span class="font-black text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">${fmt12(r.checkIn)} <i class="fa-solid fa-clock text-[9px]"></i></span>` :
        (rawLate > 0 && isLateComp ? 
          `<span class="font-black text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">${fmt12(r.checkIn)} <i class="fa-solid fa-check text-[9px]"></i></span>` :
          `<span class="font-black text-emerald-600 dark:text-emerald-400">${fmt12(r.checkIn)}</span>`
        )
      ) : `<span class="opacity-30 font-bold">-</span>`;

    let outDisplay = r.checkOut ? 
      (extra > 0 ? 
        `<span class="font-black text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">${fmt12(r.checkOut)} <i class="fa-solid fa-star text-[9px] text-amber-500"></i></span>` :
        (rawEarly > 0 && !isEarlyComp ? 
          `<span class="font-black text-orange-600 dark:text-orange-400 inline-flex items-center gap-1">${fmt12(r.checkOut)} <i class="fa-solid fa-person-walking-arrow-right text-[9px]"></i></span>` :
          `<span class="font-black text-emerald-600 dark:text-emerald-400">${fmt12(r.checkOut)}</span>`
        )
      ) : `<span class="opacity-30 font-bold">-</span>`;

    let extraHTML = `<span class="opacity-30 font-bold">-</span>`;
    if (extra > 0) {
      let dayComps = (settings.compensations || []).filter(c => c.sourceDate === r.date || (Array.isArray(c.sourceDetails) && c.sourceDetails.some(sd => sd.date === r.date)));
      let usedFromDay = 0;
      dayComps.forEach(c => {
        if (c.sourceDate === r.date) usedFromDay += (c.minutes || 0);
        else if (Array.isArray(c.sourceDetails)) {
          let sd = c.sourceDetails.find(s => s.date === r.date);
          if (sd) usedFromDay += (sd.minutes || 0);
        }
      });
      let remFromDay = Math.max(0, extra - usedFromDay);

      if (usedFromDay >= extra) {
        extraHTML = `<span class="metric-chip bg-slate-800 text-slate-300 border border-slate-700/80" title="تم خصم رصيد هذا اليوم بالكامل"><i class="fa-solid fa-scissors text-amber-400"></i> +${formatMin(extra)} (مخصوم)</span>`;
      } else if (usedFromDay > 0) {
        extraHTML = `<span class="metric-chip bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30" title="تم الخصم منه جزئياً"><i class="fa-solid fa-scissors"></i> +${formatMin(extra)} (متبقي ${formatMin(remFromDay)})</span>`;
      } else {
        extraHTML = `<span class="metric-chip metric-chip-overtime"><i class="fa-solid fa-star text-[9px] text-amber-500"></i> +${formatMin(extra)}</span>`;
      }
    }

    let absenceTypeDisplay = r.status === `absent` ? esc(r.absenceType || ``) : (r.status === 'إجازة من الإضافي' ? esc(r.absenceType || 'إجازة تعويض إضافي') : '');
    
    let noteHTML = '';
    if (leaveComp) {
      let sourceDesc = formatCompSourceText(leaveComp, false);
      let compNote = leaveComp.note ? esc(leaveComp.note) : '';
      let compDetailStr = `خصم ${formatMin(leaveComp.minutes)} ${sourceDesc}`;
      let finalNoteText = compNote ? `${compNote} - ${compDetailStr}` : compDetailStr;
      
      if (r.note && !r.note.includes('خصم') && !r.note.includes('الإضافي') && r.note !== compNote) {
        finalNoteText = `${esc(r.note)} | ${finalNoteText}`;
      }
      
      noteHTML = `<div class="inline-block p-1.5 rounded-lg text-[11px] font-bold leading-normal bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20" title="${finalNoteText}">
        <i class="fa-solid fa-scissors ml-1 text-emerald-600 dark:text-emerald-400"></i> ${finalNoteText}
      </div>`;
    } else {
      noteHTML = esc(r.note) || `<span class="opacity-30">-</span>`;
    }

    return `<tr class="${rowClass}">
      <td class="font-bold text-xs opacity-90">${r.date}</td>
      ${settings.exportColumns.day ? `<td class="font-bold text-xs" style="color:var(--text2)">${esc(dayName)}</td>` : ''}
      <td>${inDisplay}</td>
      <td>${outDisplay}</td>
      <td>${statusBadgeHTML}</td>
      <td>${timingHTML}</td>
      <td>${extraHTML}</td>
      <td class="text-[11px] opacity-80 break-words align-middle font-semibold">${absenceTypeDisplay}</td>
      <td style="font-family: '${settings.noteFont||'Cairo'}', serif; font-size:13px;" class="max-w-[200px] break-words align-middle leading-relaxed">${noteHTML}</td>
      <td style="text-align:center">
        <button onclick="openEdit('${r.id}', '${r.date}')" class="w-8 h-8 rounded-xl inline-flex items-center justify-center text-xs transition-transform hover:scale-105 active:scale-95 cursor-pointer" style="background:var(--c-surface2);color:var(--text1)" title="تعديل السجل">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </td>
    </tr>`;
  }).join(``);

  renderMonthSummary(summaryRecs);
}
window.renderRecords=renderRecords;

function renderMonthSummary(recs){
  recs = Array.isArray(recs) ? recs : (records || []);
  let el=document.getElementById(`monthSum`),cnt=document.getElementById(`monthSumC`);
  if(!recs || !recs.length){if(el)el.classList.add(`hidden`);return;}
  if(el) el.classList.remove(`hidden`);
  let p=0,a=0,l=0,t=0;
  let usedCompensations = settings.compensations || [];
  recs.forEach(r=>{
    let d=new Date(slashToISO(r.date)),sch=getSchedule(d.getFullYear(),d.getMonth(),d);
    let isHol = isHoliday(d) || !isWorkDay(d);
    
    let actuallyWorked = isPresent(r.status) || (isHol && r.checkIn);
    if(actuallyWorked){
      p++;
      if(r.status===`تكليف سفر`) t++;
      if (isPresent(r.status) && r.status !== `تكليف سفر`) { // Only count late on normal workdays
        let isLateComp = usedCompensations.some(c => c.date === r.date && c.type === 'late');
        if(!isLateComp && lateMin(r.checkIn,sch.start)>0) l++;
      }
    }else if(r.status===`absent`)a++;
  });
  monthSummary={p,a,l,t};
  let total=p+a,pct=total?Math.round(p/total*100):0;
  if(cnt) cnt.innerHTML=`
    <div class="p-3 rounded-xl text-center" style="background:var(--stat-present-bg)"><div class="text-xl font-black" style="color:var(--stat-present-text)">${p}</div><div class="text-[10px]" style="color:var(--stat-present-text)">حضور</div></div>
    <div class="p-3 rounded-xl text-center" style="background:var(--stat-absent-bg)"><div class="text-xl font-black" style="color:var(--stat-absent-text)">${a}</div><div class="text-[10px]" style="color:var(--stat-absent-text)">غياب</div></div>
    ${t>0 ? `<div class="p-3 rounded-xl text-center" style="background:#f3e8ff"><div class="text-xl font-black" style="color:#a855f7">${t}</div><div class="text-[10px]" style="color:#a855f7">تكليف سفر</div></div>` : `<div class="p-3 rounded-xl text-center" style="background:var(--stat-late-bg)"><div class="text-xl font-black" style="color:var(--stat-late-text)">${l}</div><div class="text-[10px]" style="color:var(--stat-late-text)">تأخير</div></div>`}
    <div class="p-3 rounded-xl text-center" style="background:var(--c-surface2)"><div class="text-xl font-black" style="color:${pct>=80?`var(--stat-present-text)`:`var(--stat-absent-text)`}">${pct}%</div><div class="text-[10px]" style="color:var(--text2)">النسبة</div></div>`;
}
window.renderMonthSum=renderMonthSummary;

window.goToRecords=function(status){
  if(window.switchRecordsView) switchRecordsView('attendance');
  let sf=document.getElementById(`statusFilter`);
  if(sf) sf.value=status;
  renderRecords();
  go(`records`);
};

// ── Edit & Manual Record Management (Async + RECDB) ──────────────────────
window.openAddRecord=function(defaultDate){
  let d = defaultDate || todayKey();
  openEdit(null, d);
};

window.onEditDateChange=async function(){
  let dateInput = document.getElementById('eDate')?.value;
  if(!dateInput) return;
  let slash = isoToSlash(dateInput);
  let eIdElem = document.getElementById('eId'); if(eIdElem) { eIdElem.setAttribute('data-date', slash); if(eIdElem.dataset) eIdElem.dataset.date = slash; }
  
  let d = new Date(dateInput);
  let dayName = !isNaN(d.getTime()) ? DAYS[d.getDay()] : '';
  let dateDisplay = document.getElementById('eDateDisplay');
  if(dateDisplay) {
    dateDisplay.textContent = `${dayName} - ${slash}`;
  }
  
  // If record exists in RECDB for this date, load its values
  let existing = await RECDB.get(slash);
  if(existing) {
    document.getElementById('eId').value = existing.id || uuid();
    document.getElementById('eCI').value = existing.checkIn || '';
    document.getElementById('eCO').value = existing.checkOut || '';
    let st = existing.status === 'present' || existing.status === 'absent' ? existing.status : 'custom';
    document.getElementById('eSt').value = st;
    if(st === 'custom' && document.getElementById('eCustom')) document.getElementById('eCustom').value = existing.status;
    if(document.getElementById('eAT')) document.getElementById('eAT').value = existing.absenceType || '';
    document.getElementById('eNote').value = existing.note || '';
    toggleEAT();
    toggleCustomField();
  }
};

window.openEdit=async function(id, dateStr){
  let date = dateStr ? normalizeSlashDate(dateStr) : null;
  let rec = null;
  
  if (date) {
    rec = await RECDB.get(date);
  }
  if (!rec && id) {
    rec = (_monthCache || []).find(r => r.id === id);
  }
  if (!rec && id) {
    let all = await RECDB.getAll();
    rec = (all || []).find(r => r.id === id);
  }
  if (!rec) {
    let targetDate = date || todayKey();
    rec = {
      id: id || uuid(),
      date: targetDate,
      checkIn: '',
      checkOut: '',
      status: 'present',
      absenceType: '',
      note: '',
      auto: false
    };
  }

  let editTitle = document.getElementById('editModalTitle');
  if(editTitle) {
    editTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> <span>${id && rec.checkIn ? 'تعديل السجل' : 'إضافة / تعديل سجل'}</span>`;
  }

  let eIdEl = document.getElementById('eId');
  if (eIdEl) {
    eIdEl.value = rec.id || uuid();
    eIdEl.setAttribute('data-date', rec.date || '');
    if (eIdEl.dataset) eIdEl.dataset.date = rec.date || '';
  }
  
  let dateIn = document.getElementById('eDate');
  if(dateIn) {
    dateIn.value = slashToISO(rec.date);
  }

  let dateDisplay = document.getElementById('eDateDisplay');
  if(dateDisplay) {
    let d = new Date(slashToISO(rec.date));
    let dayName = !isNaN(d.getTime()) ? DAYS[d.getDay()] : '';
    dateDisplay.textContent = `${dayName} - ${rec.date}`;
  }

  let eCIEl = document.getElementById('eCI'), eCOEl = document.getElementById('eCO'), eStEl = document.getElementById('eSt');
  if (eCIEl) eCIEl.value = rec.checkIn || '';
  if (eCOEl) eCOEl.value = rec.checkOut || '';
  let st = rec.status === 'present' || rec.status === 'absent' ? rec.status : 'custom';
  if (eStEl) eStEl.value = st;
  
  let customSelect = document.getElementById('eCustom');
  if(customSelect) {
    customSelect.innerHTML = (settings.customStatuses || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if(st === 'custom') customSelect.value = rec.status;
  }
  
  let at = document.getElementById('eAT');
  if(at) {
    at.innerHTML = `<option value="">-- بلا --</option>` + (settings.absenceTypes || []).filter(t => t).map(t => `<option value="${esc(t)}" ${rec.absenceType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    at.value = rec.absenceType || '';
  }
  
  let eNoteEl = document.getElementById('eNote');
  if (eNoteEl) eNoteEl.value = rec.note || '';
  
  if(typeof window.toggleEAT === 'function') window.toggleEAT();
  if(typeof window.toggleCustomField === 'function') window.toggleCustomField();
  
  let editM = document.getElementById('editM');
  if(editM) {
    editM.classList.remove('hidden');
    editM.classList.add('flex');
  }
};

window.closeEdit=function(){
  let editM = document.getElementById('editM');
  if(editM) {
    editM.classList.add('hidden');
    editM.classList.remove('flex');
  }
};

window.toggleEAT=function(){
  let el = document.getElementById('eATW');
  if(el) el.style.display = document.getElementById('eSt').value === 'absent' ? 'block' : 'none';
};

window.toggleCustomField=function(){
  let el = document.getElementById('eCustomW');
  if(el) el.style.display = (document.getElementById('eSt')?.value === 'custom') ? 'block' : 'none';
};

window.saveEdit=async function(){
  if(!acquireActionLock('saveEdit')) return;
  try {
    let eIdEl = document.getElementById('eId');
    if(!eIdEl) return;
    let id = eIdEl.value || uuid();
    let dateInput = document.getElementById('eDate')?.value;
    let date = dateInput ? isoToSlash(dateInput) : (eIdEl.dataset?.date || '');
    if (!date) {
      toast('يرجى تحديد التاريخ', 'err');
      return;
    }
    let normDate = normalizeSlashDate(date);
    
    let rec = await RECDB.get(normDate);
    if (!rec) {
      rec = {
        id: id,
        date: normDate,
        auto: false
      };
    }
    
    rec.id = id;
    rec.date = normDate;
    rec.checkIn = (document.getElementById('eCI')?.value || '').trim() || null;
    rec.checkOut = (document.getElementById('eCO')?.value || '').trim() || null;
    rec.status = document.getElementById('eSt')?.value || 'present';
    if (rec.status === 'custom') {
      rec.status = (document.getElementById('eCustom')?.value || '').trim().slice(0, 50) || 'حالة مخصصة';
    }
    rec.absenceType = rec.status === 'absent' ? ((document.getElementById('eAT')?.value || '').trim().slice(0, 100)) : '';
    rec.note = (document.getElementById('eNote')?.value || '').trim().slice(0, 2000);
    rec.auto = false;

    await saveRecord(rec);
    
    // Invalidate month cache so all views reload fresh data
    _monthCacheKey = '';
    
    closeEdit();
    await renderRecords();
    renderHome();
    renderStats();
    toast('<i class="fa-solid fa-check ml-1"></i> تم حفظ السجل بنجاح', 'ok');
  } finally {
    releaseActionLock('saveEdit');
  }
};

window.delRec=async function(){
  if(!acquireActionLock('delRec')) return;
  try {
    let eIdEl = document.getElementById('eId');
    if(!eIdEl) return;
    let id = eIdEl.value;
    let dateInput = document.getElementById('eDate')?.value;
    let eIdElem = document.getElementById('eId');
    let date = dateInput ? isoToSlash(dateInput) : (eIdElem && eIdElem.dataset ? eIdElem.dataset.date : (eIdElem ? eIdElem.getAttribute('data-date') : ''));
    if (!date) { closeEdit(); return; }
    let normDate = normalizeSlashDate(date);
    
    let deleted = await RECDB.get(normDate);
    if (!deleted) {
      let all = await RECDB.getAll();
      deleted = (all || []).find(r => r.id === id || r.date === normDate);
    }
    if (!deleted) { closeEdit(); return; }
    
    let d = new Date(slashToISO(deleted.date));
    let restoredRec = {
      id: uuid(),
      date: deleted.date,
      checkIn: null,
      checkOut: null,
      auto: true
    };
    
    if (isHoliday(d)) {
      restoredRec.status = 'إجازة';
      restoredRec.absenceType = '';
      restoredRec.note = getHolidayLabel(d);
    } else if (!isWorkDay(d)) {
      restoredRec.status = 'إجازة';
      restoredRec.absenceType = '';
      restoredRec.note = 'إجازة أسبوعية';
    } else {
      restoredRec.status = 'absent';
      restoredRec.absenceType = '';
      restoredRec.note = '';
    }
    
    // Also remove any compensation records tied to this day
    if (settings.compensations && settings.compensations.length > 0) {
      settings.compensations = settings.compensations.filter(c => c.date !== deleted.date && c.sourceDate !== deleted.date);
      saveSettings();
    }
    
    await saveRecord(restoredRec);
    _monthCacheKey = '';
    closeEdit();
    await renderRecords();
    renderHome();
    renderStats();
    if (typeof renderCompensation === 'function') await renderCompensation();
    
    showUndoable('<i class="fa-solid fa-rotate-left ml-1"></i> تم إعادة ضبط السجل وإلغاء بيانات الدوام', async () => {
      await saveRecord(deleted);
      _monthCacheKey = '';
      await renderRecords();
      renderHome();
      renderStats();
      if (typeof renderCompensation === 'function') await renderCompensation();
    });
  } finally {
    releaseActionLock('delRec');
  }
};

// ── Travel Assignment Management System ─────────────────────
var currentTravelTab = 'new';

window.openTravelM = async function(initialTab = 'new') {
  const d = new Date();
  const todayISO = d.toISOString().split('T')[0];
  let startEl = document.getElementById('travelStart');
  let endEl = document.getElementById('travelEnd');
  let noteEl = document.getElementById('travelNote');
  let destEl = document.getElementById('travelDestination');
  
  if (startEl && (!startEl.value || initialTab === 'new')) startEl.value = todayISO;
  if (endEl && (!endEl.value || initialTab === 'new')) endEl.value = todayISO;
  if (noteEl && initialTab === 'new') noteEl.value = '';
  if (destEl && initialTab === 'new') destEl.value = '';
  
  if (typeof window.calcTravelDays === 'function') window.calcTravelDays();
  if (typeof window.switchTravelTab === 'function') window.switchTravelTab(initialTab);
  
  let modal = document.getElementById('travelM');
  if(modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

window.closeTravelM = function() {
  let modal = document.getElementById('travelM');
  if(modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.switchTravelTab = function(tab) {
  currentTravelTab = tab;
  
  document.querySelectorAll('#travelM .btn-sub-tab').forEach(btn => btn.classList.remove('active'));
  let activeBtn = document.getElementById('travelTabBtn-' + tab);
  if(activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('#travelM .travel-pane').forEach(p => p.classList.add('hidden'));
  let activePane = document.getElementById('travelPane-' + tab);
  if(activePane) activePane.classList.remove('hidden');

  if(tab === 'history') {
    renderTravelAssignmentsList();
  } else if(tab === 'stats') {
    renderTravelStats();
  }
};

window.setQuickTravelDays = function(days) {
  let startEl = document.getElementById('travelStart');
  let endEl = document.getElementById('travelEnd');
  if(!startEl || !endEl) return;
  let startVal = startEl.value;
  let startD = startVal ? new Date(startVal) : new Date();
  if (isNaN(startD.getTime())) startD = new Date();
  let endD = new Date(startD);
  endD.setDate(startD.getDate() + (parseInt(days)||1) - 1);
  if (isNaN(endD.getTime())) endD = new Date();
  startEl.value = startD.toISOString().split('T')[0];
  endEl.value = endD.toISOString().split('T')[0];
  if (typeof calcTravelDays === 'function') calcTravelDays();
};

window.calcTravelDays = function() {
  const start = document.getElementById('travelStart')?.value;
  const end = document.getElementById('travelEnd')?.value;
  const info = document.getElementById('travelDaysInfo');
  const count = document.getElementById('travelDaysCount');
  if (start && end) {
    const startD = new Date(start);
    const endD = new Date(end);
    const diff = Math.round((endD - startD) / (1000 * 60 * 60 * 24)) + 1;
    if (diff > 0) {
      if(count) count.textContent = diff;
      if(info) info.classList.remove('hidden');
    } else {
      if(count) count.textContent = '0';
    }
  }
};

window.saveTravelAssignment = async function() {
  if (!acquireActionLock('saveTravel')) return;
  try {
    const start = document.getElementById('travelStart')?.value;
    const end = document.getElementById('travelEnd')?.value;
    const destination = (document.getElementById('travelDestination')?.value || '').trim().slice(0, 200);
    const note = (document.getElementById('travelNote')?.value || '').trim().slice(0, 1000);

    if (!start) return toast('يرجى تحديد تاريخ البدء', 'err');
    if (!end) return toast('يرجى تحديد تاريخ الانتهاء', 'err');

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return toast('صيغة التاريخ غير صالحة', 'err');
    if (endDate < startDate) return toast('تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء', 'err');

    const days = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    if (days <= 0) return toast('فترة التكليف غير صالحة', 'err');
    if (days > 365) return toast('فترة التكليف يجب ألا تتجاوز 365 يوماً', 'err');
    
    toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري حفظ التكليف...`, `ok`);

    let assignmentId = uuid();
    let fullNote = destination ? (note ? `${destination} - ${note}` : destination) : note;

    // Save in settings travelAssignments array
    settings.travelAssignments = settings.travelAssignments || [];
    settings.travelAssignments.push({
      id: assignmentId,
      startDate: start,
      endDate: end,
      days: days,
      destination: destination,
      note: note,
      createdAt: new Date().toISOString()
    });
    saveSettings();

    for (let i = 0; i < days; i++) {
      let current = new Date(startDate);
      current.setDate(startDate.getDate() + i);
      let d = current.getDate();
      let m = current.getMonth() + 1;
      let y = current.getFullYear();
      let slashDate = makeDateKey(y, m-1, d);

      let rec = await RECDB.get(slashDate);
      if (!rec) {
        rec = records.find(r => r.date === slashDate);
      }
      
      if (rec) {
        rec.status = 'تكليف سفر';
        rec.checkIn = null;
        rec.checkOut = null;
        rec.absenceType = '';
        rec.note = fullNote;
        rec.auto = false;
        rec.travelAssignmentId = assignmentId;
      } else {
        rec = {
          id: uuid(),
          date: slashDate,
          status: 'تكليف سفر',
          checkIn: null,
          checkOut: null,
          absenceType: '',
          note: fullNote,
          auto: false,
          travelAssignmentId: assignmentId
        };
        records.push(rec);
      }
      await saveRecord(rec);
    }

    _monthCacheKey = '';
    await renderRecords();
    renderHome();
    renderStats();
    
    // Switch to history tab so user sees their new assignment right away
    switchTravelTab('history');
    toast(`<i class="fa-solid fa-plane-departure ml-1"></i> تم تسجيل تكليف السفر (${days} أيام) بنجاح`, `ok`);
  } finally {
    releaseActionLock('saveTravel');
  }
};

window.deleteTravelAssignment = async function(assignmentId) {
  if (!acquireActionLock('delTravel')) return;
  try {
    let list = settings.travelAssignments || [];
    let item = list.find(x => x.id === assignmentId);
    
    if (!confirm(`هل أنت متأكد من إلغاء وحذف تكليف السفر؟ سيتم استعادة الأيام في سجل الحضور والغياب.`)) {
      return;
    }
    
    toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري حذف التكليف...`, `ok`);
    
    if (item) {
      let startDate = new Date(item.startDate);
      let endDate = new Date(item.endDate);
      let days = (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) ? Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1 : 0;
      
      for (let i = 0; i < days; i++) {
        let current = new Date(startDate);
        current.setDate(startDate.getDate() + i);
        let slashDate = makeDateKey(current.getFullYear(), current.getMonth(), current.getDate());
        
        let rec = await RECDB.get(slashDate);
        if (rec && rec.status === 'تكليف سفر') {
          let d = new Date(current.getFullYear(), current.getMonth(), current.getDate());
          if (isHoliday(d)) {
            rec.status = 'إجازة';
            rec.absenceType = '';
            rec.note = getHolidayLabel(d);
            rec.auto = true;
            rec.travelAssignmentId = null;
            await saveRecord(rec);
          } else if (!isWorkDay(d)) {
            rec.status = 'إجازة';
            rec.absenceType = '';
            rec.note = 'إجازة أسبوعية';
            rec.auto = true;
            rec.travelAssignmentId = null;
            await saveRecord(rec);
          } else {
            rec.status = 'absent';
            rec.absenceType = '';
            rec.note = '';
            rec.auto = true;
            rec.travelAssignmentId = null;
            await saveRecord(rec);
          }
        }
      }
      
      settings.travelAssignments = settings.travelAssignments.filter(x => x.id !== assignmentId);
      saveSettings();
    }
    
    _monthCacheKey = '';
    await fillAbsences();
    await renderRecords();
    renderHome();
    renderStats();
    renderTravelAssignmentsList();
    renderTravelStats();
    toast(`تم حذف تكليف السفر بنجاح واستعادة السجلات`, `ok`);
  } finally {
    releaseActionLock('delTravel');
  }
};

window.goToTravelRange = async function(startISO, endISO) {
  closeTravelM();
  if (window.switchRecordsView) switchRecordsView('attendance');
  
  let pFilter = document.getElementById('periodFilter');
  if (pFilter) pFilter.value = 'custom';
  
  let ds = document.getElementById('dateStart');
  let de = document.getElementById('dateEnd');
  if (ds) ds.value = startISO;
  if (de) de.value = endISO;
  
  let fc = document.getElementById('filterCustom');
  let fs = document.getElementById('filterSpecific');
  if (fc) fc.classList.remove('hidden');
  if (fs) fs.classList.add('hidden');
  
  let sf = document.getElementById('statusFilter');
  if (sf) sf.value = 'travel';
  
  periodMode = 'custom';
  await renderRecords();
  go('records');
};

var _renderTravelDebounceTimer = null;
function debouncedRenderTravelAssignmentsList(delay = 150) {
  if (_renderTravelDebounceTimer) clearTimeout(_renderTravelDebounceTimer);
  _renderTravelDebounceTimer = setTimeout(() => {
    renderTravelAssignmentsList();
  }, delay);
}
window.debouncedRenderTravelAssignmentsList = debouncedRenderTravelAssignmentsList;

async function renderTravelAssignmentsList() {
  let container = document.getElementById('travelListContainer');
  if (!container) return;
  
  let q = (document.getElementById('travelHistorySearch')?.value || '').toLowerCase().trim();
  let list = settings.travelAssignments ? [...settings.travelAssignments] : [];
  
  // Sort newest start date first
  list.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  
  if (q) {
    list = list.filter(item => {
      let text = `${item.destination || ''} ${item.note || ''} ${item.startDate || ''} ${item.endDate || ''}`.toLowerCase();
      return text.includes(q);
    });
  }
  
  if (!list.length) {
    container.innerHTML = `
      <div class="text-center py-10 opacity-60 text-xs">
        <div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-purple-500/10 text-purple-500 text-xl mb-2">
          <i class="fa-solid fa-plane-departure"></i>
        </div>
        <p class="font-bold text-sm mb-1">لا توجد تكاليف سفر مسجلة</p>
        <p class="text-[10px] opacity-70">أضف تكليفاً جديداً من تبويبة «تكليف جديد» أعلاه</p>
      </div>
    `;
    return;
  }
  
  let todayISO = new Date().toISOString().split('T')[0];
  
  container.innerHTML = list.map(item => {
    let startD = new Date(item.startDate);
    let endD = new Date(item.endDate);
    let startSlash = isoToSlash(item.startDate);
    let endSlash = isoToSlash(item.endDate);
    let startDayName = DAYS[startD.getDay()] || '';
    let endDayName = DAYS[endD.getDay()] || '';
    
    let isCurrent = todayISO >= item.startDate && todayISO <= item.endDate;
    let isFuture = todayISO < item.startDate;
    let isPast = todayISO > item.endDate;
    
    let statusBadge = isCurrent ? 
      `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><i class="fa-solid fa-circle text-[6px] animate-ping"></i> ساري حالياً</span>` :
      (isFuture ? 
        `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-500/15 text-blue-600 dark:text-blue-400">قادم</span>` :
        `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/15 text-slate-600 dark:text-slate-400">مكتمل</span>`
      );
      
    let title = item.destination || (item.note ? item.note.split('\n')[0] : 'تكليف سفر رسمي');
    let extraNote = item.note && item.destination ? item.note : '';
    
    return `
      <div class="comp-list-item" style="border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 16px; padding: 14px;">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-start gap-2.5">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center bg-purple-500/15 text-purple-600 dark:text-purple-400 text-xs shrink-0 mt-0.5">
              <i class="fa-solid fa-plane-departure"></i>
            </span>
            <div>
              <div class="font-black text-xs text-slate-800 dark:text-slate-100">${esc(title)}</div>
              <div class="text-[11px] opacity-75 font-semibold mt-0.5">
                من ${startDayName} <span dir="ltr">${startSlash}</span> إلى ${endDayName} <span dir="ltr">${endSlash}</span>
              </div>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1">
            ${statusBadge}
            <span class="text-[10px] font-black px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              ${item.days} ${item.days === 1 ? 'يوم' : item.days === 2 ? 'يومان' : item.days <= 10 ? 'أيام' : 'يوماً'}
            </span>
          </div>
        </div>

        ${extraNote ? `<div class="text-[10px] opacity-70 bg-slate-500/5 p-2 rounded-lg mt-1 font-['Amiri'] leading-relaxed"><i class="fa-solid fa-info-circle ml-1"></i> ${esc(extraNote)}</div>` : ''}

        <div class="flex items-center justify-between border-t pt-2 mt-1" style="border-color: var(--c-border)">
          <button onclick="goToTravelRange('${item.startDate}', '${item.endDate}')" class="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5 cursor-pointer">
            <i class="fa-solid fa-table-list text-xs"></i>
            <span>عرض بالسجلات</span>
            <i class="fa-solid fa-arrow-left text-[9px]"></i>
          </button>
          
          <button onclick="deleteTravelAssignment('${item.id}')" class="text-xs font-bold text-red-600 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-1 cursor-pointer">
            <i class="fa-solid fa-trash-can text-xs"></i>
            <span>إلغاء التكليف</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function renderTravelStats() {
  let container = document.getElementById('travelStatsContainer');
  if (!container) return;
  
  let list = settings.travelAssignments || [];
  let totalMissions = list.length;
  let totalDays = list.reduce((s, i) => s + (i.days || 0), 0);
  
  let todayISO = new Date().toISOString().split('T')[0];
  let activeMissions = list.filter(i => todayISO >= i.startDate && todayISO <= i.endDate).length;
  
  container.innerHTML = `
    <div class="grid grid-cols-3 gap-2.5 text-center mb-4">
      <div class="p-3 rounded-2xl" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
        <div class="text-xl font-black text-purple-600 dark:text-purple-400">${totalMissions}</div>
        <div class="text-[10px] opacity-60 font-bold">إجمالي المهام</div>
      </div>
      <div class="p-3 rounded-2xl" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
        <div class="text-xl font-black text-blue-600 dark:text-blue-400">${totalDays}</div>
        <div class="text-[10px] opacity-60 font-bold">أيام التكليف</div>
      </div>
      <div class="p-3 rounded-2xl" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
        <div class="text-xl font-black text-emerald-600 dark:text-emerald-400">${activeMissions}</div>
        <div class="text-[10px] opacity-60 font-bold">مهام نشطة حالياً</div>
      </div>
    </div>

    <div class="p-3.5 rounded-2xl space-y-2 text-xs font-bold" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
      <div class="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-black">
        <i class="fa-solid fa-circle-info"></i>
        <span>معلومات عن احتساب تكاليف السفر:</span>
      </div>
      <ul class="list-disc pr-4 space-y-1 opacity-75 font-normal text-[11px] leading-relaxed">
        <li>أيام تكليف السفر تُحتسب كأيام حضور ومهمة رسمية كاملة معفاة من التأخير أو الغياب.</li>
        <li>يمكنك النقر على أي تكليف لعرض أيامه في جدول السجلات فوراً.</li>
        <li>يمكنك إلغاء أو حذف أي تكليف في أي وقت لاستعادة حالة السجلات الطبيعية.</li>
      </ul>
    </div>
  `;
}


// ── Stats page ────────────────────────────────────────────
async function renderStats(){
  let yr=viewYear;
  let recs = await RECDB.getYear(yr);
  let bal = await calcOvertimeBalance();
  recs = (recs || []).filter(r => {
    if (!r || typeof r !== 'object' || !r.date || typeof r.date !== 'string') return false;
    let parts = r.date.split('/');
    return parts.length === 3 && Number(parts[2]) === yr;
  });
  let p=0,a=0,l=0,t=0,early=0,extra=0,tmEarly=0,tmExtra=0,tmLate=0,monthly=Array(12).fill(0).map(()=>({p:0,a:0,l:0,t:0}));
  let usedCompensations = settings.compensations || [];
  
  recs.forEach(r=>{
    if (!r || !r.date) return;
    let d=new Date(slashToISO(r.date));
    if (isNaN(d.getTime())) return;
    let sch=getSchedule(d.getFullYear(),d.getMonth(),d),mo=d.getMonth();
    let isHol = isHoliday(d) || !isWorkDay(d);
    
    let actuallyWorked = isPresent(r.status) || (isHol && r.checkIn);
    
    if(actuallyWorked){
      p++; monthly[mo].p++;
      
      let isLateComp = usedCompensations.some(c => c && c.date === r.date && c.type === 'late');
      let isEarlyComp = usedCompensations.some(c => c && c.date === r.date && c.type === 'early');
      
      let lm = 0, em = 0, ex = 0;
      
      if (isHol && r.checkIn && r.checkOut) {
        let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, _em] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
        ex = (eh*60+_em) - (sh*60+sm);
        if (ex < 0) ex += 1440;
      } else if (isPresent(r.status)) {
        lm = isLateComp ? 0 : lateMin(r.checkIn,sch.start);
        em = isEarlyComp ? 0 : (r.checkOut ? earlyMin(r.checkOut,sch.end) : 0);
        ex = r.checkOut ? extraMin(r.checkOut,sch.overtimeStart) : 0;
      }
      
      if(lm>0){ l++; monthly[mo].l++; tmLate+=lm; }
      if(em>0){ early++; tmEarly+=em; }
      if(ex>0){ extra++; tmExtra+=ex; }
    }
    else if(r.status===`absent`){ a++; monthly[mo].a++; }
    else if(r.status===`تكليف سفر`){ t++; monthly[mo].t++; }
  });
  let total=p+a,pct=total?Math.round(p/total*100):0;
  
  // Refined Status Summary Cards (Using Theme Variables)
  let sc = document.getElementById(`statsSumCards`); if(sc) sc.innerHTML=`
    <div class="glass-surface p-4 text-center rounded-2xl shadow-sm border-r-4 border-r-emerald-500 hover:scale-105 trans">
      <div class="text-2xl font-black mb-1" style="color:var(--stat-present-text, var(--c-accent-txt))">${p}</div>
      <div class="text-[10px] uppercase tracking-tighter font-black opacity-50">الحضور</div>
    </div>
    <div class="glass-surface p-4 text-center rounded-2xl shadow-sm border-r-4 border-r-red-500 hover:scale-105 trans">
      <div class="text-2xl font-black mb-1" style="color:var(--stat-absent-text, #ef4444)">${a}</div>
      <div class="text-[10px] uppercase tracking-tighter font-black opacity-50">الغياب</div>
    </div>
    ${t>0 ? `<div class="glass-surface p-4 text-center rounded-2xl shadow-sm border-r-4 border-r-purple-500 hover:scale-105 trans">
      <div class="text-2xl font-black mb-1" style="color:#a855f7">${t}</div>
      <div class="text-[10px] uppercase tracking-tighter font-black opacity-50">تكليف سفر</div>
    </div>` : `<div class="glass-surface p-4 text-center rounded-2xl shadow-sm border-r-4 border-r-amber-500 hover:scale-105 trans">
      <div class="text-2xl font-black mb-1" style="color:var(--stat-late-text, #f59e0b)">${l}</div>
      <div class="text-[10px] uppercase tracking-tighter font-black opacity-50">التأخير</div>
    </div>`}
    <div class="glass-surface p-4 text-center rounded-2xl shadow-sm border-r-4 ${pct>=80?`border-r-emerald-500`:`border-r-red-500`} hover:scale-105 trans">
      <div class="text-2xl font-black mb-1 text-number" style="color:var(--c-text)">${pct}%</div>
      <div class="text-[10px] uppercase tracking-tighter font-black opacity-50">الالتزام</div>
    </div>`;

  let pr = document.getElementById(`personalRecords`); if(pr) pr.innerHTML=`
    <div class="flex justify-between items-center py-3 border-b border-white/5 dark:border-white/5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500/10 text-amber-500"><i class="fa-solid fa-clock"></i></div>
        <div><div class="text-sm font-black" style="color:var(--c-text)">تأخير صباحي</div><div class="text-[10px] opacity-50">إجمالي الوقت</div></div>
      </div>
      <div class="text-right">
        <div class="font-black text-sm" style="color:var(--stat-late-text)">${l} أيام</div>
        <div class="text-[10px] font-bold opacity-60">${formatMin(tmLate)}</div>
      </div>
    </div>
    <div class="flex justify-between items-center py-3 border-b border-white/5 dark:border-white/5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/10 text-red-500"><i class="fa-solid fa-person-running"></i></div>
        <div><div class="text-sm font-black" style="color:var(--c-text)">خروج مبكر</div><div class="text-[10px] opacity-50">إجمالي الوقت</div></div>
      </div>
      <div class="text-right">
        <div class="font-black text-sm" style="color:var(--stat-absent-text)">${early} أيام</div>
        <div class="text-[10px] font-bold opacity-60">${formatMin(tmEarly)}</div>
      </div>
    </div>
    <div class="flex justify-between items-center py-3 border-b border-white/5 dark:border-white/5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-500"><i class="fa-solid fa-business-time"></i></div>
        <div><div class="text-sm font-black" style="color:var(--c-text)">دوام إضافي</div><div class="text-[10px] opacity-50">إجمالي الوقت</div></div>
      </div>
      <div class="text-right">
        <div class="font-black text-sm text-blue-500">${extra} أيام</div>
        <div class="text-[10px] font-bold opacity-60">${formatMin(tmExtra)}</div>
      </div>
    </div>
    <div class="flex justify-between items-center py-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-500"><i class="fa-solid fa-scale-balanced"></i></div>
        <div><div class="text-sm font-black" style="color:var(--c-text)">رصيد الإضافي المتبقي</div><div class="text-[10px] opacity-50">الرصيد المتاح</div></div>
      </div>
      <div class="text-right">
        <div class="font-black text-sm text-emerald-500">${formatMin(bal.balance)}</div>
      </div>
    </div>`;

  if(window.Chart){
    const cp=stClr(`p`), ca=stClr(`a`), cl=stClr(`l`), cb=stClr(`o`);
    const textColor2 = (settings && settings.dark) ? '#94a3b8' : '#64748b';
    
    let pieEl = document.getElementById(`pieChart`);
    if(pieEl) {
      if(chartInstances.p) { try { chartInstances.p.destroy(); } catch(e){} chartInstances.p = null; }
      try {
        chartInstances.p=new Chart(pieEl,{type:`doughnut`,data:{labels:[`حضور`,`تأخير`,`غياب`],datasets:[{data:[p-l,l,a],backgroundColor:[cp,cl,ca],borderWidth:0,hoverOffset:10}]},options:{responsive:true,cutout:`75%`,plugins:{legend:{position:`bottom`,labels:{padding:20,font:{family:`Cairo`,size:11,weight:'600'},color:textColor2}}}}});
      } catch(e){}
    }
    
    let barEl = document.getElementById(`barChart`);
    if(barEl) {
      if(chartInstances.b) { try { chartInstances.b.destroy(); } catch(e){} chartInstances.b = null; }
      try {
        chartInstances.b=new Chart(barEl,{type:`bar`,data:{labels:[`حضور`,`تأخير`,`غياب`],datasets:[{label:`الأيام`,data:[p,l,a],backgroundColor:[cp,cl,ca],borderRadius:8,hoverBackgroundColor:[cp,cl,ca]}]},options:{responsive:true,scales:{y:{display:false},x:{grid:{display:false},ticks:{color:stClr('o'),font:{weight:'bold'}}}},plugins:{legend:{display:false}}}});
      } catch(e){}
    }
    
    let trendEl = document.getElementById(`trendChart`);
    if(trendEl) {
      if(chartInstances.t) { try { chartInstances.t.destroy(); } catch(e){} chartInstances.t = null; }
      try {
        chartInstances.t=new Chart(trendEl,{type:`line`,data:{labels:MONTHS.map(m=>m.substring(0,3)),datasets:[{label:`حضور`,data:monthly.map(m=>m.p),borderColor:cp,backgroundColor:cp+`20`,fill:true,tension:0.4,pointRadius:0,borderWidth:3},{label:`غياب`,data:monthly.map(m=>m.a),borderColor:ca,backgroundColor:ca+`20`,fill:true,tension:0.4,pointRadius:0,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{grid:{display:false},ticks:{font:{size:9},color:cb,font:{weight:'bold'}}},y:{display:false,min:0}},plugins:{legend:{display:false}},interaction:{mode:`index`,intersect:false}}});
      } catch(e){}
    }
  }
}
window.renderStats=renderStats;

// ── Overtime Compensation System ──────────────────────────
var currentCompSubTab = 'overtime';

async function calcOvertimeBalance() {
  let allRecs = await RECDB.getAll();
  let totalExtra = 0, totalUsed = 0;
  let extraDays = [], lateDays = [], earlyDays = [];
  let usedCompensations = settings.compensations || [];
  
  // Pre-index compensations by sourceDate and target date for O(1) lookups
  let compBySourceDate = new Map();
  let compByTargetDateType = new Map();
  
  usedCompensations.forEach(c => {
    if (c.sourceDate) {
      if (!compBySourceDate.has(c.sourceDate)) compBySourceDate.set(c.sourceDate, []);
      compBySourceDate.get(c.sourceDate).push(c);
    }
    if (Array.isArray(c.sourceDetails)) {
      c.sourceDetails.forEach(sd => {
        if (sd && sd.date) {
          if (!compBySourceDate.has(sd.date)) compBySourceDate.set(sd.date, []);
          compBySourceDate.get(sd.date).push({ ...c, minutes: sd.minutes, sourceDate: sd.date });
        }
      });
    }
    if (c.date && c.type) {
      compByTargetDateType.set(`${c.date}_${c.type}`, c);
    }
  });

  allRecs.forEach(r => {
    let d = new Date(slashToISO(r.date));
    let sch = getSchedule(d.getFullYear(), d.getMonth(), d);
    let isHol = isHoliday(d) || !isWorkDay(d) || r.status === 'إجازة رسمية' || r.status === 'إجازة' || r.status === 'إجازة أسبوعية';
    
    if (!isPresent(r.status) && !isHol) return;
    if (!r.checkIn) return; // Must have checkIn
    
    let ex = 0, lm = 0, em = 0;
    
    if (isHol && r.checkIn && r.checkOut) {
      // If worked on a holiday/weekend, the entire duration is extra
      let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, em_m] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
      ex = (eh*60+em_m) - (sh*60+sm);
      if(ex < 0) ex += 1440;
    } else if (isPresent(r.status)) {
      // Calculate late minutes
      lm = lateMin(r.checkIn, sch.start);
      // Calculate early departure minutes
      em = r.checkOut ? earlyMin(r.checkOut, sch.end) : 0;
      // Calculate overtime (extra) minutes
      ex = r.checkOut && sch.overtimeStart ? extraMin(r.checkOut, sch.overtimeStart) : 0;
      if(ex <= 0 && r.checkOut) {
        let outArr = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
        let endStr = (sch.overtimeStart || sch.end || "16:00");
        let endArr = (endStr.includes(":") ? endStr : "16:00").split(":").map(Number);
        let outM = outArr[0]*60 + outArr[1];
        let endM = endArr[0]*60 + endArr[1];
        if(outM > endM) ex = outM - endM;
      }
    }
    
    let dayName = DAYS[d.getDay()] || '';
    let typeLabel = isHoliday(d) ? getHolidayLabel(d) : (!isWorkDay(d) ? 'عطلة أسبوعية' : 'يوم عمل اعتيادي');
    
    if (ex > 0) {
      totalExtra += ex;
      let dayCompensations = compBySourceDate.get(r.date) || [];
      let usedFromDay = dayCompensations.reduce((sum, c) => sum + (c.minutes || 0), 0);
      let remaining = Math.max(0, ex - usedFromDay);
      
      extraDays.push({
        id: r.id,
        date: r.date,
        minutes: ex,
        usedMinutes: usedFromDay,
        remainingMinutes: remaining,
        usageDetails: dayCompensations,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        isHoliday: isHol,
        typeLabel: typeLabel,
        overtimeStart: sch.overtimeStart || sch.end,
        dayName: dayName
      });
    }
    if (lm > 0) {
      let comp = compByTargetDateType.get(`${r.date}_late`);
      lateDays.push({
        id: r.id,
        date: r.date,
        minutes: lm,
        compensated: !!comp,
        sourceDate: comp ? comp.sourceDate : null,
        checkIn: r.checkIn,
        dayName: dayName
      });
    }
    if (em > 0) {
      let comp = compByTargetDateType.get(`${r.date}_early`);
      earlyDays.push({
        id: r.id,
        date: r.date,
        minutes: em,
        compensated: !!comp,
        sourceDate: comp ? comp.sourceDate : null,
        checkOut: r.checkOut,
        dayName: dayName
      });
    }
  });
  
  // Sort newest first
  extraDays.sort((a,b) => slashToISO(b.date).localeCompare(slashToISO(a.date)));
  lateDays.sort((a,b) => slashToISO(b.date).localeCompare(slashToISO(a.date)));
  earlyDays.sort((a,b) => slashToISO(b.date).localeCompare(slashToISO(a.date)));
  
  // Total used from compensations store
  totalUsed = usedCompensations.reduce((s, c) => s + (c.minutes || 0), 0);
  
  return { totalExtra, totalUsed, balance: totalExtra - totalUsed, extraDays, lateDays, earlyDays };
}
window.calcOvertimeBalance = calcOvertimeBalance;

function formatCompSourceText(comp, shortFormat = false) {
  if (!comp) return '';
  if (comp.sourceDate) {
    return `من رصيد إضافي يوم ${comp.sourceDate}`;
  }
  if (Array.isArray(comp.sourceDetails) && comp.sourceDetails.length > 0) {
    if (comp.sourceDetails.length === 1) {
      let sd = comp.sourceDetails[0];
      return `من رصيد إضافي يوم ${sd.date}${sd.minutes ? ` (${formatMin(sd.minutes)})` : ''}`;
    }
    let firstD = comp.sourceDetails[0].date;
    let lastD = comp.sourceDetails[comp.sourceDetails.length - 1].date;
    let breakdown = comp.sourceDetails.map(sd => `${sd.date} (${formatMin(sd.minutes)})`).join(' ، ');
    
    if (shortFormat) {
      return `من إضافي (${firstD} إلى ${lastD})`;
    }
    return `من إضافي (${firstD} إلى ${lastD}) [${breakdown}]`;
  }
  return 'من رصيد الإضافي';
}
window.formatCompSourceText = formatCompSourceText;

window.switchCompSubTab = function(tab) {
  currentCompSubTab = tab;
  document.querySelectorAll('.btn-sub-tab').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll(`[id="compTabBtn-${tab}"]`).forEach(btn => btn.classList.add('active'));
  
  renderCompensationList();
};

var _activeCompTarget = null;

window.openCompModal = async function(targetDate, type, minutes) {
  _activeCompTarget = { date: targetDate, type: type, minutes: minutes };
  let bal = await calcOvertimeBalance();
  
  let modal = document.getElementById('chooseCompSourceM');
  if(!modal) return;
  
  let titleEl = document.getElementById('compModalTitle');
  if(titleEl) {
    titleEl.textContent = type === 'late' ? 'تأكيد تعويض التأخير الصباحي' : 'تأكيد تعويض الخروج المبكر';
  }
  
  let targetDateEl = document.getElementById('compTargetDate');
  if(targetDateEl) targetDateEl.textContent = targetDate;
  
  let targetDurEl = document.getElementById('compTargetDuration');
  if(targetDurEl) targetDurEl.textContent = formatMin(minutes);
  
  let noteInput = document.getElementById('compCustomNote');
  if(noteInput) noteInput.value = '';
  
  let sourceListEl = document.getElementById('compSourceList');
  let validSources = (bal.extraDays || []).filter(d => (d.remainingMinutes || 0) > 0);
  
  if(!validSources.length) {
    sourceListEl.innerHTML = `
      <div class="p-3 text-center rounded-xl text-xs bg-red-500/10 text-red-500 font-bold">
        لا يوجد رصيد إضافي متاح في أي يوم حالياً.
      </div>
    `;
    let btn = document.getElementById('btnConfirmComp');
    if(btn) btn.disabled = true;
    let sumBox = document.getElementById('compSelectedDaySummary');
    if(sumBox) sumBox.classList.add('hidden');
    modal.classList.remove('hidden');
    return;
  }
  
  let btn = document.getElementById('btnConfirmComp');
  if(btn) btn.disabled = false;
  
  let bestMatch = validSources.find(s => s.remainingMinutes >= minutes) || validSources[0];
  
  sourceListEl.innerHTML = validSources.map(src => {
    let isChecked = src.date === bestMatch.date ? 'checked' : '';
    let isEnough = src.remainingMinutes >= minutes;
    return `
      <label class="p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-all hover:bg-black/5 dark:hover:bg-white/5"
        style="border: 1.5px solid ${isChecked ? 'var(--pri)' : 'var(--c-border)'}; background: ${isChecked ? 'var(--c-blue-lt)' : 'var(--c-surface)'}">
        <div class="flex items-center gap-2.5">
          <input type="radio" name="compSourceDateRadio" value="${src.date}" ${isChecked} onchange="onCompSourceChange('${src.date}')" class="w-4 h-4 text-blue-600">
          <div>
            <div class="font-bold text-xs">${src.dayName} ${src.date} <span class="text-[10px] opacity-70 font-normal">(${esc(src.typeLabel)})</span></div>
            <div class="text-[10px] opacity-60">المكتسب: +${formatMin(src.minutes)} | المتاح: <strong class="${isEnough ? 'text-emerald-600' : 'text-amber-600'}">${formatMin(src.remainingMinutes)}</strong></div>
          </div>
        </div>
        <div>
          ${isEnough ? 
            `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">يكفي</span>` :
            `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500">رصيد جزئي</span>`
          }
        </div>
      </label>
    `;
  }).join('');
  
  onCompSourceChange(bestMatch.date);
  modal.classList.remove('hidden');
};

window.closeCompModal = function() {
  let modal = document.getElementById('chooseCompSourceM');
  if(modal) modal.classList.add('hidden');
  _activeCompTarget = null;
};

window.onCompSourceChange = async function(selectedDate) {
  let bal = await calcOvertimeBalance();
  let src = (bal.extraDays || []).find(d => d.date === selectedDate);
  if(!src || !_activeCompTarget) return;
  
  let sumBox = document.getElementById('compSelectedDaySummary');
  let availEl = document.getElementById('compSourceAvail');
  let remEl = document.getElementById('compSourceRemaining');
  
  if(sumBox) sumBox.classList.remove('hidden');
  if(availEl) availEl.textContent = formatMin(src.remainingMinutes);
  
  let rem = src.remainingMinutes - _activeCompTarget.minutes;
  if(remEl) {
    remEl.textContent = rem >= 0 ? formatMin(rem) : `غير كافٍ (ينقص ${formatMin(Math.abs(rem))})`;
    remEl.style.color = rem >= 0 ? 'var(--c-success, #10b981)' : 'var(--c-danger, #ef4444)';
  }
};

window.confirmCompensation = async function() {
  if(!_activeCompTarget) return;
  let radios = document.getElementsByName('compSourceDateRadio');
  let selectedDate = null;
  for(let r of radios) { if(r.checked) { selectedDate = r.value; break; } }
  
  if(!selectedDate) return toast('يرجى اختيار يوم الإضافي للخصم منه', 'err');
  
  let bal = await calcOvertimeBalance();
  let src = (bal.extraDays || []).find(d => d.date === selectedDate);
  if(!src) return toast('لم يتم العثور على يوم الإضافي المختار', 'err');
  
  if(src.remainingMinutes < _activeCompTarget.minutes) {
    if(!confirm(`رصيد يوم ${selectedDate} المتبقي (${formatMin(src.remainingMinutes)}) أقل من المطلوب (${formatMin(_activeCompTarget.minutes)}). هل تريد المتابعة وخصم الرصيد المتوفر؟`)) {
      return;
    }
  }
  
  let note = document.getElementById('compCustomNote')?.value || '';
  
  settings.compensations.push({
    id: uuid(),
    date: _activeCompTarget.date,
    type: _activeCompTarget.type,
    minutes: _activeCompTarget.minutes,
    sourceDate: selectedDate,
    note: note,
    createdAt: new Date().toISOString()
  });
  saveSettings();
  
  closeCompModal();
  await renderCompensation();
  renderRecords();
  renderHome();
  renderStats();
  toast(`✅ تم تعويض ${_activeCompTarget.type === 'late' ? 'التأخير' : 'الخروج المبكر'} من رصيد يوم ${selectedDate} بنجاح`, 'ok');
};

window.compensateLate = function(date) {
  let day = (document.getElementById('compListContainer')) ? null : null;
  calcOvertimeBalance().then(bal => {
    let d = bal.lateDays.find(x => x.date === date);
    if(d) openCompModal(date, 'late', d.minutes);
  });
};

window.compensateEarly = function(date) {
  calcOvertimeBalance().then(bal => {
    let d = bal.earlyDays.find(x => x.date === date);
    if(d) openCompModal(date, 'early', d.minutes);
  });
};

window.openOTLeaveM = async function() {
  let todayISO = new Date().toISOString().split('T')[0];
  let dInput = document.getElementById('otLeaveDate');
  if (dInput) dInput.value = todayISO;
  let daysInput = document.getElementById('otLeaveDays');
  if (daysInput) daysInput.value = '1';
  let hInput = document.getElementById('otLeaveHours');
  if (hInput) hInput.value = '8';
  let mInput = document.getElementById('otLeaveMins');
  if (mInput) mInput.value = '0';
  let nInput = document.getElementById('otLeaveNote');
  if (nInput) nInput.value = '';
  
  await updateOTLeaveCalc();
  let modal = document.getElementById('otLeaveM');
  if (modal) modal.classList.remove('hidden');
};

window.closeOTLeaveM = function() {
  let modal = document.getElementById('otLeaveM');
  if (modal) modal.classList.add('hidden');
};

window.onOTLeaveDaysChange = function() {
  let days = parseFloat(document.getElementById('otLeaveDays')?.value) || 0;
  let totalHours = Math.round(days * 8 * 100) / 100;
  let h = Math.floor(totalHours);
  let m = Math.round((totalHours - h) * 60);
  
  let hInput = document.getElementById('otLeaveHours');
  let mInput = document.getElementById('otLeaveMins');
  if (hInput) hInput.value = h;
  if (mInput) mInput.value = m;
  updateOTLeaveCalc();
};

window.onOTLeaveHoursChange = function() {
  let h = parseInt(document.getElementById('otLeaveHours')?.value) || 0;
  let m = parseInt(document.getElementById('otLeaveMins')?.value) || 0;
  let totalMin = Math.max(0, h * 60 + m);
  let days = (totalMin / 480).toFixed(1);
  if (days.endsWith('.0')) days = days.substring(0, days.length - 2);
  
  let daysInput = document.getElementById('otLeaveDays');
  if (daysInput) daysInput.value = days;
  updateOTLeaveCalc();
};

window.setOTLeaveQuickDays = function(d) {
  let daysInput = document.getElementById('otLeaveDays');
  if (daysInput) daysInput.value = d;
  onOTLeaveDaysChange();
};

window.setOTLeaveQuick = function(h, m) {
  let hInput = document.getElementById('otLeaveHours');
  let mInput = document.getElementById('otLeaveMins');
  if (hInput) hInput.value = h;
  if (mInput) mInput.value = m || 0;
  onOTLeaveHoursChange();
};

window.updateOTLeaveCalc = async function() {
  let h = parseInt(document.getElementById('otLeaveHours')?.value) || 0;
  let m = parseInt(document.getElementById('otLeaveMins')?.value) || 0;
  let totalMin = Math.max(0, h * 60 + m);
  
  let costSpan = document.getElementById('otLeaveCost');
  let currentBalSpan = document.getElementById('otLeaveCurrentBal');
  let remSpan = document.getElementById('otLeaveRemaining');
  
  let bal = await calcOvertimeBalance();
  let available = bal ? bal.balance : 0;
  let remaining = available - totalMin;
  
  if (costSpan) costSpan.textContent = formatMin(totalMin);
  if (currentBalSpan) currentBalSpan.textContent = formatMin(available);
  if (remSpan) {
    remSpan.textContent = formatMin(remaining);
    remSpan.style.color = remaining < 0 ? 'var(--c-danger, #ef4444)' : 'var(--c-success, #10b981)';
  }

  // Sort ALL overtime days from OLDEST to NEWEST
  let sortedAsc = [...(bal.extraDays || [])].sort((a,b) => slashToISO(a.date).localeCompare(slashToISO(b.date)));
  
  // Render Full Statement List of Overtime Days (كشف كامل بالأيام)
  let stmtEl = document.getElementById('otLeaveStatementList');
  let countEl = document.getElementById('otLeaveStatementCount');
  if (countEl) countEl.textContent = `(${sortedAsc.length} يوم مسجل)`;
  
  if (stmtEl) {
    if (!sortedAsc.length) {
      stmtEl.innerHTML = `
        <div class="p-4 text-center rounded-2xl text-xs opacity-60 bg-black/5 dark:bg-white/5">
          <i class="fa-solid fa-folder-open text-xl mb-1 block"></i>
          لا توجد أيام إضافي مسجلة في السجلات حالياً.
        </div>
      `;
    } else {
      stmtEl.innerHTML = sortedAsc.map(item => {
        let isDepleted = item.remainingMinutes <= 0;
        if (isDepleted) {
          // Darker / faded style for depleted overtime days
          return `
            <div class="p-3 rounded-2xl flex items-center justify-between text-xs transition-all"
              style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); opacity: 0.75; color: #94a3b8;">
              <div>
                <div class="font-bold flex items-center gap-2">
                  <span class="line-through text-slate-300">${item.dayName} ${item.date}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-800 text-slate-300 border border-slate-700">
                    <i class="fa-solid fa-circle-check text-emerald-400 ml-1"></i> مخصوم بالكامل
                  </span>
                </div>
                <div class="text-[10px] opacity-75 mt-1">
                  الإضافي الأصلي: +${formatMin(item.minutes)} | المستخدم: -${formatMin(item.usedMinutes)}
                </div>
              </div>
              <div class="text-right">
                <span class="text-[10px] opacity-60 block font-normal">المتبقي:</span>
                <span class="text-xs font-black text-slate-400 dir-ltr">0 د</span>
              </div>
            </div>
          `;
        } else {
          // Active card style for available overtime days
          return `
            <div class="p-3.5 rounded-2xl flex items-center justify-between text-xs transition-all hover:border-blue-500/40"
              style="background: var(--c-surface); border: 1px solid var(--c-border);">
              <div>
                <div class="font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                  <span>${item.dayName} ${item.date}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <i class="fa-solid fa-star text-amber-500 ml-1"></i> رصيد متاح
                  </span>
                </div>
                <div class="text-[10px] opacity-70 mt-1 flex items-center gap-2">
                  <span>المكتسب: +${formatMin(item.minutes)}</span>
                  <span>•</span>
                  <span>المستخدم: -${formatMin(item.usedMinutes || 0)}</span>
                </div>
              </div>
              <div class="text-right">
                <span class="text-[10px] opacity-60 block font-normal">المتبقي المتاح:</span>
                <span class="text-xs font-black text-emerald-600 dark:text-emerald-400 dir-ltr">${formatMin(item.remainingMinutes)}</span>
              </div>
            </div>
          `;
        }
      }).join('');
    }
  }

  // Render Automatic FIFO Deduction Breakdown Preview (معاينة الخصم التلقائي من الأقدم)
  let fifoEl = document.getElementById('otLeaveFIFOPreview');
  if (fifoEl) {
    let availableDays = sortedAsc.filter(d => d.remainingMinutes > 0);
    if (!availableDays.length) {
      fifoEl.innerHTML = `
        <div class="p-2.5 text-center text-red-500 font-bold text-xs bg-red-500/10 rounded-xl">
          <i class="fa-solid fa-triangle-exclamation ml-1"></i> لا يوجد أي رصيد إضافي متاح للخصم منه حالياً!
        </div>
      `;
    } else if (totalMin <= 0) {
      fifoEl.innerHTML = `
        <div class="p-2 text-center opacity-60 text-[11px]">
          يرجى تحديد عدد الأيام أو الساعات لمعاينة توزيع الخصم التلقائي.
        </div>
      `;
    } else {
      let remainingNeeded = totalMin;
      let allocations = [];
      for (let d of availableDays) {
        if (remainingNeeded <= 0) break;
        let takeMin = Math.min(d.remainingMinutes, remainingNeeded);
        remainingNeeded -= takeMin;
        allocations.push({
          date: d.date,
          dayName: d.dayName,
          takeMin: takeMin,
          remAfter: d.remainingMinutes - takeMin
        });
      }

      let allocHtml = allocations.map(a => {
        let isFullyDepleted = a.remAfter === 0;
        return `
          <div class="p-2 rounded-xl flex items-center justify-between bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20">
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800 dark:text-slate-100">${a.dayName} ${a.date}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-black ${isFullyDepleted ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-blue-500/20 text-blue-700 dark:text-blue-300'}">
                ${isFullyDepleted ? 'سيصبح مخصوم بالكامل ✂️' : 'خصم جزئي'}
              </span>
            </div>
            <div class="text-right font-black">
              <span class="text-amber-600 dark:text-amber-400">-${formatMin(a.takeMin)}</span>
              <span class="text-[10px] opacity-70 block font-normal">${isFullyDepleted ? 'المتبقي: 0 د' : 'المتبقي: ' + formatMin(a.remAfter)}</span>
            </div>
          </div>
        `;
      }).join('');

      if (remainingNeeded > 0) {
        allocHtml += `
          <div class="p-2 text-center text-red-600 dark:text-red-400 font-bold text-xs bg-red-500/10 border border-red-500/20 rounded-xl mt-1">
            ⚠️ الرصيد المتاح غير كافٍ لتغطية كامل المدة! ينقص ${formatMin(remainingNeeded)}.
          </div>
        `;
      }
      fifoEl.innerHTML = allocHtml;
    }
  }
};
window.calcOTLeaveDays = window.updateOTLeaveCalc;

window.saveOTLeave = async function() {
  if (!acquireActionLock('saveOTLeave')) return;
  try {
    let dateVal = document.getElementById('otLeaveDate')?.value;
    let note = (document.getElementById('otLeaveNote')?.value || '').trim().slice(0, 1000);
    let h = parseInt(document.getElementById('otLeaveHours')?.value) || 0;
    let m = parseInt(document.getElementById('otLeaveMins')?.value) || 0;
    let totalMin = Math.max(0, h * 60 + m);
    
    if(!dateVal) return toast('يرجى تحديد التاريخ', 'err');
    if(totalMin <= 0) return toast('يرجى إدخال عدد أيام أو ساعات أكبر من 0', 'err');
    
    let slashDate = isoToSlash(dateVal);
    let bal = await calcOvertimeBalance();
    if(totalMin > bal.balance) {
      return toast(`رصيد الإضافي غير كافٍ. المطلوب خصم ${formatMin(totalMin)} والرصيد المتاح هو ${formatMin(bal.balance)}`, 'err');
    }
    
    // Perform FIFO Allocation (oldest to newest)
    let sortedAsc = [...(bal.extraDays || [])].sort((a,b) => slashToISO(a.date).localeCompare(slashToISO(b.date)));
    let availableDays = sortedAsc.filter(d => d.remainingMinutes > 0);
    
    let remainingNeeded = totalMin;
    let allocationDetails = [];
    
    for (let d of availableDays) {
      if (remainingNeeded <= 0) break;
      let takeMin = Math.min(d.remainingMinutes, remainingNeeded);
      remainingNeeded -= takeMin;
      allocationDetails.push({
        date: d.date,
        minutes: takeMin
      });
    }
    
    let rec = await RECDB.get(slashDate);
    
    let newComp = {
      id: uuid(),
      date: slashDate,
      type: 'leave',
      minutes: totalMin,
      sourceDetails: allocationDetails,
      note: note,
      createdAt: new Date().toISOString()
    };
    settings.compensations.push(newComp);
    saveSettings();
    
    let sourceDesc = formatCompSourceText(newComp, false);
    let noteText = note ? `${note} (خصم ${formatMin(totalMin)} ${sourceDesc})` : `خصم ${formatMin(totalMin)} ${sourceDesc}`;
    if(rec) {
      rec.status = 'إجازة من الإضافي';
      rec.checkIn = null;
      rec.checkOut = null;
      rec.absenceType = 'إجازة تعويض إضافي';
      rec.note = noteText;
      rec.auto = false;
    } else {
      rec = {
        id: uuid(),
        date: slashDate,
        status: 'إجازة من الإضافي',
        checkIn: null,
        checkOut: null,
        absenceType: 'إجازة تعويض إضافي',
        note: noteText,
        auto: false
      };
    }
    await saveRecord(rec);
    
    // Force cache refresh across month cache and views
    _monthCacheKey = '';
    
    closeOTLeaveM();
    await renderCompensation();
    renderRecords();
    renderHome();
    renderStats();
    toast(`✅ تم خصم ${formatMin(totalMin)} من الأيام الأقدم وتطبيق الإجازة بنجاح`, 'ok');
  } finally {
    releaseActionLock('saveOTLeave');
  }
};

window.undoCompensation = async function(id) {
  if (!acquireActionLock('undoCompensation')) return;
  try {
    let comp = settings.compensations.find(c => c.id === id);
    if(!comp) return;
    
    if(comp.type === 'leave') {
      let rec = await RECDB.get(comp.date);
      if(rec && (rec.status === 'إجازة من الإضافي' || rec.absenceType === 'إجازة تعويض إضافي')) {
        let d = new Date(slashToISO(comp.date));
        if (isHoliday(d)) {
          rec.status = 'إجازة';
          rec.absenceType = '';
          rec.note = getHolidayLabel(d);
          rec.auto = true;
          rec.checkIn = null;
          rec.checkOut = null;
          await saveRecord(rec);
        } else if (!isWorkDay(d)) {
          rec.status = 'إجازة';
          rec.absenceType = '';
          rec.note = 'إجازة أسبوعية';
          rec.auto = true;
          rec.checkIn = null;
          rec.checkOut = null;
          await saveRecord(rec);
        } else {
          rec.status = 'absent';
          rec.absenceType = '';
          rec.note = '';
          rec.auto = true;
          rec.checkIn = null;
          rec.checkOut = null;
          await saveRecord(rec);
        }
      }
    }
    
    settings.compensations = settings.compensations.filter(c => c.id !== id);
    saveSettings();
    
    _monthCacheKey = '';
    await fillAbsences();
    await renderCompensation();
    await renderRecords();
    renderHome();
    renderStats();
    toast('تم التراجع عن التعويض وإلغاء الخصم بنجاح واستعادة السجل', 'ok');
  } finally {
    releaseActionLock('undoCompensation');
  }
};

window.switchRecordsView = async function(view) {
  let isComp = view === 'compensation';
  
  let tabAtt = document.getElementById('rt-attendance');
  let tabComp = document.getElementById('rt-compensation');
  if(tabAtt) tabAtt.classList.toggle('active', !isComp);
  if(tabComp) tabComp.classList.toggle('active', isComp);
  
  let viewAtt = document.getElementById('rv-attendance');
  let viewComp = document.getElementById('rv-compensation');
  if(viewAtt) viewAtt.classList.toggle('hidden', isComp);
  if(viewComp) viewComp.classList.toggle('hidden', !isComp);
  
  if(isComp) {
    await renderCompensation();
  } else {
    renderRecords();
  }
};

async function renderCompensation() {
  let bal = await calcOvertimeBalance();
  let overtimeDaysCount = (bal.extraDays || []).length;
  let usedCount = (settings.compensations || []).length;
  let balPositive = bal.balance >= 0;
  
  let balanceHtml = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
      <div class="p-3.5 rounded-2xl flex flex-col items-center justify-center transition-transform hover:scale-[1.02]" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
        <div class="flex items-center gap-1.5 text-[11px] font-black text-blue-600 dark:text-blue-400 mb-1">
          <i class="fa-solid fa-star text-amber-500"></i>
          <span>إجمالي الإضافي المكتسب</span>
        </div>
        <div class="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tight" dir="ltr">+${formatMin(bal.totalExtra)}</div>
        <div class="text-[10px] opacity-60 font-bold mt-0.5">${overtimeDaysCount} يوم إضافي مسجل</div>
      </div>

      <div class="p-3.5 rounded-2xl flex flex-col items-center justify-center transition-transform hover:scale-[1.02]" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
        <div class="flex items-center gap-1.5 text-[11px] font-black text-amber-600 dark:text-amber-400 mb-1">
          <i class="fa-solid fa-scissors"></i>
          <span>المخصوم / المستهلك</span>
        </div>
        <div class="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight" dir="ltr">-${formatMin(bal.totalUsed)}</div>
        <div class="text-[10px] opacity-60 font-bold mt-0.5">${usedCount} عملية تعويض وخصم</div>
      </div>

      <div class="p-3.5 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden transition-transform hover:scale-[1.02]" 
        style="background: ${balPositive ? 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(59,130,246,0.12) 100%)' : 'rgba(239,68,68,0.1)'}; border: 1.5px solid ${balPositive ? 'var(--c-success, #10b981)' : 'var(--c-danger, #ef4444)'};">
        <div class="flex items-center gap-1.5 text-[11px] font-black ${balPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} mb-1">
          <i class="fa-solid fa-scale-balanced"></i>
          <span>صافي الرصيد المتاح</span>
        </div>
        <div class="text-2xl sm:text-3xl font-black ${balPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} tracking-tight" dir="ltr">${formatMin(bal.balance)}</div>
        <div class="text-[10px] font-black px-2.5 py-0.5 rounded-full mt-1 ${balPositive ? (bal.balance > 0 ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/20 text-slate-700 dark:text-slate-300') : 'bg-red-500/20 text-red-700 dark:text-red-300'}">
          ${balPositive ? (bal.balance > 0 ? '✓ رصيد جاهز للتعويض' : 'لا يوجد رصيد متبقي') : '⚠️ رصيد سالب (عجز)'}
        </div>
      </div>
    </div>
  `;
  
  document.querySelectorAll('#otBalanceCardMaster, #otBalanceCard').forEach(el => {
    el.innerHTML = balanceHtml;
  });
  
  await renderCompensationList();
}
window.renderCompensation = renderCompensation;

async function renderCompensationList() {
  let bal = await calcOvertimeBalance();
  let containers = document.querySelectorAll('#compListContainer');
  if(!containers.length) return;
  
  let html = '';
  if(currentCompSubTab === 'overtime') {
    let list = bal.extraDays || [];
    if(!list.length) {
      html = `
        <div class="text-center py-12 opacity-60 text-xs">
          <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-blue-500/10 text-blue-500 text-2xl mb-3">
            <i class="fa-solid fa-star"></i>
          </div>
          <p class="font-bold text-sm mb-1">لا توجد أيام إضافي مسجلة حتى الآن</p>
          <p class="text-[11px] opacity-70">يتم احتساب الإضافي تلقائياً عند تسجيل انصراف بعد نهاية الدوام أو عند العمل في يوم إجازة</p>
        </div>
      `;
    } else {
      let totalExtraMin = list.reduce((s, i) => s + (i.minutes || 0), 0);
      let totalRemainingMin = list.reduce((s, i) => s + (i.remainingMinutes || 0), 0);
      html = `
        <div class="p-3.5 rounded-2xl flex items-center justify-between text-xs font-black shadow-xs mb-3"
          style="background: linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(16,185,129,0.12) 100%); border: 1.5px solid rgba(59,130,246,0.25);">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/20 text-blue-600 dark:text-blue-400 text-sm shadow-xs"><i class="fa-solid fa-star"></i></span>
            <div>
              <div>إجمالي الأيام المكتسبة: <strong class="text-blue-600 dark:text-blue-400">${list.length} يوم</strong></div>
              <div class="text-[10px] opacity-70 font-normal">المجموع المكتسب: +${formatMin(totalExtraMin)}</div>
            </div>
          </div>
          <div class="text-right">
            <span class="text-[10px] opacity-70 block font-normal">المتبقي المتاح:</span>
            <span class="text-xs font-black text-emerald-600 dark:text-emerald-400">${formatMin(totalRemainingMin)}</span>
          </div>
        </div>
        <div class="space-y-2.5">
          ${list.map(item => {
            let badgeBg = item.isHoliday ? 'rgba(16,185,129,0.14)' : 'rgba(59,130,246,0.14)';
            let badgeColor = item.isHoliday ? 'var(--c-success, #10b981)' : 'var(--c-blue, #3b82f6)';
            let timeDetail = item.isHoliday ? 
              `الدوام بالكامل إضافي (${fmt12(item.checkIn)} ➔ ${fmt12(item.checkOut)})` : 
              `حضور: ${fmt12(item.checkIn)} | انصراف: ${fmt12(item.checkOut)} (بدء الإضافي: ${fmt12(item.overtimeStart)})`;
            let isFullRemaining = item.remainingMinutes === item.minutes;
            let isDepleted = item.remainingMinutes <= 0;
            return `
              <div class="comp-list-item" style="border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 16px; padding: 14px;">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-black text-xs text-slate-800 dark:text-slate-100">${item.dayName} ${item.date}</span>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black" style="background:${badgeBg}; color:${badgeColor}">
                      ${esc(item.typeLabel)}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-xl" dir="ltr">
                      +${formatMin(item.minutes)}
                    </span>
                  </div>
                </div>

                <div class="text-[11px] opacity-75 leading-relaxed font-semibold">
                  <i class="fa-regular fa-clock ml-1 text-blue-500"></i> ${timeDetail}
                </div>

                <div class="flex items-center justify-between text-[11px] border-t pt-2 mt-1" style="border-color: var(--c-border)">
                  <div class="flex items-center gap-3">
                    <span>المستخدم: <strong class="${item.usedMinutes > 0 ? 'text-amber-600 dark:text-amber-400' : 'opacity-60'}">-${formatMin(item.usedMinutes || 0)}</strong></span>
                    <span>المتاح: <strong class="${isDepleted ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}">${formatMin(item.remainingMinutes)}</strong></span>
                  </div>
                  <button onclick="goToRecordDate('${item.date}')" class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5 cursor-pointer">
                    <span>عرض بالسجلات</span>
                    <i class="fa-solid fa-arrow-left text-[9px]"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } else if(currentCompSubTab === 'late') {
    let list = bal.lateDays || [];
    let compensatedCount = list.filter(x => x.compensated).length;
    let pendingCount = list.length - compensatedCount;
    let totalLateMin = list.reduce((s, i) => s + (i.minutes || 0), 0);
    
    if(!list.length) {
      html = `
        <div class="text-center py-12 opacity-60 text-xs">
          <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-500 text-2xl mb-3">
            <i class="fa-solid fa-check"></i>
          </div>
          <p class="font-bold text-sm mb-1">لا توجد أيام تأخير صباحي مسجلة!</p>
          <p class="text-[11px] opacity-70">أنت ملتزم تماماً بمواعيد الحضور</p>
        </div>
      `;
    } else {
      html = `
        <div class="p-3.5 rounded-2xl flex items-center justify-between text-xs font-black shadow-xs mb-3"
          style="background: linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(59,130,246,0.12) 100%); border: 1.5px solid rgba(245,158,11,0.25);">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-500/20 text-amber-600 dark:text-amber-400 text-sm shadow-xs"><i class="fa-solid fa-clock-rotate-left"></i></span>
            <div>
              <div>إجمالي أيام التأخير: <strong class="text-amber-600 dark:text-amber-400">${list.length} يوم</strong> (${formatMin(totalLateMin)})</div>
              <div class="text-[10px] opacity-70 font-normal">معوّض: ${compensatedCount} | متبقي بدون تعويض: ${pendingCount}</div>
            </div>
          </div>
        </div>
        <div class="space-y-2.5">
          ${list.map(item => {
            return `
              <div class="comp-list-item" style="border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 16px; padding: 14px;">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-black text-xs text-slate-800 dark:text-slate-100">${item.dayName ? item.dayName + ' ' : ''}${item.date}</div>
                    <div class="text-[11px] opacity-70 mt-0.5">وقت الحضور: <strong dir="ltr">${fmt12(item.checkIn)}</strong></div>
                  </div>
                  <span class="text-xs font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-xl" dir="ltr">
                    +${formatMin(item.minutes)} تأخير
                  </span>
                </div>

                <div class="flex items-center justify-between border-t pt-2 mt-1" style="border-color: var(--c-border)">
                  <div>
                    ${item.compensated ? 
                      `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <i class="fa-solid fa-circle-check"></i> تم تعويضه من رصيد ${item.sourceDate ? 'يوم ' + item.sourceDate : 'الإضافي'}
                      </span>` :
                      `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        <i class="fa-solid fa-triangle-exclamation"></i> بانتظار التعويض
                      </span>`
                    }
                  </div>
                  <div>
                    ${!item.compensated ? 
                      `<button onclick="compensateLate('${item.date}')" class="btn btn-primary text-xs font-black py-1.5 px-3 rounded-xl shadow-sm flex items-center gap-1.5">
                        <i class="fa-solid fa-scale-balanced text-xs"></i> تعويض من الإضافي
                      </button>` :
                      `<button onclick="goToRecordDate('${item.date}')" class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                        <span>عرض بالسجلات</span>
                        <i class="fa-solid fa-arrow-left text-[9px]"></i>
                      </button>`
                    }
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } else if(currentCompSubTab === 'early') {
    let list = bal.earlyDays || [];
    let compensatedCount = list.filter(x => x.compensated).length;
    let pendingCount = list.length - compensatedCount;
    let totalEarlyMin = list.reduce((s, i) => s + (i.minutes || 0), 0);
    
    if(!list.length) {
      html = `
        <div class="text-center py-12 opacity-60 text-xs">
          <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-500 text-2xl mb-3">
            <i class="fa-solid fa-person-walking-arrow-right"></i>
          </div>
          <p class="font-bold text-sm mb-1">لا توجد حالات خروج مبكر مسجلة!</p>
          <p class="text-[11px] opacity-70">لم تسجل أي انصراف قبل الموعد المحدد للدوام</p>
        </div>
      `;
    } else {
      html = `
        <div class="p-3.5 rounded-2xl flex items-center justify-between text-xs font-black shadow-xs mb-3"
          style="background: linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(59,130,246,0.12) 100%); border: 1.5px solid rgba(239,68,68,0.25);">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center bg-red-500/20 text-red-600 dark:text-red-400 text-sm shadow-xs"><i class="fa-solid fa-person-walking-arrow-right"></i></span>
            <div>
              <div>إجمالي حالات الخروج المبكر: <strong class="text-red-600 dark:text-red-400">${list.length} يوم</strong> (${formatMin(totalEarlyMin)})</div>
              <div class="text-[10px] opacity-70 font-normal">معوّض: ${compensatedCount} | متبقي بدون تعويض: ${pendingCount}</div>
            </div>
          </div>
        </div>
        <div class="space-y-2.5">
          ${list.map(item => {
            return `
              <div class="comp-list-item" style="border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 16px; padding: 14px;">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-black text-xs text-slate-800 dark:text-slate-100">${item.dayName ? item.dayName + ' ' : ''}${item.date}</div>
                    <div class="text-[11px] opacity-70 mt-0.5">وقت الانصراف: <strong dir="ltr">${fmt12(item.checkOut)}</strong></div>
                  </div>
                  <span class="text-xs font-black text-red-600 dark:text-red-400 bg-red-500/10 px-2.5 py-1 rounded-xl" dir="ltr">
                    -${formatMin(item.minutes)} خروج مبكر
                  </span>
                </div>

                <div class="flex items-center justify-between border-t pt-2 mt-1" style="border-color: var(--c-border)">
                  <div>
                    ${item.compensated ? 
                      `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <i class="fa-solid fa-circle-check"></i> تم تعويضه من رصيد ${item.sourceDate ? 'يوم ' + item.sourceDate : 'الإضافي'}
                      </span>` :
                      `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/15 text-red-700 dark:text-red-300">
                        <i class="fa-solid fa-triangle-exclamation"></i> بانتظار التعويض
                      </span>`
                    }
                  </div>
                  <div>
                    ${!item.compensated ? 
                      `<button onclick="compensateEarly('${item.date}')" class="btn btn-primary text-xs font-black py-1.5 px-3 rounded-xl shadow-sm flex items-center gap-1.5">
                        <i class="fa-solid fa-scale-balanced text-xs"></i> تعويض من الإضافي
                      </button>` :
                      `<button onclick="goToRecordDate('${item.date}')" class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                        <span>عرض بالسجلات</span>
                        <i class="fa-solid fa-arrow-left text-[9px]"></i>
                      </button>`
                    }
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } else if(currentCompSubTab === 'history') {
    let list = settings.compensations || [];
    if(!list.length) {
      html = `
        <div class="text-center py-12 opacity-60 text-xs">
          <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-slate-500/10 text-slate-500 text-2xl mb-3">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </div>
          <p class="font-bold text-sm mb-1">سجل عمليات التعويض والخصم فارغ</p>
          <p class="text-[11px] opacity-70">أي عملية تعويض تأخير أو خروج مبكر أو إجازة مخصومة ستظهر هنا بالتفصيل</p>
        </div>
      `;
    } else {
      let sorted = [...list].sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      let totalCompMin = sorted.reduce((s, i) => s + (i.minutes || 0), 0);
      html = `
        <div class="p-3.5 rounded-2xl flex items-center justify-between text-xs font-black shadow-xs mb-3"
          style="background: linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.12) 100%); border: 1.5px solid rgba(59,130,246,0.25);">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/20 text-blue-600 dark:text-blue-400 text-sm shadow-xs"><i class="fa-solid fa-list-check"></i></span>
            <div>
              <div>إجمالي العمليات المنفذة: <strong class="text-blue-600 dark:text-blue-400">${sorted.length} عملية</strong></div>
              <div class="text-[10px] opacity-70 font-normal">إجمالي الدقائق المخصومة: ${formatMin(totalCompMin)}</div>
            </div>
          </div>
        </div>
        <div class="space-y-2.5">
          ${sorted.map(item => {
            let label = '';
            let iconClass = 'fa-scale-balanced';
            let iconColor = 'text-blue-500';
            let badgeText = '';
            if(item.type === 'late') {
              label = `تعويض تأخير صباحي يوم ${item.date}`;
              iconClass = 'fa-clock-rotate-left';
              iconColor = 'text-amber-500';
              badgeText = 'تعويض تأخير';
            } else if(item.type === 'early') {
              label = `تعويض خروج مبكر يوم ${item.date}`;
              iconClass = 'fa-person-walking-arrow-right';
              iconColor = 'text-red-500';
              badgeText = 'تعويض خروج';
            } else if(item.type === 'leave') {
              label = `إجازة من رصيد الإضافي يوم ${item.date}`;
              iconClass = 'fa-calendar-check';
              iconColor = 'text-emerald-500';
              badgeText = 'إجازة من الرصيد';
            }

            let sourceInfo = item.sourceDate ? `تم الخصم من رصيد يوم: <strong class="text-blue-600 dark:text-blue-400">${item.sourceDate}</strong>` : 
              (Array.isArray(item.sourceDetails) && item.sourceDetails.length ? 
                `تم الخصم تلقائياً من الأيام الأقدم: ` + item.sourceDetails.map(sd => `<strong class="text-blue-600 dark:text-blue-400">${sd.date}</strong> (${formatMin(sd.minutes)})`).join(' ، ') : 
                'خصم مباشر من إجمالي الرصيد');
            let createdFormatted = item.createdAt ? new Date(item.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
            
            return `
              <div class="comp-list-item" style="border: 1px solid var(--c-border); background: var(--c-surface); border-radius: 16px; padding: 14px;">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-500/10 ${iconColor} text-xs">
                      <i class="fa-solid ${iconClass}"></i>
                    </span>
                    <div>
                      <div class="font-black text-xs text-slate-800 dark:text-slate-100">${label}</div>
                      <div class="text-[10px] opacity-60">${createdFormatted ? 'نُفذت: ' + createdFormatted : ''}</div>
                    </div>
                  </div>
                  <span class="text-xs font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-xl" dir="ltr">
                    -${formatMin(item.minutes)}
                  </span>
                </div>

                <div class="text-[11px] opacity-80 leading-relaxed font-semibold">
                  <i class="fa-solid fa-link ml-1 opacity-60"></i> ${sourceInfo}
                  ${item.note ? `<div class="text-[10px] opacity-70 mt-1"><i class="fa-solid fa-comment-dots ml-1"></i> ملاحظة: ${esc(item.note)}</div>` : ''}
                </div>

                <div class="flex items-center justify-between border-t pt-2 mt-1" style="border-color: var(--c-border)">
                  <span class="text-[10px] font-bold opacity-60">معرّف العملية: #${(item.id || '').substring(0, 8)}</span>
                  <button onclick="undoCompensation('${item.id}')" class="btn btn-outline text-xs font-bold py-1 px-3 rounded-xl border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-rotate-left text-xs"></i> تراجع واسترجاع الرصيد
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  }
  containers.forEach(container => {
    container.innerHTML = html;
  });
}

window.goToRecordDate = async function(dateStr) {
  if(!dateStr || typeof dateStr !== 'string') return;
  let parts = dateStr.split('/');
  if(parts.length === 3) {
    viewYear = Number(parts[2]);
    viewMonth = Number(parts[1]) - 1;
  }
  if(window.switchRecordsView) switchRecordsView('attendance');
  go('records');
};
window.renderCompensationList = renderCompensationList;

// ── Local AI Intelligence Engine 🧠 ──────────────────────
function analyzeLatenessPatterns(recs) {
  if (!recs || !recs.length) return null;
  
  // 1. Reset counters for each weekday (0=Sun, 6=Sat)
  let stats = Array(7).fill(0).map(() => ({ total: 0, late: 0 }));
  
  recs.forEach(r => {
    if (!isPresent(r.status)) return;
    
    let d = new Date(slashToISO(r.date));
    let day = d.getDay();
    let sch = getSchedule(d.getFullYear(), d.getMonth(), d);
    
    stats[day].total++;
    if (lateMin(r.checkIn, sch.start) > 0) {
      stats[day].late++;
    }
  });
  
  // 2. Map to probabilities
  let patterns = stats.map((s, i) => ({
    day: i,
    label: DAYS[i],
    prob: s.total >= 2 ? Math.round((s.late / s.total) * 100) : 0, // Need at least 2 samples
    count: s.total
  }));
  
  return patterns;
}
window.analyzeLatenessPatterns = analyzeLatenessPatterns;

// ── Settings page ─────────────────────────────────────────
function renderSettingsPage(){
  let sn=document.getElementById(`setName`); if(sn) sn.value=settings.name||``;
  let ao=document.getElementById(`alertOffsetIn`); if(ao) ao.value=settings.alertOffset;
  let bs=document.getElementById(`baseStartIn`); if(bs) bs.value=settings.baseStart||`08:00`;
  let be=document.getElementById(`baseEndIn`); if(be) be.value=settings.baseEnd||`16:00`;
  let bos=document.getElementById(`baseOvertimeStartIn`); if(bos) bos.value=settings.baseOvertimeStart||``;
  let ab=document.getElementById(`autoBackupCB`); if(ab) ab.checked=settings.autoBackup;
  let cab=document.getElementById(`cloudAutoSyncCB`); if(cab) cab.checked=!!settings.cloudAutoSync;
  let bio=document.getElementById(`biometricLockCB`); if(bio) bio.checked=!!settings.enableBiometric;
  
  if(!settings.exportColumns) settings.exportColumns = { date:true, day:true, checkIn:true, checkOut:true, status:true, late:true, early:true, overtime:true, absenceType:true, note:true };
  const cols = ['date', 'day', 'checkIn', 'checkOut', 'status', 'late', 'early', 'overtime', 'absenceType', 'note'];
  cols.forEach(c => {
    let el = document.getElementById('ec_'+c);
    if(el) el.checked = !!settings.exportColumns[c];
  });
  
  // Backup Interval settings
  let bi=document.getElementById(`backupIntervalIn`); if(bi) bi.value=settings.backupInterval||`daily`;
  let bt=document.getElementById(`backupTimeIn`); if(bt) bt.value=settings.backupTime||`00:00`;
  let bd=document.getElementById(`backupDayIn`); if(bd) bd.value=settings.backupDay||0;
  let bdt=document.getElementById(`backupDateIn`); if(bdt) bdt.value=settings.backupDate||1;
  window.updateBackupFieldsVisibility();

  let tf=document.getElementById(`timeFormatIn`); if(tf) tf.value=settings.timeFormat||`hhmm`;
  renderWorkDayPicker();
  renderScheduleList();
  renderHolidayList();
  renderReportHeaders();
  renderReportFooters();
  if(window.updateGoogleUI) window.updateGoogleUI(); // Ensure cloud account status is shown
  
  // Note font select population
  let fSel = document.getElementById('noteFontIn');
  if(fSel) {
    fSel.innerHTML = `
      <option value="Cairo">Cairo (الافتراضي)</option>
      <option value="Amiri">Amiri (رسمي 1)</option>
      <option value="Tajawal">Tajawal (رسمي 2)</option>
      <option value="Arial Black">Arial Black (عريض)</option>
      <option value="Almarai">Almarai (رسمي 3)</option>
      <option value="IBM Plex Sans Arabic">IBM Plex (رسمي 4)</option>
      <option value="Readex Pro">Readex (رسمي 5)</option>
      <option value="El Messiri">El Messiri (رسمي 6)</option>
      <option value="Noto Naskh Arabic">Noto Naskh (رسمي 7)</option>
      <option value="Markazi Text">Markazi (رسمي 8)</option>
      <option value="Kufam">Kufam (رسمي 9)</option>
      <option value="Mada">Mada (رسمي 10)</option>
      <option value="Lateef">Lateef (تقليدي)</option>
    `;
    if(settings.customFonts && settings.customFonts.length) {
      settings.customFonts.forEach(f => {
        fSel.innerHTML += `<option value="${esc(f.name)}">${esc(f.name)} (مخصص)</option>`;
      });
    }
    fSel.value = settings.noteFont || 'Cairo';
  }
  if(window.syncChips) window.syncChips();
}
window.updateBackupFieldsVisibility=function(){
  let interval = document.getElementById(`backupIntervalIn`)?.value || settings.backupInterval;
  let wWrap = document.getElementById(`backupWeeklyWrap`);
  let mWrap = document.getElementById(`backupMonthlyWrap`);
  if(wWrap) wWrap.classList.toggle('hidden', interval !== 'weekly');
  if(mWrap) mWrap.classList.toggle('hidden', interval !== 'monthly');
};
window.saveBackupSettings=function(){
  if(!document.getElementById(`backupIntervalIn`)) return;
  settings.backupInterval = document.getElementById(`backupIntervalIn`)?.value || settings.backupInterval;
  settings.backupTime = document.getElementById(`backupTimeIn`)?.value || settings.backupTime;
  settings.backupDay = parseInt(document.getElementById(`backupDayIn`)?.value) || settings.backupDay;
  settings.backupDate = parseInt(document.getElementById(`backupDateIn`)?.value) || settings.backupDate;
  saveSettings();
  if(typeof window.updateBackupFieldsVisibility === 'function') window.updateBackupFieldsVisibility();
  toast(`<i class="fa-solid fa-check ml-1"></i> تم حفظ إعدادات النسخ`,`ok`);
};
window.saveName=function(){let el=document.getElementById(`setName`);if(el){settings.name=el.value.trim()||``;saveSettings();renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`);}};
window.saveAlertSettings=function(){settings.alertOffset=parseInt(document.getElementById(`alertOffsetIn`).value)||0;saveSettings();if(settings.alertOffset>0&&Notification.permission!==`granted`)Notification.requestPermission();toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`);};
window.saveBaseSchedule=function(){
  let s=document.getElementById(`baseStartIn`), e=document.getElementById(`baseEndIn`), ot=document.getElementById(`baseOvertimeStartIn`);
  if(!s||!e) return;
  settings.baseStart=s.value||`08:00`;
  settings.baseEnd=e.value||`16:00`;
  settings.baseOvertimeStart=ot?.value||``;
  saveSettings();renderRecords();renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تم التحديث`,`ok`);
};
window.toggleAutoBackup=function(){let el=document.getElementById(`autoBackupCB`);if(el){settings.autoBackup=el.checked;saveSettings();toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`);}};
window.toggleCloudAutoSync = function() {
  let el = document.getElementById('cloudAutoSyncCB');
  if(el){ settings.cloudAutoSync = el.checked; saveSettings(); toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`); }
};
// --- Settings UI Redesign Logic ---
window.switchSetTab = function(tabId) {
  // Update buttons - just toggle 'active' (CSS handles all styling)
  document.querySelectorAll('.set-tab').forEach(btn => {
    btn.classList.remove('active');
  });
  let activeBtn = document.getElementById('st-' + tabId);
  if(activeBtn) {
    activeBtn.classList.add('active');
  }

  // Update panes
  document.querySelectorAll('.set-pane').forEach(pane => {
    pane.classList.add('hidden');
  });
  let activePane = document.getElementById('sp-' + tabId);
  if(activePane) {
    activePane.classList.remove('hidden');
  }
};

window.syncChips = function() {
  document.querySelectorAll('.setting-chip').forEach(lbl => {
    let cb = lbl.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) {
      lbl.classList.add('active');
    } else {
      lbl.classList.remove('active');
    }
  });
};
// ---------------------------------

window.applyExportColSettings = function() {
  if(!settings.exportColumns) return;
  const cols = settings.exportColumns;
  const map = {
    'ec_date': cols.date, 'ec_day': cols.day, 'ec_checkIn': cols.checkIn, 'ec_checkOut': cols.checkOut,
    'ec_status': cols.status, 'ec_late': cols.late, 'ec_early': cols.early,
    'ec_overtime': cols.overtime, 'ec_absenceType': cols.absenceType, 'ec_note': cols.note
  };
  Object.keys(map).forEach(id => {
    let el = document.getElementById(id);
    if(el) el.checked = !!map[id];
  });
  if(window.syncChips) window.syncChips();
};

window.saveExportCols = async function() {
  if(!settings.exportColumns) settings.exportColumns = {};
  ['date', 'day', 'checkIn', 'checkOut', 'status', 'late', 'early', 'overtime', 'absenceType', 'note'].forEach(k => {
    let el = document.getElementById('ec_' + k);
    if(el) settings.exportColumns[k] = !!el.checked;
  });
  await saveSettings();
  toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ وتأمين إعدادات التصدير`,`ok`);
};
window.saveTimeFormat=function(){let el=document.getElementById(`timeFormatIn`); if(el){ settings.timeFormat=el.value||`hhmm`;saveSettings();renderRecords();renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`); }};

window.saveNoteFont = function() {
  let el = document.getElementById('noteFontIn');
  if(el){ settings.noteFont = el.value; saveSettings(); if(typeof window.applyNoteFont === 'function') window.applyNoteFont(); renderRecords(); renderHome(); toast(`<i class="fa-solid fa-check ml-1"></i> تم تغيير الخط`,`ok`); }
};

window.handleFontUpload = async function(input) {
  if(!input || !input.files || !input.files[0]) return;
  let file = input.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024) return toast("حجم الخط كبير جداً (الأقصى 2 ميجا)","err");
  
  toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري معالجة الخط...`,`ok`);
  let reader = new FileReader();
  reader.onload = async function(e) {
    let b64 = e.target.result; // data:font/ttf;base64,...
    let fontName = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_');
    
    try {
      // Store in IndexedDB to avoid settings bloat
      let customFontsData = await IDB.get('pa_custom_fonts_data') || {};
      customFontsData[fontName] = b64;
      await IDB.set('pa_custom_fonts_data', customFontsData);
      
      // Update settings metadata
      if(!settings.customFonts) settings.customFonts = [];
      if(!settings.customFonts.find(f => f.name === fontName)) {
        settings.customFonts.push({ name: fontName, file: file.name });
      }
      settings.noteFont = fontName;
      saveSettings();
      
      // Register font immediately
      await loadFontToBrowser(fontName, b64);
      
      renderSettingsPage();
      renderRecords();
      renderHome();
      toast(`<i class="fa-solid fa-check ml-1"></i> تمت إضافة الخط واستخدامه بنجاح!`,`ok`);
    } catch(err) {
      toast("فشل حفظ الخط","err");
    }
  };
  reader.readAsDataURL(file);
};

async function loadFontToBrowser(name, b64) {
  try {
    const font = new FontFace(name, `url(${b64})`);
    await font.load();
    document.fonts.add(font);
  } catch(e) { }
}

window.applyNoteFont = function() {
  let font = settings.noteFont || 'Cairo';
  let styleId = 'note-font-style';
  let styleEl = document.getElementById(styleId);
  if(!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    let head = document.head || (document.getElementsByTagName ? document.getElementsByTagName('head')[0] : null);
    if (head && head.appendChild) head.appendChild(styleEl);
  }
  styleEl.textContent = `.note-font { font-family: '${font}', serif !important; }`;
};

window.loadAllFonts = async function() {
  if(!settings.customFonts || !settings.customFonts.length) {
    window.applyNoteFont();
    return;
  }
  let data = await IDB.get('pa_custom_fonts_data') || {};
  for(let fontInfo of settings.customFonts) {
    if(data[fontInfo.name]) {
      await loadFontToBrowser(fontInfo.name, data[fontInfo.name]);
    }
  }
  window.applyNoteFont();
};

// Work day picker
function renderWorkDayPicker(){
  let el=document.getElementById(`wdPicker`); if(!el) return;
  el.innerHTML=DAYS.map((d,i)=>`<label class="wd-l"><input type="checkbox" class="hidden wdc" value="${i}" ${settings.workDays.includes(i)?`checked`:``} onchange="toggleWD(${i})"><span class="block py-2 rounded-lg text-[10px] font-bold transition ${settings.workDays.includes(i)?`text-white`:`text-slate-500`}" style="background:${settings.workDays.includes(i)?`var(--pri)`:`var(--bg)`}">${d}</span></label>`).join(``);
  let ds=document.getElementById(`daySchedsList`); if(!ds) return;
  ds.innerHTML=settings.workDays.map(i=>{
    let h=`<div class="flex justify-between items-center p-2 rounded-lg" style="background:var(--bg)"><span class="text-xs font-bold">${DAYS[i]}</span>`;
    if(settings.daySchedules&&settings.daySchedules[i]) h+=`<div class="flex items-center gap-2"><span class="text-[10px]" style="color:var(--text2)">${fmt12(settings.daySchedules[i].start)} - ${fmt12(settings.daySchedules[i].end)}</span><button onclick="openDaySched(${i})" class="text-xs" style="color:var(--pri)"><i class="fa-solid fa-pen"></i></button></div></div>`;
    else h+=`<button onclick="openDaySched(${i})" class="text-[10px] font-bold px-2 py-1 rounded" style="background:var(--border);color:var(--text2)">تخصيص</button></div>`;
    return h;
  }).join(``);
}
window.toggleWD=function(i){if(settings.workDays.includes(i))settings.workDays=settings.workDays.filter(d=>d!==i);else settings.workDays.push(i);settings.workDays.sort();saveSettings();renderWorkDayPicker();fillAbsences();renderHome();};

// Day schedule modal
window.openDaySched=function(i){
  let m=document.getElementById(`daySchedM`); if(!m) return;
  if(document.getElementById(`dsDayIdx`)) document.getElementById(`dsDayIdx`).value=i;
  if(document.getElementById(`dsTitle`)) document.getElementById(`dsTitle`).textContent=`تخصيص وقت يوم (${DAYS[i]})`;
  if(document.getElementById(`dsStart`)) document.getElementById(`dsStart`).value=settings.daySchedules&&settings.daySchedules[i]?settings.daySchedules[i].start:``;
  if(document.getElementById(`dsEnd`)) document.getElementById(`dsEnd`).value=settings.daySchedules&&settings.daySchedules[i]?settings.daySchedules[i].end:``;
  if(document.getElementById(`dsOT`)) document.getElementById(`dsOT`).value=settings.daySchedules&&settings.daySchedules[i]?settings.daySchedules[i].overtimeStart||``:``;
  m.classList.remove(`hidden`);
};
window.closeDaySchedM=function(){document.getElementById(`daySchedM`)?.classList?.add(`hidden`);};
window.saveDaySched=function(){
  let idxEl=document.getElementById(`dsDayIdx`), sEl=document.getElementById(`dsStart`), eEl=document.getElementById(`dsEnd`), otEl=document.getElementById(`dsOT`);
  if(!idxEl || !sEl || !eEl) return;
  let i=parseInt(idxEl.value), s=sEl.value, e=eEl.value, ot=otEl?.value||``;
  if(!s||!e) return toast(`أدخل الأوقات`,`err`);
  settings.daySchedules[i]={start:s,end:e,overtimeStart:ot};saveSettings();renderWorkDayPicker();closeDaySchedM();toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ`,`ok`);
};
window.clearDaySched=function(){let idxEl=document.getElementById(`dsDayIdx`); if(!idxEl) return; let i=parseInt(idxEl.value);delete settings.daySchedules[i];saveSettings();renderWorkDayPicker();closeDaySchedM();toast(`تم مسح التخصيص`,`ok`);};

// Schedule list
function renderScheduleList(){
  let el=document.getElementById(`schedList`); if(!el) return;
  if(!settings.schedules.length){el.innerHTML=`<p class="text-xs text-center py-3" style="color:var(--text2)">لا توجد جداول مخصصة</p>`;return;}
  let sortedSchedules = [...settings.schedules].sort((a,b)=>b.key.localeCompare(a.key));
  el.innerHTML=sortedSchedules.map((s)=>{
    let[y,m]=s.key.split(`-`),label=MONTHS[parseInt(m)-1]+` `+y;
    return `<div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg)"><div class="flex-1"><div class="font-bold text-xs">${esc(s.label||label)}</div><div class="text-[10px]" style="color:var(--text2)">${fmt12(s.start)} - ${fmt12(s.end)}</div></div><button onclick="delSched('${s.key}')" class="w-7 h-7 rounded-lg flex items-center justify-center text-xs" style="background:#fef2f2;color:#dc2626"><i class="fa-solid fa-trash"></i></button></div>`;
  }).join(``);
}
window.openSchedModal=function(){document.getElementById(`schedM`)?.classList?.remove(`hidden`);};
window.closeSchedM=function(){document.getElementById(`schedM`)?.classList?.add(`hidden`);};
window.addSched=function(){
  let mEl=document.getElementById(`sMonth`), sEl=document.getElementById(`sStart`), eEl=document.getElementById(`sEnd`), otEl=document.getElementById(`sOT`), lEl=document.getElementById(`sLabel`);
  if(!mEl || !sEl || !eEl) return;
  let m=mEl.value, s=sEl.value, e=eEl.value, ot=otEl?.value||``, l=(lEl?.value||``).trim();
  if(!m||!s||!e) return toast(`أكمل البيانات`,`err`);
  settings.schedules=settings.schedules.filter(x=>x.key!==m);
  settings.schedules.push({key:m,start:s,end:e,overtimeStart:ot,label:l||`توقيت مخصص`});
  saveSettings();renderScheduleList();closeSchedM();renderHome();toast(`<i class="fa-solid fa-check ml-1"></i> تمت الإضافة`,`ok`);
};
window.delSched=function(key){settings.schedules=settings.schedules.filter(s=>s.key!==key);saveSettings();renderScheduleList();renderHome();toast(`تم الحذف`,`ok`);};

// Holidays
function renderHolidayList(){
  let el=document.getElementById(`holList`); if(!el) return;
  let sortedHolidays = [...settings.holidays].sort((a,b)=>b.date.localeCompare(a.date));
  sortedHolidays.length?el.innerHTML=sortedHolidays.map((h)=>`<div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--bg)"><div class="flex-1"><div class="font-bold text-xs">${esc(h.label)}</div><div class="text-[10px]" style="color:var(--text2)">${isoToSlash(h.date)}</div></div><button onclick="delHol('${h.date}')" class="w-7 h-7 rounded-lg flex items-center justify-center text-xs" style="background:#fef2f2;color:#dc2626"><i class="fa-solid fa-trash"></i></button></div>`).join(``)
  :el.innerHTML=`<p class="text-xs text-center py-3" style="color:var(--text2)">لا توجد إجازات رسمية</p>`;
  let al=document.getElementById(`absList`); if(al) al.innerHTML=settings.absenceTypes.map((t,i)=>`<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-[11px] font-bold">${esc(t)} <button onclick="delAbs(${i})"><i class="fa-solid fa-xmark"></i></button></span>`).join(``);
  let sl=document.getElementById(`statusList`); if(sl) sl.innerHTML=settings.customStatuses.map((s,i)=>`<span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-[11px] font-bold">${esc(s)} <button onclick="delCustomStatus(${i})"><i class="fa-solid fa-xmark"></i></button></span>`).join(``);
}
window.openHolModal=function(){document.getElementById(`holM`)?.classList?.remove(`hidden`);};
window.closeHolM=function(){document.getElementById(`holM`)?.classList?.add(`hidden`);};
window.addHol=function(){
  let dEl=document.getElementById(`hDate`), lEl=document.getElementById(`hLabel`);
  if(!dEl || !lEl) return;
  let d=dEl.value, l=lEl.value.trim();
  if(!d||!l) return toast(`أكمل البيانات`,`err`);
  settings.holidays.push({date:d,label:l});saveSettings();fillAbsences();renderHolidayList();renderHome();renderRecords();closeHolM();toast(`<i class="fa-solid fa-check ml-1"></i> تمت الإضافة`,`ok`);
};
window.delHol=function(date){settings.holidays=settings.holidays.filter(h=>h.date!==date);saveSettings();fillAbsences();renderHolidayList();renderHome();renderRecords();toast(`تم الحذف`,`ok`);};
window.openAbsModal=function(){document.getElementById(`absM`)?.classList?.remove(`hidden`);};
window.closeAbsM=function(){document.getElementById(`absM`)?.classList?.add(`hidden`);};
window.addAbsType=function(){let el=document.getElementById(`absIn`); if(!el) return; let v=el.value.trim();if(!v||settings.absenceTypes.includes(v))return;settings.absenceTypes.push(v);saveSettings();renderHolidayList();closeAbsM();el.value=``;toast(`<i class="fa-solid fa-check ml-1"></i> تم`,`ok`);};
window.delAbs=function(i){settings.absenceTypes.splice(i,1);saveSettings();renderHolidayList();toast(`تم`,`ok`);};
window.openStatusModal=function(){document.getElementById(`statusM`)?.classList?.remove(`hidden`);};
window.closeStatusM=function(){document.getElementById(`statusM`)?.classList?.add(`hidden`);};
window.addCustomStatus=function(){let el=document.getElementById(`statusIn`); if(!el) return; let v=el.value.trim();if(!v||settings.customStatuses.includes(v))return;settings.customStatuses.push(v);saveSettings();renderHolidayList();closeStatusM();el.value=``;toast(`<i class="fa-solid fa-check ml-1"></i> تم`,`ok`);};
window.delCustomStatus=function(i){settings.customStatuses.splice(i,1);saveSettings();renderHolidayList();toast(`تم`,`ok`);};


window.openHeaderModal = function(id = null) {
  let hId = document.getElementById('headerIdIn');
  let hName = document.getElementById('headerNameIn');
  let hContent = document.getElementById('headerContentIn');
  let m = document.getElementById('headerM');
  if(!m) return;
  if(id) {
    let h = (settings.reportHeaders||[]).find(x => x.id === id);
    if(h) {
      if(hId) hId.value = h.id;
      if(hName) hName.value = h.name;
      if(hContent) hContent.value = h.content;
    }
  } else {
    if(hId) hId.value = '';
    if(hName) hName.value = '';
    if(hContent) hContent.value = '';
  }
  m.classList.remove('hidden');
};

window.closeHeaderModal = function() {
  let el = document.getElementById('headerM') || document.getElementById('reportHeaderModal');
  if(el && el.classList) el.classList.add('hidden');
};

window.saveReportHeader = function() {
  let idEl = document.getElementById('headerIdIn'), nameEl = document.getElementById('headerNameIn'), contentEl = document.getElementById('headerContentIn');
  if(!nameEl) return;
  let id = idEl?.value || '';
  let name = nameEl.value.trim();
  let content = contentEl?.value?.trim() || '';
  if(!name) return toast('يرجى إدخال اسم الترويسة', 'err');
  
  if(id) {
    let idx = settings.reportHeaders.findIndex(x => x.id === id);
    if(idx !== -1) {
      settings.reportHeaders[idx].name = name;
      settings.reportHeaders[idx].content = content;
    }
  } else {
    let newId = 'h_' + Date.now();
    settings.reportHeaders.push({id: newId, name: name, content: content});
  }
  saveSettings();
  renderReportHeaders();
  closeHeaderModal();
  toast('تم حفظ الترويسة', 'ok');
};

window.deleteReportHeader = function(id) {
  settings.reportHeaders = settings.reportHeaders.filter(x => x.id !== id);
  if(settings.activeHeaderId === id) settings.activeHeaderId = '';
  saveSettings();
  renderReportHeaders();
  toast('تم الحذف', 'ok');
};

window.setActiveHeader = function(id) {
  settings.activeHeaderId = id;
  saveSettings();
  renderReportHeaders();
};

window.renderReportHeaders = function() {
  let list = document.getElementById('reportHeadersList');
  if(!list) return;
  let html = '';
  let defHChecked = (settings.activeHeaderId === '' || settings.activeHeaderId === 'default') ? 'checked' : '';
  let noHChecked = settings.activeHeaderId === 'none' ? 'checked' : '';
  html += `
    <div class="flex items-center justify-between p-3 rounded-xl border ${defHChecked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all cursor-pointer" onclick="setActiveHeader('default')">
      <div class="flex items-center gap-3">
        <input type="radio" name="active_header" ${defHChecked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
        <span class="font-bold text-sm">الترويسة الافتراضية</span>
      </div>
    </div>
    <div class="flex items-center justify-between p-3 rounded-xl border ${noHChecked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all cursor-pointer" onclick="setActiveHeader('none')">
      <div class="flex items-center gap-3">
        <input type="radio" name="active_header" ${noHChecked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
        <span class="font-bold text-sm">بدون ترويسة</span>
      </div>
    </div>
  `;
  settings.reportHeaders.forEach(h => {
    let checked = settings.activeHeaderId === h.id ? 'checked' : '';
    html += `
      <div class="flex items-center justify-between p-3 rounded-xl border ${checked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all group">
        <div class="flex items-center gap-3 flex-1 cursor-pointer" onclick="setActiveHeader('${h.id}')">
          <input type="radio" name="active_header" ${checked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="font-bold text-sm truncate max-w-[200px]">${esc(h.name)}</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="openHeaderModal('${h.id}'); event.stopPropagation();" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen text-xs"></i></button>
          <button onclick="deleteReportHeader('${h.id}'); event.stopPropagation();" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
};

window.openFooterModal = function(id = null) {
  let hId = document.getElementById('footerIdIn');
  let hName = document.getElementById('footerNameIn');
  let hContent = document.getElementById('footerContentIn');
  let m = document.getElementById('footerM');
  if(!m) return;
  if(id) {
    let h = (settings.reportFooters||[]).find(x => x.id === id);
    if(h) {
      if(hId) hId.value = h.id;
      if(hName) hName.value = h.name;
      if(hContent) hContent.value = h.content;
    }
  } else {
    if(hId) hId.value = '';
    if(hName) hName.value = '';
    if(hContent) hContent.value = '';
  }
  m.classList.remove('hidden');
};

window.closeFooterModal = function() {
  let el = document.getElementById('footerM') || document.getElementById('reportFooterModal');
  if(el && el.classList) el.classList.add('hidden');
};

window.saveReportFooter = function() {
  let idEl = document.getElementById('footerIdIn'), nameEl = document.getElementById('footerNameIn'), contentEl = document.getElementById('footerContentIn');
  if(!nameEl) return;
  let id = idEl?.value || '';
  let name = nameEl.value.trim();
  let content = contentEl?.value?.trim() || '';
  if(!name) return toast('يرجى إدخال اسم التذييل', 'err');
  
  if(id) {
    let idx = settings.reportFooters.findIndex(x => x.id === id);
    if(idx !== -1) {
      settings.reportFooters[idx].name = name;
      settings.reportFooters[idx].content = content;
    }
  } else {
    let newId = 'f_' + Date.now();
    settings.reportFooters.push({id: newId, name: name, content: content});
  }
  saveSettings();
  renderReportFooters();
  closeFooterModal();
  toast('تم حفظ التذييل', 'ok');
};

window.deleteReportFooter = function(id) {
  settings.reportFooters = settings.reportFooters.filter(x => x.id !== id);
  if(settings.activeFooterId === id) settings.activeFooterId = '';
  saveSettings();
  renderReportFooters();
  toast('تم الحذف', 'ok');
};

window.setActiveFooter = function(id) {
  settings.activeFooterId = id;
  saveSettings();
  renderReportFooters();
};

window.renderReportFooters = function() {
  let list = document.getElementById('reportFootersList');
  if(!list) return;
  let html = '';
  let defFChecked = (settings.activeFooterId === '' || settings.activeFooterId === 'default') ? 'checked' : '';
  let noFChecked = settings.activeFooterId === 'none' ? 'checked' : '';
  html += `
    <div class="flex items-center justify-between p-3 rounded-xl border ${defFChecked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all cursor-pointer" onclick="setActiveFooter('default')">
      <div class="flex items-center gap-3">
        <input type="radio" name="active_footer" ${defFChecked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
        <span class="font-bold text-sm">التذييل الافتراضي</span>
      </div>
    </div>
    <div class="flex items-center justify-between p-3 rounded-xl border ${noFChecked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all cursor-pointer" onclick="setActiveFooter('none')">
      <div class="flex items-center gap-3">
        <input type="radio" name="active_footer" ${noFChecked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
        <span class="font-bold text-sm">بدون تذييل</span>
      </div>
    </div>
  `;
  settings.reportFooters.forEach(h => {
    let checked = settings.activeFooterId === h.id ? 'checked' : '';
    html += `
      <div class="flex items-center justify-between p-3 rounded-xl border ${checked ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'} transition-all group">
        <div class="flex items-center gap-3 flex-1 cursor-pointer" onclick="setActiveFooter('${h.id}')">
          <input type="radio" name="active_footer" ${checked} class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500">
          <span class="font-bold text-sm truncate max-w-[200px]">${esc(h.name)}</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="openFooterModal('${h.id}'); event.stopPropagation();" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen text-xs"></i></button>
          <button onclick="deleteReportFooter('${h.id}'); event.stopPropagation();" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
};

// ── BACKUP: Save to Documents/PersonalAttendance/Backup ───

// With no-overwrite: backup(1).json, backup(2).json ...
function generateSimpleChecksum(obj) {
  let str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

window.backupData=async function(type = 'all'){
  let allRecs = await RECDB.getAll();
  let metadata = {
    backupFormatVersion: "2.0",
    schemaVersion: "6.0",
    appVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    platform: window.Capacitor ? 'Android' : 'Web',
    databaseVersion: 2
  };
  
  let data = { 
    d: metadata.createdAt, 
    type: type,
    metadata: metadata
  };
  
  let prefix = `backup_FULL_`;
  if (type === 'settings') {
    data.S = settings;
    prefix = `backup_SETTINGS_`;
  } else if (type === 'records') {
    data.R = allRecs;
    prefix = `backup_RECORDS_`;
  } else {
    data.S = settings;
    data.R = allRecs;
  }
  
  // Safe checksum generation
  data.metadata.checksum = generateSimpleChecksum({ S: data.S || null, R: data.R || null });

  let json=JSON.stringify(data);
  let timestamp=new Date().toISOString().replace(/[:.]/g,`-`).slice(0,19);
  let baseFileName=`${prefix}${timestamp}.json`;

  if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem){
    try{
      // Request permission
      await requestStoragePermission();
      // Ensure Backup subfolder exists
      await ensureDir(BACKUP_FOLDER,`DOCUMENTS`);
      // Find unique filename
      let filePath=await uniqueFilePath(`${BACKUP_FOLDER}/${baseFileName}`,`DOCUMENTS`);
      await window.Capacitor.Plugins.Filesystem.writeFile({
        path:filePath,data:json,directory:`DOCUMENTS`,encoding:`utf8`,recursive:true
      });
      toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ في: المستندات/${filePath}`,`ok`);
    } catch(err){
      console.error(`Backup error:`,err);
      toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل الحفظ: `+(err.message||err),`err`);
    }
  } else {
    // Browser fallback
    try{
      let blob=new Blob([json],{type:`application/json`});
      let url=URL.createObjectURL(blob);
      let a=document.createElement(`a`);
      a.href=url; a.download=baseFileName; a.click();
      URL.revokeObjectURL(url);
      toast(`<i class="fa-solid fa-check ml-1"></i> تم تحميل ملف النسخة الاحتياطية`,`ok`);
    } catch(err){ toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل التحميل`,`err`); }
  }
};

// ── Share backup file ─────────────────────────────────────
window.shareBackup=async function(){
  let allRecs = await RECDB.getAll();
  let metadata = {
    backupFormatVersion: "2.0",
    schemaVersion: "6.0",
    appVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    platform: window.Capacitor ? 'Android' : 'Web',
    databaseVersion: 2
  };
  
  let data={
    S:settings,
    R:allRecs,
    d:metadata.createdAt,
    metadata: metadata
  };
  data.metadata.checksum = generateSimpleChecksum({ S: settings, R: allRecs });
  
  let json=JSON.stringify(data);
  let timestamp=new Date().toISOString().replace(/[:.]/g,`-`).slice(0,19);
  let fileName=`backup_${timestamp}.json`;

  if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem){
    try{
      // Write to cache for sharing
      let tmpPath=`tmp_share_${Date.now()}.json`;
      let written=await window.Capacitor.Plugins.Filesystem.writeFile({
        path:tmpPath,data:json,directory:`CACHE`,encoding:`utf8`
      });
      if(window.Capacitor.Plugins.Share){
        await window.Capacitor.Plugins.Share.share({
          title:`نسخة احتياطية - سجل الحضور`,
          text:`نسخة احتياطية لبيانات سجل الحضور الشخصي`,
          url:written.uri,
          dialogTitle:`مشاركة النسخة الاحتياطية`
        });
      } else { toast(`<i class="fa-solid fa-xmark ml-1"></i> المشاركة غير مدعومة على هذا الجهاز`,`err`); }
    } catch(err){
      console.error(`Share backup error:`,err);
      toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل المشاركة: `+(err.message||err),`err`);
    }
  } else {
    // Browser: try Web Share API with file
    try{
      let blob=new Blob([json],{type:`application/json`});
      let file = (typeof File !== 'undefined') ? new File([blob],fileName,{type:`application/json`}) : blob;
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({title:`نسخة احتياطية`,files:[file]});
      } else {
        // Fallback: download
        let url=URL.createObjectURL(blob);
        let a=document.createElement(`a`); a.href=url; a.download=fileName; a.click();
        URL.revokeObjectURL(url);
        toast(`<i class="fa-solid fa-check ml-1"></i> تم تحميل ملف النسخة الاحتياطية`,`ok`);
      }
    } catch(err){ toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل التحميل / المشاركة`,`err`); }
  }
};

// ── Google Drive Sync ─────────────────────────────────────
window.initGoogleSession = async function() {
  if(!window.Capacitor || !window.Capacitor.Plugins.GoogleAuth) return;
  let GA = window.Capacitor.Plugins.GoogleAuth;
  try {
    await GA.initialize({
       clientId: "1073948569418-ek2de2jttbcjlicqjkg84gftgnoalab9.apps.googleusercontent.com",
       serverClientId: "1073948569418-ek2de2jttbcjlicqjkg84gftgnoalab9.apps.googleusercontent.com",
       scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"],
       grantOfflineAccess: true
    });
    
    // v5.0 Strategy: No auto-login on boot. We rely on the identity snapshot 
    // to keep the UI stable, and ONLY handshake during an actual sync.
    updateGoogleUI();
  } catch(e) { console.error("Google Auth Init Error:", e); }
};

window.updateGoogleUI = function() {
  let area = document.getElementById('googleAccountArea');
  if(!area) return;
  
  // Ghost Identity Resolution: v5.0 prioritizes UI stability.
  // We show the identity even if the session is currently dormant.
  let displayUser = googleUser || settings?.googleAccount || CACHED_CLOUD_USER;
  let hasActiveToken = !!(googleUser?.authentication?.accessToken);
  let isDormant = !googleUser && displayUser && displayUser.email;

  if(displayUser && displayUser.email) {
    area.innerHTML = `
      <div class="flex items-center justify-between p-3 rounded-xl bg-blue-50 border border-blue-100 mb-3 relative overflow-hidden transition-all duration-300">
        ${isDormant ? `<div class="absolute top-0 right-0 px-2 py-0.5 bg-amber-100 text-[8px] text-amber-600 font-bold rounded-bl-lg"><i class="fa-solid fa-clock mr-1"></i> بانتظار المزامنة...</div>`: `<div class="absolute top-0 right-0 px-2 py-0.5 bg-emerald-100 text-[8px] text-emerald-600 font-bold rounded-bl-lg"><i class="fa-solid fa-cloud-check mr-1"></i> متصل بالسحابة</div>`}
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-lg shadow-sm border-2 border-white">
            ${(displayUser.email || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="text-xs font-bold text-gray-800">${displayUser.name || 'مستخدم جوجل'}</div>
            <div class="text-[10px] text-gray-500">${displayUser.email || ''}</div>
          </div>
        </div>
        <div class="flex flex-col gap-1 items-end">
          <button onclick="signOutFromGoogle()" class="text-[9px] font-bold text-red-600 bg-red-100/50 hover:bg-red-100 px-1.5 py-0.5 rounded border border-red-200 relative z-10 transition-colors">
            <i class="fa-solid fa-right-from-bracket"></i>
          </button>
        </div>
      </div>
    `;
  } else {
    area.innerHTML = `
      <div class="p-4 rounded-xl bg-gray-50 border border-dashed border-gray-300 mb-3 text-center active:scale-95 transition-transform cursor-pointer" onclick="syncToGoogleDrive()">
        <div class="text-[11px] text-gray-600 mb-1 font-bold"><i class="fa-brands fa-google mr-1 text-blue-500"></i> ربط حساب جوجل للنسخ الاحتياطي</div>
        <div class="text-[9px] text-gray-400">سيتم حفظ نسخه من بياناتك تلقائياً عند التفعيل</div>
      </div>
    `;
  }
};

window.signOutFromGoogle = async function() {
  if(!confirm("هل أنت متأكد من تسجيل الخروج من جوجل؟ سيتم إيقاف المزامنة السحابية.")) return;
  try {
    await window.Capacitor.Plugins.GoogleAuth.signOut();
    googleUser = null;
    CACHED_CLOUD_USER = null;
    localStorage.removeItem('PA_CLOUD_CACHE');
    if(settings) settings.googleAccount = null;
    saveSettings();
    updateGoogleUI();
    toast("تم تسجيل الخروج بنجاح","ok");
  } catch(e) { toast("فشل تسجيل الخروج","err"); }
};

// ── Helper: Get or create the dedicated backup folder in Drive ─
async function getOrCreateDriveFolder(accessToken) {
  const FOLDER_NAME = 'سجل الحضور - نسخ احتياطية';
  // Search for existing folder
  let searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder' and name='${encodeURIComponent(FOLDER_NAME)}' and trashed=false&fields=files(id,name)`,
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );
  if (searchRes.ok) {
    let searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id; // Return existing folder ID
    }
  }
  // Create new folder
  let createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!createRes.ok) throw new Error('فشل إنشاء المجلد السحابي');
  let folder = await createRes.json();
  return folder.id;
}

window.syncToGoogleDrive = async function(isSilent = false) {
  let json = JSON.stringify({ S: settings, R: await RECDB.getAll() });
  let fileName = `Attendance_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  try {
    // v5.1 On-Demand Auth Handshake
    if(!googleUser && isSilent) return; // FIX 5.2: Stop immediately if silent and no user. Don't even init.

    if(!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.GoogleAuth) {
      if(!isSilent) toast("المزامنة السحابية متاحة فقط في تطبيق الجوال", "err");
      return;
    }
    let GA = window.Capacitor.Plugins.GoogleAuth;
    
    // Lazy Initialization (v5.2)
    try {
      await GA.initialize({
        clientId: '1073948569418-ek2de2jttbcjlicqjkg84gftgnoalab9.apps.googleusercontent.com',
        scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"],
        grantOfflineAccess: true
      });
    } catch(e) { console.warn("GoogleAuth Lazy Init:", e); }

    if(!googleUser) {
      toast(`<i class="fa-solid fa-key ml-1"></i> جاري الحصول على تصريح المزامنة...`,`ok`);
      try {
        googleUser = await GA.signIn({ scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"] });
      } catch(e) {
        toast(`فشل المزامنة: يرجى تسجيل الدخول أولاً`,`err`);
        return;
      }
    }

    // Refresh if needed (Best effort)
    if(googleUser && !googleUser.authentication?.accessToken) {
      console.log("Token missing, performing handshake...");
      try {
        googleUser = await GA.signIn({ scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"] });
      } catch(e) { /* ignore */ }
    }

    if(googleUser) {
        let profile = { name: googleUser.name, email: googleUser.email };
        settings.googleAccount = profile;
        CACHED_CLOUD_USER = profile;
        localStorage.setItem('PA_CLOUD_CACHE', JSON.stringify(profile));
        saveSettings();
        updateGoogleUI();
    }

    let accessToken = googleUser?.authentication?.accessToken;
    if(!accessToken) throw new Error("فشل الحصول على تصريح الوصول السحابي");

    if(!isSilent) toast(`<i class="fa-solid fa-cloud-arrow-up fa-bounce ml-1"></i> جاري الرفع...`,`ok`);

    // v5.3: Get or create dedicated backup folder
    let folderId = await getOrCreateDriveFolder(accessToken);

    // v5.4: Upload Settings and Records as SEPARATE files in parallel
    let ts = new Date().toISOString().replace(/[:.]/g, '-');

    async function uploadFileToDrive(name, data) {
      let meta = { name, mimeType: 'application/json', description: 'Backup', parents: [folderId] };
      let f = new FormData();
      f.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      f.append('file',     new Blob([JSON.stringify(data)], { type: 'application/json' }));
      return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
        body: f
      });
    }

    let [resS, resR] = await Promise.all([
      uploadFileToDrive(`CLOUD_SETTINGS_${ts}.json`, { type: 'settings', S: settings, d: new Date().toISOString() }),
      uploadFileToDrive(`CLOUD_RECORDS_${ts}.json`,  { type: 'records',  R: await RECDB.getAll(),  d: new Date().toISOString() })
    ]);

    if(resS.ok && resR.ok) {
      if(!isSilent) toast(`<i class="fa-solid fa-check ml-1"></i> تمت المزامنة! (إعدادات ⚙️ + سجلات 📋 منفصلة في السحابة)`,`ok`);
    } else {
      if(!isSilent) throw new Error("فشل رفع: " + (!resS.ok ? "الإعدادات" : "السجلات"));
    }
  } catch(err) {
    console.error('Sync Error:', err);
    if(!isSilent) toast(`فشل المزامنة: `+(err.message||err),`err`);
  }
};

window.browseCloudBackups = async function() {
  if(!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.GoogleAuth) {
    toast("المزامنة السحابية متاحة فقط في تطبيق الجوال", "err");
    return;
  }
  try {
    if(!googleUser) {
       googleUser = await window.Capacitor.Plugins.GoogleAuth.signIn({ scopes: ["https://www.googleapis.com/auth/drive.file"] });
       updateGoogleUI();
    }
    let accessToken = googleUser?.authentication?.accessToken;
    if(!accessToken) throw new Error("لا يوجد تصريح وصول");

    toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري البحث في السحابة...`,`ok`);

    // v5.3+v5.4: Search both CLOUD_SETTINGS and CLOUD_RECORDS files in dedicated folder
    let folderId2 = null;
    try { folderId2 = await getOrCreateDriveFolder(accessToken); } catch(e) { /* fallback */ }
    let folderQuery = folderId2 ? ` and '${folderId2}' in parents` : ``;
    
    let res = await fetch(`https://www.googleapis.com/drive/v3/files?q=(name contains 'CLOUD_SETTINGS_' or name contains 'CLOUD_RECORDS_' or name contains 'Attendance_Backup_') and trashed = false${folderQuery}&orderBy=createdTime desc&fields=files(id, name, createdTime)`, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    
    if(!res.ok) throw new Error("فشل جلب القائمة");
    let data = await res.json();
    let files = data.files || [];
    
    if(files.length === 0) {
      alert("لم يتم العثور على أي نسخ احتياطية في حسابك.");
      return;
    }

    let listHtml = files.map(f => {
      let d = new Date(f.createdTime);
      return `
        <div class="flex items-center justify-between p-3 border-b border-gray-100 last:border-0 active:bg-gray-50 transition-colors" onclick="restoreFromDrive('${f.id}')">
          <div class="flex items-center gap-3">
            <i class="fa-solid fa-file-invoice text-blue-500"></i>
            <div>
              <div class="text-[11px] font-bold text-gray-800">${f.name}</div>
              <div class="text-[9px] text-gray-500">${d.toLocaleString('ar-EG')}</div>
            </div>
          </div>
          <i class="fa-solid fa-chevron-left text-gray-300 text-[10px]"></i>
        </div>
      `;
    }).join('');

    let modal = document.createElement('div');
    modal.id = "cloudModal";
    modal.className = "fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70";
    modal.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in duration-200">
        <div class="p-4 border-b flex justify-between items-center">
          <h3 class="font-bold text-gray-800 text-sm"><i class="fa-brands fa-google-drive ml-1 text-blue-600"></i> نسخ السحابة</h3>
          <button onclick="this.closest('#cloudModal').remove()" class="text-gray-400 p-1"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          ${listHtml}
        </div>
        <div class="p-4 bg-gray-50 rounded-b-3xl text-[9px] text-center text-gray-400">
          اختر نسخة لاستعادتها. سيتم استبدال البيانات الحالية.
        </div>
      </div>
    `;
    document.body.appendChild(modal);

  } catch(e) {
    toast("فشل تصفح السحابة: " + e.message, "err");
  }
};

// ── Universal Multi-Version Backup Engine ───────────────────
window.parseAnyBackup = function(raw) {
  function parseCSVBackup(csvText) {
    let lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let records = [];
    let detected = false;
    let headerIndex = -1;
    let colMap = { date: -1, status: -1, checkIn: -1, checkOut: -1, note: -1, absenceType: -1 };
    
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      let line = lines[i];
      if (line.includes("التاريخ") || line.toLowerCase().includes("date") || line.includes("الحالة") || line.toLowerCase().includes("status")) {
        headerIndex = i;
        detected = true;
        let cols = line.split(",").map(c => c.replace(/"/g, "").trim());
        cols.forEach((col, idx) => {
          if (col.includes("التاريخ") || col.toLowerCase() === "date") colMap.date = idx;
          else if (col.includes("الحالة") || col.toLowerCase() === "status") colMap.status = idx;
          else if (col.includes("الحضور") || col.toLowerCase() === "checkin" || col.toLowerCase() === "check_in" || col.toLowerCase() === "in") colMap.checkIn = idx;
          else if (col.includes("الانصراف") || col.toLowerCase() === "checkout" || col.toLowerCase() === "check_out" || col.toLowerCase() === "out") colMap.checkOut = idx;
          else if (col.includes("ملاحظات") || col.toLowerCase() === "note" || col.toLowerCase() === "notes" || col.toLowerCase() === "comment") colMap.note = idx;
          else if (col.includes("نوع الغياب") || col.toLowerCase() === "absencetype" || col.toLowerCase() === "absence_type") colMap.absenceType = idx;
        });
        break;
      }
    }
    
    if (!detected || colMap.date === -1) {
      let testLine = lines[0] && lines[0].includes(",") ? lines[0] : (lines[1] && lines[1].includes(",") ? lines[1] : "");
      if (testLine) {
        let parts = testLine.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 2 && (parts[1].includes("/") || parts[1].includes("-"))) {
          colMap = { date: 1, status: 2, checkIn: 3, checkOut: 4, note: 5, absenceType: -1 };
          headerIndex = -1;
          detected = true;
        }
      }
    }
    
    if (detected) {
      let startRow = headerIndex + 1;
      for (let i = startRow; i < lines.length; i++) {
        let line = lines[i];
        if (!line || !line.includes(",")) continue;
        let parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        let dateVal = parts[colMap.date];
        if (!dateVal || dateVal === "التاريخ" || dateVal.toLowerCase() === "date") continue;
        
        let statusVal = colMap.status !== -1 ? parts[colMap.status] : "absent";
        let checkInVal = colMap.checkIn !== -1 ? parts[colMap.checkIn] : null;
        let checkOutVal = colMap.checkOut !== -1 ? parts[colMap.checkOut] : null;
        let noteVal = colMap.note !== -1 ? parts[colMap.note] : "";
        let absTypeVal = colMap.absenceType !== -1 ? parts[colMap.absenceType] : "";
        
        if (checkInVal === "-" || checkInVal === "لا يوجد" || !checkInVal) checkInVal = null;
        if (checkOutVal === "-" || checkOutVal === "لا يوجد" || !checkOutVal) checkOutVal = null;
        
        records.push({
          date: dateVal,
          status: statusVal,
          checkIn: checkInVal,
          checkOut: checkOutVal,
          note: noteVal,
          absenceType: absTypeVal
        });
      }
    }
    return records;
  }

  let parsed = raw;
  if (typeof raw === 'string') {
    let clean = raw.trim();
    if (clean.charCodeAt(0) === 0xFEFF) clean = clean.slice(1);
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    }
    
    if (clean.startsWith('{') || clean.startsWith('[')) {
      try {
        parsed = JSON.parse(clean);
      } catch(e) {
        throw new Error('الملف يبدو كـ JSON ولكنه يحتوي على أخطاء هيكلية: ' + e.message);
      }
    } else if (clean.includes(',') && clean.includes('\n')) {
      let csvRecs = parseCSVBackup(clean);
      if (csvRecs && csvRecs.length > 0) {
        parsed = { R: csvRecs };
      } else {
        throw new Error('الملف غير معروف التنسيق ولا يحتوي على سجلات صالحة');
      }
    } else {
      throw new Error('صيغة الملف غير مدعومة (يجب أن يكون نص JSON أو تقرير CSV)');
    }
  }
  
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('محتوى الملف فارغ أو غير صالح');
  }

  // Checksum verification if metadata exists
  if (parsed.metadata && parsed.metadata.checksum) {
    let currentHash = generateSimpleChecksum({ S: parsed.S || null, R: parsed.R || null });
    if (currentHash !== parsed.metadata.checksum) {
      console.warn("Checksum verification failed! Data might have been modified or corrupted.");
    } else {
      console.log("Backup checksum verified successfully!");
    }
  }

  let extractedRecords = [];
  let extractedSettings = null;

  // Step 1: Extract records from all known legacy & modern structures
  let rawRecs = null;
  if (Array.isArray(parsed)) {
    rawRecs = parsed;
  } else if (Array.isArray(parsed.R)) {
    rawRecs = parsed.R;
  } else if (Array.isArray(parsed.records)) {
    rawRecs = parsed.records;
  } else if (Array.isArray(parsed.recs)) {
    rawRecs = parsed.recs;
  } else if (Array.isArray(parsed.attendance)) {
    rawRecs = parsed.attendance;
  } else if (Array.isArray(parsed.pa_records)) {
    rawRecs = parsed.pa_records;
  } else if (Array.isArray(parsed.rows)) {
    rawRecs = parsed.rows;
  } else if (parsed.data && (Array.isArray(parsed.data.records) || Array.isArray(parsed.data.R) || Array.isArray(parsed.data))) {
    rawRecs = parsed.data.records || parsed.data.R || parsed.data;
  } else if (typeof parsed === 'object') {
    // Check if parsed is a dictionary of date keys: { "01/05/2024": {...}, "02/05/2024": {...} }
    let keys = Object.keys(parsed).filter(k => k !== 'S' && k !== 'settings' && k !== 'd' && k !== 'type' && k !== 'version');
    let isDateDict = keys.length > 0 && keys.every(k => k.includes('/') || k.includes('-'));
    if (isDateDict) {
      rawRecs = keys.map(k => {
        let item = parsed[k];
        if (typeof item === 'object' && item !== null) {
          return { ...item, date: item.date || k };
        }
        return { date: k, status: String(item) };
      });
    }
  }

  // Normalize extracted records from any version format
  if (rawRecs && Array.isArray(rawRecs)) {
    extractedRecords = rawRecs.map(r => {
      if (!r || typeof r !== 'object') return null;
      
      // Normalize Date
      let rawDate = r.date || r.Date || r.day || r.d;
      let dateKey = '';
      if (typeof rawDate === 'string') {
        rawDate = rawDate.trim();
        if (rawDate.includes('-')) {
          // ISO YYYY-MM-DD
          dateKey = isoToSlash(rawDate);
        } else if (rawDate.includes('/')) {
          let parts = rawDate.split('/').map(Number);
          if (parts.length === 3) {
            if (parts[0] > 1900) {
              // YYYY/MM/DD
              dateKey = makeDateKey(parts[0], parts[1] - 1, parts[2]);
            } else {
              // DD/MM/YYYY or D/M/YYYY
              dateKey = makeDateKey(parts[2], parts[1] - 1, parts[0]);
            }
          } else {
            dateKey = rawDate;
          }
        }
      } else if (rawDate instanceof Date) {
        dateKey = makeDateKey(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate());
      } else if (typeof rawDate === 'number') {
        let d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateKey = makeDateKey(d.getFullYear(), d.getMonth(), d.getDate());
        }
      }

      if (!dateKey) return null;

      let checkIn = r.checkIn || r.check_in || r.in || r.timeIn || r.start || null;
      let checkOut = r.checkOut || r.check_out || r.out || r.timeOut || r.end || null;
      let absenceType = r.absenceType || r.absence_type || r.absType || r.reason || '';
      let note = r.note || r.notes || r.comment || r.details || '';
      let travelAssignmentId = r.travelAssignmentId || null;
      
      let status = r.status || r.state || '';
      if (!status) {
        if (absenceType) status = 'absent';
        else if (checkIn) status = 'present';
        else status = 'absent';
      }
      // Normalize legacy status aliases
      if (status === 'p' || status === 'حضور' || status === 'Present') status = 'present';
      if (status === 'a' || status === 'غياب' || status === 'Absent') status = 'absent';
      if (status === 'holiday' || status === 'vacation') status = 'إجازة';

      return {
        id: r.id || r._id || r.uuid || uuid(),
        date: dateKey,
        status: status,
        checkIn: checkIn,
        checkOut: checkOut,
        absenceType: absenceType,
        note: note,
        auto: r.auto === true,
        travelAssignmentId: travelAssignmentId
      };
    }).filter(Boolean);
  }

  // Step 2: Extract settings from any legacy format
  let rawSettings = parsed.S || parsed.settings || parsed.config || parsed.pa_settings || (parsed.data && (parsed.data.S || parsed.data.settings));
  if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
    extractedSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // Merge settings safely
    Object.keys(rawSettings).forEach(key => {
      if (rawSettings[key] !== undefined && rawSettings[key] !== null) {
        extractedSettings[key] = rawSettings[key];
      }
    });
    // Ensure all modern arrays/objects are defined
    extractedSettings.workDays = Array.isArray(extractedSettings.workDays) ? extractedSettings.workDays : DEFAULT_SETTINGS.workDays;
    extractedSettings.absenceTypes = Array.isArray(extractedSettings.absenceTypes) ? extractedSettings.absenceTypes : DEFAULT_SETTINGS.absenceTypes;
    extractedSettings.customStatuses = Array.isArray(extractedSettings.customStatuses) ? extractedSettings.customStatuses : DEFAULT_SETTINGS.customStatuses;
    extractedSettings.holidays = Array.isArray(extractedSettings.holidays) ? extractedSettings.holidays : [];
    extractedSettings.schedules = Array.isArray(extractedSettings.schedules) ? extractedSettings.schedules : [];
    extractedSettings.daySchedules = (extractedSettings.daySchedules && typeof extractedSettings.daySchedules === 'object') ? extractedSettings.daySchedules : {};
    extractedSettings.compensations = Array.isArray(extractedSettings.compensations) ? extractedSettings.compensations : [];
    extractedSettings.travelAssignments = Array.isArray(extractedSettings.travelAssignments) ? extractedSettings.travelAssignments : [];
    extractedSettings.reportHeaders = Array.isArray(extractedSettings.reportHeaders) ? extractedSettings.reportHeaders : [];
    extractedSettings.reportFooters = Array.isArray(extractedSettings.reportFooters) ? extractedSettings.reportFooters : [];
    extractedSettings.exportColumns = (extractedSettings.exportColumns && typeof extractedSettings.exportColumns === 'object') ? { ...DEFAULT_SETTINGS.exportColumns, ...extractedSettings.exportColumns } : DEFAULT_SETTINGS.exportColumns;
  }

  if (!extractedRecords.length && !extractedSettings) {
    throw new Error('لم يتم العثور على سجلات أو إعدادات صالحة في هذا الملف.');
  }

  return {
    records: extractedRecords,
    settings: extractedSettings,
    date: parsed.d || parsed.date || parsed.timestamp || null,
    type: parsed.type || (extractedSettings && extractedRecords.length ? 'all' : (extractedRecords.length ? 'records' : 'settings'))
  };
};

window.showRestoreOptionsModal = function(backupPackage) {
  let oldModal = document.getElementById('restoreChoiceModal');
  if (oldModal && oldModal.parentNode) oldModal.parentNode.removeChild(oldModal);

  let recsCount = backupPackage.records ? backupPackage.records.length : 0;
  let hasSettings = !!backupPackage.settings;
  let employeeName = backupPackage.settings?.name || '';
  
  let dateRangeText = 'غير محدد';
  if (recsCount > 0) {
    let sortedDates = [...backupPackage.records].map(r => r.date).filter(Boolean);
    sortedDates.sort((a, b) => slashToISO(a).localeCompare(slashToISO(b)));
    if (sortedDates.length > 0) {
      dateRangeText = `من ${sortedDates[0]} إلى ${sortedDates[sortedDates.length - 1]}`;
    }
  }

  let modal = document.createElement('div');
  modal.id = 'restoreChoiceModal';
  modal.className = 'fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs';
  
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-3xl w-full max-w-md flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in duration-200">
      <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/40">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-black">
            <i class="fa-solid fa-file-import"></i>
          </div>
          <div>
            <h3 class="font-black text-sm">استعادة النسخة الاحتياطية</h3>
            <p class="text-[10px] opacity-60">تم التعرف على النسخة بنجاح وتوافقها مع التطبيق</p>
          </div>
        </div>
        <button onclick="this.closest('#restoreChoiceModal').remove()" class="w-8 h-8 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>

      <div class="p-4 space-y-3.5 max-h-[75vh] overflow-y-auto">
        <!-- Summary Stats Card -->
        <div class="p-3.5 rounded-2xl space-y-2" style="background: var(--c-surface2); border: 1px solid var(--c-border);">
          <div class="text-[11px] font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
            <i class="fa-solid fa-circle-check"></i>
            <span>محتويات ملف النسخة الاحتياطية:</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="p-2 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
              <div class="text-[10px] opacity-60 font-semibold">عدد السجلات</div>
              <div class="font-black text-base text-emerald-600 dark:text-emerald-400">${recsCount} يوم</div>
            </div>
            <div class="p-2 rounded-xl bg-white/60 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
              <div class="text-[10px] opacity-60 font-semibold">الإعدادات والمواعيد</div>
              <div class="font-black text-xs ${hasSettings ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}">${hasSettings ? (employeeName ? 'نعم (' + esc(employeeName) + ')' : 'متوفرة ✓') : 'غير موجودة'}</div>
            </div>
          </div>
          <div class="text-[10px] opacity-70 font-semibold px-1">
            <i class="fa-solid fa-calendar-range ml-1"></i> الفترة الزمنية: <span dir="ltr">${dateRangeText}</span>
          </div>
        </div>

        <div class="text-xs font-black opacity-80 pt-1">اختر طريقة الاستعادة المطلوبة:</div>

        <div class="space-y-2">
          ${recsCount > 0 && hasSettings ? `
            <button onclick="executeRestorePackage('full')" class="w-full p-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-right flex items-center justify-between transition-all group cursor-pointer">
              <div class="flex items-center gap-3">
                <span class="w-9 h-9 rounded-xl bg-blue-500 text-white flex items-center justify-center text-sm shadow-xs"><i class="fa-solid fa-rotate"></i></span>
                <div>
                  <div class="font-black text-xs text-blue-700 dark:text-blue-300">استبدال كامل (السجلات + الإعدادات)</div>
                  <div class="text-[10px] opacity-70">استعادة كل شيء كما كان في وقت أخذ النسخة</div>
                </div>
              </div>
              <i class="fa-solid fa-chevron-left text-xs text-blue-500 opacity-60 group-hover:translate-x-[-2px] transition-transform"></i>
            </button>
          ` : ''}

          ${recsCount > 0 ? `
            <button onclick="executeRestorePackage('merge')" class="w-full p-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-right flex items-center justify-between transition-all group cursor-pointer">
              <div class="flex items-center gap-3">
                <span class="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-sm shadow-xs"><i class="fa-solid fa-code-merge"></i></span>
                <div>
                  <div class="font-black text-xs text-emerald-700 dark:text-emerald-300">دمج ذكي مع السجلات الحالية (موصى به)</div>
                  <div class="text-[10px] opacity-70">إضافة أيام النسخة مع الإبقاء على أيامك وسجلاتك الحالية دون مسحها</div>
                </div>
              </div>
              <i class="fa-solid fa-chevron-left text-xs text-emerald-500 opacity-60 group-hover:translate-x-[-2px] transition-transform"></i>
            </button>
          ` : ''}

          ${recsCount > 0 ? `
            <button onclick="executeRestorePackage('records_only')" class="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-right flex items-center justify-between transition-all group cursor-pointer">
              <div class="flex items-center gap-3">
                <span class="w-9 h-9 rounded-xl bg-purple-500 text-white flex items-center justify-center text-sm shadow-xs"><i class="fa-solid fa-table-list"></i></span>
                <div>
                  <div class="font-black text-xs">استعادة السجلات فقط</div>
                  <div class="text-[10px] opacity-70">استبدال جدول الحضور فقط مع الحفاظ على إعداداتك ومواعيدك الحالية</div>
                </div>
              </div>
              <i class="fa-solid fa-chevron-left text-xs opacity-40 group-hover:translate-x-[-2px] transition-transform"></i>
            </button>
          ` : ''}

          ${hasSettings ? `
            <button onclick="executeRestorePackage('settings_only')" class="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-right flex items-center justify-between transition-all group cursor-pointer">
              <div class="flex items-center gap-3">
                <span class="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm shadow-xs"><i class="fa-solid fa-gear"></i></span>
                <div>
                  <div class="font-black text-xs">استعادة الإعدادات فقط</div>
                  <div class="text-[10px] opacity-70">استعادة المواعيد والإعدادات دون لمس سجلات الحضور الحالية</div>
                </div>
              </div>
              <i class="fa-solid fa-chevron-left text-xs opacity-40 group-hover:translate-x-[-2px] transition-transform"></i>
            </button>
          ` : ''}
        </div>
      </div>
      
      <div class="p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 text-[10px] text-center opacity-60 font-semibold">
        سيتم حفظ البيانات محلياً وتحديث الواجهة تلقائياً بعد الاختيار
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  window.executeRestorePackage = async function(mode) {
    document.getElementById('restoreChoiceModal')?.remove();
    toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري التحضير للاستعادة وبدء الفحص الوقائي...`, `ok`);

    // 1. GATHER SNAPSHOT FOR PRE-RESTORE SAFETY (Atomic Backup)
    let currentSettings = null;
    let currentRecords = [];
    try {
      currentSettings = await IDB.get(DB_KEYS.S);
      currentRecords = await RECDB.getAll() || [];
      
      // Save snapshot to IndexedDB under safe temporary key
      await IDB.set('pa_restore_safety_backup', { S: currentSettings, R: currentRecords, timestamp: Date.now() });
    } catch(snapshotErr) {
      console.warn("Failed to write safety snapshot to IndexedDB. Continuing with in-memory snapshot...", snapshotErr);
    }

    try {
      // 2. VALIDATION OF DATA TO RESTORE
      let recordsToWrite = [];
      let settingsToWrite = null;

      if (mode === 'full' || mode === 'records_only') {
        recordsToWrite = backupPackage.records || [];
      } else if (mode === 'merge') {
        let recsMap = new Map();
        currentRecords.forEach(r => {
          if (r && r.date) recsMap.set(r.date, r);
        });
        
        let backupRecs = backupPackage.records || [];
        backupRecs.forEach(r => {
          if (r && r.date) {
            let existing = recsMap.get(r.date);
            if (existing) {
              recsMap.set(r.date, { ...existing, ...r });
            } else {
              recsMap.set(r.date, r);
            }
          }
        });
        recordsToWrite = Array.from(recsMap.values());
      }

      if (mode === 'full' || mode === 'settings_only') {
        settingsToWrite = backupPackage.settings;
      }

      // De-duplicate recordsToWrite and assign indexes
      let finalRecsMap = new Map();
      recordsToWrite.forEach(r => {
        if (r && r.date) {
          let norm = normalizeSlashDate(r.date);
          r.date = norm;
          let m = RECDB._meta(norm);
          Object.assign(r, m); // Update yr and ym
          
          if (!r.id) r.id = uuid();
          
          if (finalRecsMap.has(norm)) {
            let prev = finalRecsMap.get(norm);
            if (r.checkIn && !prev.checkIn) {
              finalRecsMap.set(norm, r);
            }
          } else {
            finalRecsMap.set(norm, r);
          }
        }
      });
      recordsToWrite = Array.from(finalRecsMap.values());

      // 3. EXECUTE RESTORE
      toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري كتابة البيانات في قاعدة البيانات...`, `ok`);
      
      if (settingsToWrite) {
        await IDB.set(DB_KEYS.S, settingsToWrite);
      }
      
      if (mode === 'full' || mode === 'merge' || mode === 'records_only') {
        await RECDB.clearAll();
        if (recordsToWrite.length > 0) {
          await RECDB.putAll(recordsToWrite);
        }
      }

      // 4. POST-RESTORE VALIDATION
      toast(`<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري التحقق النهائي من سلامة البيانات المستعادة...`, `ok`);
      
      let testSettings = await IDB.get(DB_KEYS.S);
      let testRecords = await RECDB.getAll() || [];

      let isValid = true;
      let corruptionMessage = "";

      if (settingsToWrite) {
        if (!testSettings || typeof testSettings !== 'object' || !testSettings.workDays) {
          isValid = false;
          corruptionMessage = "فشل التحقق من صحة الإعدادات المستعادة";
        }
      }

      if (mode === 'full' || mode === 'merge' || mode === 'records_only') {
        if (testRecords.length !== recordsToWrite.length) {
          isValid = false;
          corruptionMessage = `عدد السجلات المستعادة في قاعدة البيانات (${testRecords.length}) لا يطابق العدد المطلوب (${recordsToWrite.length})`;
        }
        
        for (let tr of testRecords) {
          if (!tr || !tr.date || !tr.id) {
            isValid = false;
            corruptionMessage = "تم العثور على سجلات تالفة أو ناقصة بعد الاستعادة";
            break;
          }
        }
      }

      if (!isValid) {
        throw new Error(corruptionMessage);
      }

      // Success! Clean up safety snapshot
      try {
        await IDB.set('pa_restore_safety_backup', null);
      } catch(e){}

      toast(`<i class="fa-solid fa-check ml-1"></i> تمت الاستعادة بنجاح وأمان تام! جارٍ تحديث التطبيق...`, `ok`);
      setTimeout(() => location.reload(), 1200);

    } catch(err) {
      console.error('Safe restore failed, executing Rollback:', err);
      toast(`<i class="fa-solid fa-triangle-exclamation ml-1"></i> فشل الاستعادة: ${err.message || err}. جاري التراجع وإعادة البيانات السابقة...`, `err`);
      
      // 5. ROLLBACK TO PRE-RESTORE SNAPSHOT
      try {
        if (currentSettings) {
          await IDB.set(DB_KEYS.S, currentSettings);
        }
        await RECDB.clearAll();
        if (currentRecords.length > 0) {
          await RECDB.putAll(currentRecords);
        }
        toast(`<i class="fa-solid fa-rotate-left ml-1"></i> تم التراجع بنجاح واسترجاع بياناتك الأصلية بأمان.`, `ok`);
      } catch(rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
        toast(`خطأ حرج: تعذر التراجع التلقائي! يرجى إعادة تحميل التطبيق.`, `err`);
      }
    }
  };
};

window.restoreFromDrive = async function(fileId) {
  try {
    let accessToken = googleUser?.authentication?.accessToken;
    toast(`<i class="fa-solid fa-cloud-arrow-down fa-bounce ml-1"></i> جاري جلب النسخة من السحابة...`,`ok`);
    
    let res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    
    if(!res.ok) throw new Error("فشل تحميل الملف من السحابة");
    if(!res || typeof res.text !== 'function') throw new Error("استجابة غير صالحة من الخادم");
    let rawText = await res.text();
    let backupPackage = window.parseAnyBackup(rawText);
    
    document.getElementById('cloudModal')?.remove();
    window.showRestoreOptionsModal(backupPackage);
  } catch(e) {
    console.error('Restore from drive error:', e);
    toast("فشل الاستعادة من السحابة: " + (e.message || e), "err");
  }
};

// ── Restore from file (Local) ─────────────────────────────
window.restoreData=function(input){
  let file=input?.files?.[0]; if(!file) return;
  let reader=new FileReader();
  reader.onload=async function(ev){
    try{
      let rawText = ev.target.result;
      let backupPackage = window.parseAnyBackup(rawText);
      window.showRestoreOptionsModal(backupPackage);
    } catch(err){
      console.error(`Restore error:`,err);
      toast(`<i class="fa-solid fa-xmark ml-1"></i> تعذر قراءة الملف: `+(err.message||err),`err`);
    } finally {
      input.value = ''; // Reset input to allow re-selecting same file
    }
  };
  reader.onerror=function(){ toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل قراءة الملف`,`err`); };
  reader.readAsText(file);
};

// ── Auto backup (local IndexedDB, last 7 days) ────────────
async function doAutoBackup(){
  if(!settings.autoBackup) return;
  try{
    let now = new Date();
    let today = now.toISOString().split(`T`)[0];
    
    // Check if backup is due for today
    if(settings.lastBackupDate === today) return;

    let interval = settings.backupInterval || 'daily';
    let targetTime = settings.backupTime || '00:00';
    let [th, tm] = targetTime.split(':').map(Number);
    let currentTotalM = now.getHours() * 60 + now.getMinutes();
    let targetTotalM = th * 60 + tm;

    if(currentTotalM < targetTotalM) return; // Not time yet today

    let shouldRun = false;
    if(interval === 'daily') {
      shouldRun = true;
    } else if(interval === 'weekly') {
      if(now.getDay() === (settings.backupDay || 0)) shouldRun = true;
    } else if(interval === 'monthly') {
      if(now.getDate() === (settings.backupDate || 1)) shouldRun = true;
    }

    if(!shouldRun) return;

    if (!window.IDB) throw new Error("IndexedDB not available for auto-backup");

    let backups=await IDB.get(`pa_backups`)||{};
    if(backups[today]) {
        console.log('Auto backup already exists for', today);
    } else {
      let allRecs = await RECDB.getAll();
      if(allRecs.length>0||settings.name){
        backups[today]={S:JSON.parse(JSON.stringify(settings)),R:allRecs};
      let keys=Object.keys(backups).sort();
      while(keys.length>10){delete backups[keys.shift()];keys=Object.keys(backups).sort();}
      await IDB.set(`pa_backups`,backups);
      settings.lastBackupDate = today;
      saveSettings();
      console.log('Auto backup created for', today);
    }

    // NEW: Cloud Auto Sync
    if(settings.cloudAutoSync) {
      console.log('Triggering cloud auto-sync...');
      syncToGoogleDrive(true);
    }
  }
  } catch(err){ 
    console.error(`Auto backup error:`,err);
    // Non-fatal, just log
  }
}

// ── Restore auto backup ───────────────────────────────────
window.restoreAutoBackup=async function(){
  try{
    let backups=await IDB.get(`pa_backups`)||{};
    let keys=Object.keys(backups).sort((a,b)=>b.localeCompare(a));
    if(!keys.length) return toast(`<i class="fa-solid fa-xmark ml-1"></i> لا توجد نسخ تلقائية محلياً`,`err`);
    let latest=backups[keys[0]];
    if(!confirm(`هل تريد استعادة أحدث نسخة احتياطية بتاريخ ${keys[0]}؟ لا يمكن التراجع!`)) return;
    await IDB.set(DB_KEYS.S,latest.S);
    await RECDB.clearAll();
    await RECDB.putAll(latest.R);
    toast(`<i class="fa-solid fa-check ml-1"></i> تم الاستعادة بنجاح! جارٍ التحديث...`,`ok`);
    if(typeof location !== 'undefined' && location.reload) location.reload(); else if(typeof window !== 'undefined' && window.location && window.location.reload) window.location.reload();
  } catch(err){ toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل الاستعادة: `+(err.message||err),`err`); }
};

// ── Data management ───────────────────────────────────────
window.clearRecs=async function(){
  if(!confirm(`هل أنت متأكد من تفريغ كافة سجلات الحضور الحالية مع الإبقاء على الأيام والتواريخ؟`))return;
  let backup=await RECDB.getAll();
  if(!backup || backup.length === 0){
    toast("لا توجد سجلات لتفريغها", "err");
    return;
  }
  let clearedRecs = backup.map(rec => {
    let d = new Date(slashToISO(rec.date));
    let status = 'absent';
    let note = '';
    if (!isNaN(d.getTime())) {
      if (typeof isHoliday === 'function' && isHoliday(d)) {
        status = 'إجازة';
        note = typeof getHolidayLabel === 'function' ? getHolidayLabel(d) : 'إجازة رسمية';
      } else if (typeof isWorkDay === 'function' && !isWorkDay(d)) {
        status = 'إجازة';
        note = 'إجازة أسبوعية';
      }
    }
    return {
      id: rec.id || uuid(),
      date: rec.date,
      checkIn: '',
      checkOut: '',
      status: status,
      absenceType: '',
      note: note,
      auto: true,
      late: 0,
      early: 0,
      overtime: 0
    };
  });
  await RECDB.putAll(clearedRecs);
  let nowD=new Date();
  _monthCache=await RECDB.getMonth(nowD.getFullYear(),nowD.getMonth());
  _monthCacheKey=`${nowD.getFullYear()}-${nowD.getMonth()}`;
  let todayRec=await RECDB.get(todayKey());
  records=todayRec?[todayRec]:[];
  await renderRecords();
  renderHome();
  showUndoable(`<i class="fa-solid fa-rotate-left ml-1"></i> تم تفريغ محتوى السجلات`,async ()=>{
    await RECDB.putAll(backup);
    let nowD=new Date();
    _monthCache=await RECDB.getMonth(nowD.getFullYear(),nowD.getMonth());
  _monthCacheKey=`${nowD.getFullYear()}-${nowD.getMonth()}`;
  let todayRec=await RECDB.get(todayKey());
    records=todayRec?[todayRec]:[];
    await renderRecords();
    renderHome();
  });
};
window.resetSettings=function(){if(!confirm(`هل أنت متأكد من استعادة إعدادات التطبيق الافتراضية؟`))return;Object.assign(settings,DEFAULT_SETTINGS);saveSettings();renderSettingsPage();renderHome();toast(`تم الإرجاع`,`ok`);};
window.clearAll=async function(){if(!confirm(`هل أنت متأكد من مسح جميع البيانات؟ لا يمكن التراجع عن هذا الإجراء!`))return;await IDB.clear();location.reload();};

// ── PDF Export ────────────────────────────────────────────
window.prepareExportPDF = function() {
  // Clear cached PDF canvas so a fresh one is built each time
  pdfCanvasesCache = null;

  // Reset state: hide preview and success areas, show action buttons
  let sa = document.getElementById(`expSuccessArea`);
  let pa = document.getElementById(`expPreviewArea`);
  let ab = document.getElementById(`expActionBtns`);
  let box = document.getElementById(`exportMBox`);
  if(sa) sa.classList.add(`hidden`);
  if(pa) pa.classList.add(`hidden`);
  if(ab) ab.classList.remove(`hidden`);
  if(box) box.style.maxWidth = ``;

  // Pre-fill report title and file name from settings if saved
  let rt = document.getElementById(`expReportTitle`);
  let fn = document.getElementById(`expFileName`);
  if(rt && !rt.value) rt.value = settings.lastReportTitle || '';
  if(fn && !fn.value) {
    let d = new Date();
    fn.value = `Attendance_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  // Open the main export modal (Preview / Share / Save)
  const modal = document.getElementById('exportM');
  if(modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

window.closeExpM = function() {
  const modal = document.getElementById('exportM');
  if(modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.saveExportColSettings = function(col, val) {
  if(!settings.exportColumns) settings.exportColumns = { date:true, checkIn:true, checkOut:true, status:true, late:true, early:true, overtime:true, absenceType:true, note:true };
  settings.exportColumns[col] = val;
  saveSettings();
};



// [DELETED REDUNDANT saveExportCols TO FIX CONFLICT]

var pdfCanvasesCache=null;
async function buildPDFCanvas(){
  if(pdfCanvasesCache) return pdfCanvasesCache;
  toast(`جارٍ معالجة التقرير...`,``);
  if(document.body && document.body.classList) document.body.classList.add(`printing`);

  // Ensure fonts are loaded in browser memory before canvas rasterization
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
      await Promise.all([
        document.fonts.load('700 22px Cairo'),
        document.fonts.load('600 13px Cairo'),
        document.fonts.load('400 17px Cairo')
      ]);
    } catch(e) {
      console.warn('PDF font preload:', e);
    }
  }

  // Safety: ensure exportColumns is always defined before building
  if(!settings.exportColumns) settings.exportColumns = { date:true, checkIn:true, checkOut:true, status:true, late:true, early:true, overtime:true, absenceType:true, note:true };
  let container=document.getElementById(`pz`); if(!container) return null;
  container.className=`fixed left-0 top-0 bg-white block`;
  container.style.width=`1200px`;
  container.style.minWidth=`1200px`;
  container.style.maxWidth=`1200px`;
  container.style.fontFamily=`'Cairo','Tajawal','Noto Sans Arabic',Arial,sans-serif`;
  container.style.letterSpacing=`0px`;
  container.style.wordSpacing=`0px`;
  container.style.textRendering=`geometricPrecision`;
  container.style.webkitFontSmoothing=`antialiased`;
  container.setAttribute(`dir`,`rtl`);
  container.style.direction=`rtl`;
  
  let periodLabel=``;
  let filtered=[];
  if(periodMode===`custom`){
    let dsEl=document.getElementById(`dateStart`),deEl=document.getElementById(`dateEnd`); let ds=dsEl?dsEl.value:'',de=deEl?deEl.value:'';
    if(ds&&de){
      periodLabel=`من `+isoToSlash(ds)+` إلى `+isoToSlash(de);
      filtered = await RECDB.getRange(ds, de);
    }
  } else {
    periodLabel=document.getElementById(`monthIn`)?document.getElementById(`monthIn`).value:MONTHS[viewMonth]+` `+viewYear;
    filtered = await RECDB.getMonth(viewYear, viewMonth);
  }

  let sf=document.getElementById(`statusFilter`).value;
  if(sf===`present`) filtered=filtered.filter(r=>isPresent(r.status));
  else if(sf===`absent`) filtered=filtered.filter(r=>r.status===`absent`);
  else if(sf===`holiday`) filtered=filtered.filter(r=>r.status===`إجازة رسمية`||r.status===`إجازة`||r.status===`تكليف سفر`);
  else if(sf===`travel`) filtered=filtered.filter(r=>r.status===`تكليف سفر`);
  else if(sf===`late`) filtered=filtered.filter(r=>{if(!isPresent(r.status))return false;let d=new Date(slashToISO(r.date));return lateMin(r.checkIn,getSchedule(d.getFullYear(),d.getMonth(),d).start)>0;});
  else if(sf===`overtime`) filtered=filtered.filter(r=>hasOvertime(r));
  filtered.sort((a,b)=>slashToISO(b.date).localeCompare(slashToISO(a.date)));

  let themePri = settings.themeColor===`green`?`#10b981` : `#3b82f6`;
  let themeLight = settings.themeColor===`green`?`#ecfdf5` : `#eff6ff`;
  
  let sumLate=0, sumEarly=0, sumExtra=0;
  let allRowsHtmlFiles = [];
  let allRowsUnits = [];
  filtered.forEach(r=>{
    let d=new Date(slashToISO(r.date)),sch=getSchedule(d.getFullYear(),d.getMonth(),d);
    let isLateComp = (settings.compensations || []).some(c => c.date === r.date && c.type === 'late');
    let isEarlyComp = (settings.compensations || []).some(c => c.date === r.date && c.type === 'early');
    let late=isPresent(r.status)?(isLateComp ? 0 : lateMin(r.checkIn,sch.start)):0;
    let early=r.checkOut?(isEarlyComp ? 0 : earlyMin(r.checkOut,sch.end)):0;
    let isHol = isHoliday(d) || !isWorkDay(d);
    let extra = 0;
    if (isHol && r.checkIn && r.checkOut) {
      let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, em] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
      extra = (eh*60+em) - (sh*60+sm);
      if (extra < 0) extra += 1440;
    } else if (r.checkOut) {
      extra = extraMin(r.checkOut,sch.overtimeStart);
    }
    sumLate += late; sumEarly += early; sumExtra += extra;
    let lateDec=isLateComp?'معوّض':(late>0?formatMin(late):`-`);
    let earlyDec=isEarlyComp?'معوّض':(early>0?formatMin(early):`-`);
    
    // Status colors mapping (Matching UI logic)
    let sc = r.status===`absent` ? `#ef4444` : r.status===`تكليف سفر` ? `#a855f7` : (r.status===`إجازة رسمية` || r.status===`إجازة`) ? `#3b82f6` : (late>0 ? `#f59e0b` : themePri);
    let rowBg = r.status===`absent` ? `#fef2f2` : r.status===`تكليف سفر` ? `#f3e8ff` : (r.status===`إجازة رسمية` || r.status===`إجازة`) ? `#eff6ff` : (late>0 ? `#fffbeb` : `#ffffff`);
    let rowBorder = r.status==='absent' ? '#ef4444' : r.status===`تكليف سفر` ? '#a855f7' : (r.status===`إجازة رسمية` || r.status===`إجازة`) ? '#3b82f6' : (late>0 ? '#f59e0b' : themePri);

    let leaveComp = (settings.compensations || []).find(c => c.date === r.date && c.type === 'leave');
    let pdfNote = r.note || '';
    if (leaveComp) {
      let sourceDesc = formatCompSourceText(leaveComp, false);
      let compNote = leaveComp.note ? leaveComp.note : '';
      let compDetailStr = `خصم ${formatMin(leaveComp.minutes)} ${sourceDesc}`;
      pdfNote = compNote ? `${compNote} - ${compDetailStr}` : compDetailStr;
      if (r.note && !r.note.includes('خصم') && !r.note.includes('الإضافي') && r.note !== compNote) {
        pdfNote = `${r.note} | ${pdfNote}`;
      }
    }

    allRowsHtmlFiles.push(`<tr style="background:${rowBg}; border-bottom:1px solid #e2e8f0; border-right:4px solid ${rowBorder};">
      ${settings.exportColumns.date ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; color:#111827; border:1px solid #cbd5e1; border-right:none;" lang="en" dir="ltr">${r.date}</td>` : ''}
      ${settings.exportColumns.day ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; color:#475569; border:1px solid #cbd5e1;">${DAYS[d.getDay()]}</td>` : ''}
      ${settings.exportColumns.checkIn ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; color:#111827; border:1px solid #cbd5e1;" lang="en" dir="ltr">${r.checkIn?fmt12(r.checkIn):`-`}</td>` : ''}
      ${settings.exportColumns.checkOut ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; color:#111827; border:1px solid #cbd5e1;" lang="en" dir="ltr">${r.checkOut?fmt12(r.checkOut):`-`}</td>` : ''}
      ${settings.exportColumns.status ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; border:1px solid #cbd5e1; color:${sc}">${r.status==='present'?'حاضر':(r.status==='absent'?'غائب':esc(r.status))}</td>` : ''}
      ${settings.exportColumns.late ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; border:1px solid #cbd5e1; color:#d97706;" lang="en" dir="ltr">${lateDec}</td>` : ''}
      ${settings.exportColumns.early ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; border:1px solid #cbd5e1; color:#dc2626;" lang="en" dir="ltr">${earlyDec}</td>` : ''}
      ${settings.exportColumns.overtime ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; border:1px solid #cbd5e1; color:#2563eb;" lang="en" dir="ltr">${extra>0?'+'+formatMin(extra):'-'}</td>` : ''}
      ${settings.exportColumns.absenceType ? `<td style="padding:10px 8px; font-size:16px; font-weight:900; color:#111827; border:1px solid #cbd5e1; max-width:140px; word-break: break-word; line-height: 1.4; vertical-align: middle;">${r.status===`absent`&&r.absenceType?esc(r.absenceType):(r.status==='إجازة من الإضافي'?'إجازة تعويض إضافي':'')}</td>` : ''}
      ${settings.exportColumns.note ? `<td style="padding:10px 8px; font-size:16px; font-weight:800; font-family: '${settings.noteFont||'Cairo'}', serif; color:#111827; border:1px solid #cbd5e1; border-left:none; text-align:right; max-width:260px; word-break: break-word; line-height: 1.4; vertical-align: middle;">${esc(pdfNote)||``}</td>` : ''}
    </tr>`);
    
    // Dynamic weight for row height and notes
    let noteText = settings.exportColumns.note && pdfNote ? String(pdfNote).trim() : "";
    let absText = settings.exportColumns.absenceType && r.absenceType && r.status === 'absent' ? String(r.absenceType).trim() : "";
    let noteLines = 1;
    if (noteText) {
      let explicitLines = noteText.split(/\r\n|\r|\n/);
      noteLines = 0;
      explicitLines.forEach(line => {
        noteLines += Math.max(1, Math.ceil(line.length / 28));
      });
    }
    let absLines = absText ? Math.max(1, Math.ceil(absText.length / 18)) : 1;
    let maxVisualLines = Math.max(1, noteLines, absLines);
    let rowWeight = 1.0 + (maxVisualLines - 1) * 0.65;
    allRowsUnits.push(rowWeight);
  });

  let totalLateDec = formatMin(sumLate);
  let totalEarlyDec = formatMin(sumEarly);
  let totalExtraDec = formatMin(sumExtra);

  themePri = settings.themeColor===`green`?`#10b981` : `#3b82f6`;
  themeLight = settings.themeColor===`green`?`#ecfdf5` : `#eff6ff`;
  let repTitle = (document.getElementById('expReportTitle') && document.getElementById('expReportTitle').value.trim()) || 'تقرير الحضور والغياب';

  let PAGE_MAX_UNITS = 31; // Fills ~92% of A4 page without overlapping footer
  let totalUnits = allRowsUnits.reduce((a, b) => a + b, 0);
  let numChunks = Math.max(1, Math.ceil(totalUnits / PAGE_MAX_UNITS));
  let targetUnitsPerChunk = totalUnits / numChunks;

  let chunks = [];
  let currentChunk = [];
  let currentUnits = 0;

  for(let j = 0; j < allRowsHtmlFiles.length; j++) {
    let u = allRowsUnits[j];
    if (chunks.length < numChunks - 1 && (currentUnits >= targetUnitsPerChunk || currentUnits + u > PAGE_MAX_UNITS) && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentUnits = 0;
    } else if (currentUnits + u > PAGE_MAX_UNITS && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentUnits = 0;
    }
    currentChunk.push(allRowsHtmlFiles[j]);
    currentUnits += u;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  if (chunks.length === 0) chunks.push([]);

  // Smart Text Filtering for PDF exports
  let sanitizeReportText = function(str) {
    if (!str || typeof str !== 'string') return str || '';
    return str.replace(/unisoft/gi, '')
              .replace(/UniSoft/gi, '')
              .replace(/www\.[a-z0-9-]+\.[a-z]{2,}/gi, '')
              .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '')
              .trim();
  };

  let baseHeader = function(pageNumber, totalPages) {
    let customHeaderContent = '';
    if (settings.activeHeaderId === 'none') {
      customHeaderContent = '';
    } else if (settings.activeHeaderId && settings.activeHeaderId !== 'default' && settings.activeHeaderId !== '') {
      let h = (settings.reportHeaders || []).find(x => x.id === settings.activeHeaderId);
      if (h) {
        customHeaderContent = sanitizeReportText(h.content.replace(/{{pageNumber}}/g, pageNumber).replace(/{{totalPages}}/g, totalPages));
      }
    } else if (settings.headerImage) {
      customHeaderContent = `<div style="width:100%; text-align:center; margin-bottom:15px; border-bottom:2px solid #cbd5e1; padding-bottom:10px;">
        <img src="${settings.headerImage}" style="max-width:100%; max-height:80px; object-fit:contain;" />
      </div>`;
    } else {
      // Default Professional Dual-Language Header
      let titleAr = sanitizeReportText(settings.headerTitleAr || repTitle || 'سجل الحضور والغياب');
      let titleEn = sanitizeReportText(settings.headerTitleEn || 'Attendance & Absence Record');
      let subAr = sanitizeReportText(settings.headerSubAr || `الموظف: ${settings.name} | الفترة: ${periodLabel}`);
      let subEn = sanitizeReportText(settings.headerSubEn || `Employee: ${settings.name}`);

      customHeaderContent = `<!-- Professional Dual-Language PDF Header -->
      <div style="padding:25px 40px 15px; background:#ffffff; border-bottom:2px solid #cbd5e1; margin-bottom:15px; direction:rtl; font-family:'Cairo','Tajawal',Arial,sans-serif; letter-spacing:0px !important; word-spacing:0px !important;">
        <table style="width:100%; border:none; border-collapse:collapse; margin:0; padding:0; background:transparent;">
          <tr>
            <td style="width:50%; text-align:right; vertical-align:middle; border:none; padding:0; direction:rtl; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
              <div style="font-size:22px; font-weight:700; color:#1B3D6D; line-height:1.3; font-family:'Cairo',Arial,sans-serif; margin:0 0 4px 0; letter-spacing:0px !important;">${titleAr}</div>
              <div style="font-size:13px; font-weight:600; color:#475569; font-family:'Cairo',Arial,sans-serif; margin:0; letter-spacing:0px !important;">${subAr}</div>
            </td>
            <td style="width:50%; text-align:left; vertical-align:middle; border:none; padding:0; direction:ltr; font-family:sans-serif;">
              <div style="font-size:18px; font-weight:700; color:#1B3D6D; line-height:1.3; font-family:sans-serif; margin:0 0 4px 0;">${titleEn}</div>
              <div style="font-size:12px; font-weight:600; color:#475569; font-family:sans-serif; margin:0;">${subEn}</div>
            </td>
          </tr>
        </table>
        <table style="width:100%; border:none; border-collapse:collapse; margin-top:10px; padding-top:6px; border-top:1px solid #e2e8f0; font-size:12px; color:#64748b; font-weight:600; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
          <tr>
            <td style="text-align:right; border:none; padding:4px 0; direction:rtl; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
              تاريخ التقرير: <span style="color:#1B3D6D; font-family:sans-serif;">${todayKey()}</span>
            </td>
            <td style="text-align:left; border:none; padding:4px 0; direction:rtl; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
              الصفحة <span style="color:#1B3D6D; font-family:sans-serif;">${pageNumber}</span> من <span style="font-family:sans-serif;">${totalPages}</span>
            </td>
          </tr>
        </table>
      </div>`;
    }

    return `<div style="font-family:'Cairo','Tajawal',Arial,sans-serif; letter-spacing:0px !important; word-spacing:0px !important; width:1200px; height:1697px; background:#ffffff; color:#1e293b; padding:0; direction:rtl; margin:0 auto; position:relative; overflow:hidden;">
      ${customHeaderContent}
      
      <!-- Table Body -->
      <div style="padding:15px 40px 80px;">
        <table style="width:100%; border-collapse:collapse; text-align:center; font-size:16px; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">
          <thead>
            <tr style="background:${themePri}; color:#ffffff; font-family:'Cairo',sans-serif;">
              ${settings.exportColumns.date ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; border-right:none; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">التاريخ</th>` : ''}
              ${settings.exportColumns.day ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">اليوم</th>` : ''}
              ${settings.exportColumns.checkIn ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">الحضور</th>` : ''}
              ${settings.exportColumns.checkOut ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">الانصراف</th>` : ''}
              ${settings.exportColumns.status ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">الحالة</th>` : ''}
              ${settings.exportColumns.late ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">تأخير</th>` : ''}
              ${settings.exportColumns.early ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">مبكر</th>` : ''}
              ${settings.exportColumns.overtime ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">إضافي</th>` : ''}
              ${settings.exportColumns.absenceType ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; border:2px solid ${themePri}; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">نوع الغياب</th>` : ''}
              ${settings.exportColumns.note ? `<th style="padding:12px 8px; font-size:17px; font-weight:700; text-align:right; border:2px solid ${themePri}; border-left:none; font-family:'Cairo',sans-serif; letter-spacing:0px !important;">ملاحظات</th>` : ''}
            </tr>
          </thead>
          <tbody>`;
  };

  let baseFooter = function(pageNumber, totalPages, sumBlockHtml) {
    let sb = sumBlockHtml ? sumBlockHtml : '';
    if (settings.activeFooterId === 'none') return '</tbody></table>' + sb + '</div></div>';
    if (settings.activeFooterId && settings.activeFooterId !== 'default' && settings.activeFooterId !== '') {
      let f = (settings.reportFooters || []).find(x => x.id === settings.activeFooterId);
      if (f) return '</tbody></table>' + sb + '</div>' + sanitizeReportText(f.content.replace(/{{pageNumber}}/g, pageNumber).replace(/{{totalPages}}/g, totalPages)) + '</div>';
    }

    if (settings.footerImage) {
      return `</tbody></table>${sb}</div>
        <div style="position:absolute; bottom:15px; left:0; right:0; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px;">
          <img src="${settings.footerImage}" style="max-width:100%; max-height:50px; object-fit:contain;" />
        </div>
      </div>`;
    }

    let contactAr = sanitizeReportText(settings.footerContactAr || 'تقرير آلي صادر من نظام سجل الحضور والغياب الشخصي');
    let contactEn = sanitizeReportText(settings.footerContactEn || 'Generated automatically by Personal Attendance System');

    return `</tbody></table>${sb}</div>
      
      <!-- Professional Footer Banner & Page Numbering -->
      <div style="position:absolute; bottom:15px; left:40px; right:40px; border-top:1px solid #cbd5e1; padding-top:10px; z-index:10; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
        <table style="width:100%; border:none; border-collapse:collapse; background:#1B3D6D; color:#ffffff; border-radius:6px; padding:6px 12px; margin:0;">
          <tr>
            <td style="text-align:right; border:none; padding:8px 14px; font-size:11px; font-weight:600; direction:rtl; font-family:'Cairo',Arial,sans-serif; letter-spacing:0px !important;">
              ${contactAr}
            </td>
            <td style="text-align:center; border:none; padding:8px 6px; font-size:12px; font-weight:700; font-family:sans-serif; white-space:nowrap;">
              Page <span dir="ltr">${pageNumber}</span> of <span dir="ltr">${totalPages}</span>
            </td>
            <td style="text-align:left; border:none; padding:8px 14px; font-size:10px; font-weight:500; font-family:sans-serif; direction:ltr;">
              ${contactEn}
            </td>
          </tr>
        </table>
      </div>
    </div>`;
  };

  let opts = { scale: 1.5, useCORS: true, allowTaint: true, logging: false, width: 1200, windowWidth: 1200, x: 0, y: 0, scrollY: 0, scrollX: 0 };
  let processCvs = [];

  for(let i=0; i<chunks.length; i++) {
     let isLast = (i === chunks.length - 1);
     let sumBlock = "";
     if(isLast) {
       sumBlock = `<div style="display:flex; justify-content:space-between; background:#f8fafc; border:2px dashed #cbd5e1; padding:16px 24px; margin-top:20px; font-weight:bold; font-size:17px; color:#334155; font-feature-settings:'tnum'; border-radius:12px;">
      <div><span lang="en" dir="rtl">${periodLabel}</span> (إجمالي)</div>
      <div>حضور: <span lang="en" dir="ltr" style="color:${themePri}">${monthSummary.p}</span></div>
      <div style="color:#dc2626;">غياب: <span lang="en" dir="ltr">${monthSummary.a}</span></div>
      <div style="color:#d97706;">تأخير: <span lang="en" dir="rtl">${totalLateDec}</span></div>
      <div style="color:#dc2626;">مبكر: <span lang="en" dir="rtl">${totalEarlyDec}</span></div>
      <div style="color:#059669;">إضافي: <span lang="en" dir="rtl">${totalExtraDec}</span></div>
    </div>`;
     }
     container.innerHTML = baseHeader(i+1, chunks.length + 1) + chunks[i].join('') + baseFooter(i+1, chunks.length + 1, sumBlock);
     
     // Minor delay between pages to allow UI thread to breath and avoid "Application hanging"
     await new Promise(r => setTimeout(r, 80)); 
     
     let h2c = typeof html2canvas !== 'undefined' ? html2canvas : (window.html2canvas || null);
      if(!h2c) return null;
      let cv = await h2c(container, opts);
     processCvs.push(cv.toDataURL('image/jpeg', 1.0));
     cv = null; // Free memory immediately
  }

  container.innerHTML = `<div style="font-family:'Cairo',Arial,sans-serif; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; letter-spacing: normal !important; word-spacing: normal !important; width:1200px; height:1697px; background:#ffffff; color:#1e293b; padding:0; direction:rtl; margin:0 auto; position:relative; overflow:hidden;">
    <div style="padding:60px 60px 30px; text-align:center; border-bottom:4px solid ${themePri}; background:#f8fafc; position:relative; letter-spacing: normal !important;">
      <h1 style="font-size:46px; margin:0; font-weight:900; color:${themePri}; letter-spacing: normal !important; word-spacing: normal !important;">ملخص الإحصائيات والاعتماد النهائي</h1>
      <div style="font-size:20px; color:#475569; font-weight:bold; margin-top:15px; letter-spacing: normal !important;">الموظف: <span style="color:#0f172a">${settings.name}</span> | تقرير: <span style="color:#0f172a">${repTitle}</span></div>
    </div>
    
    <div style="padding:80px 60px;">
      <div style="border:3px solid ${themePri}; border-radius:24px; padding:60px; background:#f8fafc; position:relative; letter-spacing: normal !important;">
          <div style="position:absolute; top:-30px; right:50px; background:${themePri}; color:white; padding:10px 40px; font-size:24px; font-weight:900; border-radius:30px; letter-spacing: normal !important;">ملخص جميع الفترات</div>
          <div style="display:flex; flex-wrap:wrap; gap:40px; justify-content:center; margin-top:30px; font-feature-settings:'tnum'; letter-spacing: normal !important;">
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:${themePri}; margin-bottom:15px;" lang="en" dir="ltr">${monthSummary.p}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">إجمالي أيام الحضور</div>
              </div>
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:#dc2626; margin-bottom:15px;" lang="en" dir="ltr">${monthSummary.a}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">إجمالي أيام الغياب</div>
              </div>
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:#d97706; margin-bottom:15px;" lang="en" dir="ltr">${monthSummary.l}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">أيام التأخير</div>
              </div>
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:#d97706; margin-bottom:15px;" lang="en" dir="ltr">${totalLateDec}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">إجمالي ساعات التأخير</div>
              </div>
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:#dc2626; margin-bottom:15px;" lang="en" dir="ltr">${totalEarlyDec}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">ساعات الخروج المبكر</div>
              </div>
              <div style="background:white; border-radius:20px; padding:40px 20px; width:28%; border:3px solid #cbd5e1; text-align:center;">
                  <div style="font-size:52px; font-weight:900; color:#059669; margin-bottom:15px;" lang="en" dir="ltr">${totalExtraDec}</div>
                  <div style="font-size:22px; font-weight:900; color:#111827; letter-spacing: normal !important;">إجمالي وقت العمل الإضافي</div>
              </div>
          </div>
      </div>
      
      <div style="display:flex; justify-content:space-around; margin-top:150px; font-weight:bold; font-size:22px; color:#475569;">
          <div style="width:300px; text-align:center;"><div style="border-bottom:3px solid #334155; margin-bottom:20px; height:60px;"></div>المدير المباشر / الإدارة</div>
          <div style="width:300px; text-align:center;"><div style="border-bottom:3px solid #334155; margin-bottom:20px; height:60px;"></div>توقيع الموظف</div>
      </div>
    </div>
    
    <!-- Footer Page Numbering -->
    <div style="position:absolute; bottom:40px; left:0; right:0; text-align:center; font-feature-settings:'tnum'; z-index:10;">
       <div style="display:inline-block; padding:10px 30px; background:#ffffff; box-shadow:0 0 15px rgba(0,0,0,0.05); color:#475569; font-weight:900; font-size:16px; border-radius:30px; border:1px solid #e2e8f0;">
          صفحة <span lang="en" dir="ltr" style="color:${themePri};">${chunks.length + 1}</span> من <span lang="en" dir="ltr">${chunks.length + 1}</span>
       </div>
    </div>
  </div>`;

  let cvFinal = await html2canvas(container, opts);
  processCvs.push(cvFinal.toDataURL('image/jpeg', 1.0));
  cvFinal = null;
  
  pdfCanvasesCache = processCvs;
  if(container) { container.className=`hidden`; container.innerHTML=``; } if(document.body && document.body.classList) document.body.classList.remove(`printing`);
  return pdfCanvasesCache;
}

async function buildPDF(){
  let canvasesDataUrls=await buildPDFCanvas(); if(!canvasesDataUrls || !canvasesDataUrls.length) return null;
  let doc=new jspdf.jsPDF(`p`,`mm`,`a4`);
  let ps=doc.internal && doc.internal.pageSize ? doc.internal.pageSize : {};
  let w=typeof ps.getWidth==='function' ? ps.getWidth() : (ps.width || 210);
  let h=typeof ps.getHeight==='function' ? ps.getHeight() : (ps.height || 297);
  
  for(let i=0; i<canvasesDataUrls.length; i++) {
     if(i>0) doc.addPage();
     // We know ratio is exactly 1200x1697 which matches A4 ratio w/h, so we just use `h`
     doc.addImage(canvasesDataUrls[i], `JPEG`, 0, 0, w, h);
  }
  return doc;
}

window.exeExpPreview=async function(){
  let area=document.getElementById(`expPreviewArea`);
  let wrap=document.getElementById(`expPreviewImgWrap`);
  let loading=document.getElementById(`expPreviewLoading`);
  let img=document.getElementById(`expPreviewImg`);
  let box=document.getElementById(`exportMBox`);
  if(area) area.classList.remove(`hidden`);
  if(wrap) wrap.classList.add(`hidden`);
  if(box && typeof box.scrollTo === 'function') { setTimeout(()=>box.scrollTo({top:box.scrollHeight,behavior:`smooth`}),100); } else if(box) { setTimeout(()=>box.scrollTop = box.scrollHeight, 100); }
  
  // Use requestAnimationFrame to ensure "Loading" spinner is visible before thread-lock
  (window.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(async () => {
    let canvases = pdfCanvasesCache;
    if(!canvases) canvases = await buildPDFCanvas();

    if(!canvases || !canvases.length){
      if(area) area.classList.add(`hidden`);
      if(box) box.style.maxWidth=`360px`;
      return;
    }
  
  previewZoom=1;
  if(img){ img.style.display='none'; }
  let pvContainer = document.getElementById('pvPagesContainer');
  if(!pvContainer) {
     pvContainer = document.createElement('div');
     pvContainer.id = 'pvPagesContainer';
     pvContainer.style.transformOrigin = 'top center';
     pvContainer.style.transition = 'transform .2s';
     wrap.appendChild(pvContainer);
  }
  pvContainer.innerHTML = '';
  canvases.forEach((dataUrl, idx) => {
    let pageImg = document.createElement('img');
    pageImg.src = dataUrl;
    pageImg.style.width = '100%';
    pageImg.style.display = 'block';
    pageImg.style.marginBottom = '10px';
    pvContainer.appendChild(pageImg);
  });

  if(loading) loading.classList.add(`hidden`);
  if(wrap) wrap.classList.remove(`hidden`);
    if(box && typeof box.scrollTo === 'function') { setTimeout(()=>box.scrollTo({top:box.scrollHeight,behavior:`smooth`}),150); } else if(box) { setTimeout(()=>box.scrollTop = box.scrollHeight, 150); }
  });
};

window.showExportSuccess = function(pathMsg) {
  let area=document.getElementById(`expPreviewArea`);
  let wrap=document.getElementById(`expPreviewImgWrap`);
  if(area) area.classList.add(`hidden`);
  if(wrap) wrap.classList.add(`hidden`);
  let aBtns=document.getElementById(`expActionBtns`);
  let sArea=document.getElementById(`expSuccessArea`);
  let sPath=document.getElementById(`expSuccessPath`);
  if(aBtns) aBtns.classList.add(`hidden`);
  if(sPath) sPath.innerText = pathMsg;
  if(sArea) sArea.classList.remove(`hidden`);
};

window.closeExportM = function() {
  let modal = document.getElementById(`exportM`);
  if(modal) { modal.classList.add(`hidden`); modal.classList.remove(`flex`); }
  // Clear cache so next open generates a fresh PDF
  pdfCanvasesCache = null;
};

window.exeExpDownload=function(){
  let btn = document.getElementById('btnExport');
  let originalHtml = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i> جاري التحميل...'; btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none'; }
  
  setTimeout(async () => {
    let d = new Date();
    let defaultName = `Attendance_Report_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    let uf = document.getElementById(`expFileName`);
    let name = uf && uf.value.trim() ? uf.value.trim() : defaultName;
    
    // Check cache for download too
    let canvasesUrls = pdfCanvasesCache;
    let doc = null;
    if(canvasesUrls) {
      doc = new jspdf.jsPDF(`p`,`mm`,`a4`);
      let w=doc.internal.pageSize.getWidth(), h=doc.internal.pageSize.getHeight();
      for(let i=0; i<canvasesUrls.length; i++) {
        if(i>0) doc.addPage();
        doc.addImage(canvasesUrls[i], `JPEG`, 0, 0, w, h);
      }
    } else {
      doc = await buildPDF();
    }

    if(!doc) { if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; } return; }
    let blob=doc.output(`blob`);
    let finalLocation = "";

    try {
      let nowForBackup=new Date();
      let bkName=`backup_${nowForBackup.toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`;
      let bkData=JSON.stringify({S:settings,R: await RECDB.getAll(),d:nowForBackup.toISOString()});
      
      if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem){
          await requestStoragePermission();
          await ensureDir(BACKUP_FOLDER,`DOCUMENTS`);
          let bkPath=await uniqueFilePath(`${BACKUP_FOLDER}/${bkName}`,`DOCUMENTS`);
          await window.Capacitor.Plugins.Filesystem.writeFile({path:bkPath,data:bkData,directory:`DOCUMENTS`,encoding:`utf8`,recursive:true});
      }

      if(window.showSaveFilePicker && (!window.Capacitor || !window.Capacitor.isNativePlatform)){
        let handle = await window.showSaveFilePicker({
            suggestedName: `${name}.pdf`,
            types: [{description: 'PDF Document', accept: {'application/pdf': ['.pdf']}}]
        });
        let writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        finalLocation = "جهاز الكمبيوتر / التنزيلات (حسب المكان الذي اخترته)";
      } else if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem){
        await ensureDir(APP_FOLDER,`DOCUMENTS`);
        let safeName=name.replace(/[\\/:*?"<>|]/g,`_`);
        let basePath=`${APP_FOLDER}/${safeName}.pdf`;
        let finalPath=await uniqueFilePath(basePath,`DOCUMENTS`);
        let b64=await blobToBase64(blob);
        await window.Capacitor.Plugins.Filesystem.writeFile({path:finalPath,data:b64,directory:`DOCUMENTS`,recursive:true});
        finalLocation = `مجلد التخزين الداخلي / Documents / ${finalPath}`;
      } else {
        let url=URL.createObjectURL(blob),a=document.createElement(`a`);
        a.href=url; a.download=`${name}.pdf`; a.click(); URL.revokeObjectURL(url);
        finalLocation = "مجلد التنزيلات الخاص بمتصفحك";
      }
      
      window.showExportSuccess(finalLocation);

    } catch(err){
      console.error(`Export/Backup error:`,err);
      if(err.name === 'SecurityError' || (err.message && err.message.includes('gesture'))) {
         let url=URL.createObjectURL(blob),a=document.createElement(`a`);
         a.href=url; a.download=`${name}.pdf`; a.click(); URL.revokeObjectURL(url);
         window.showExportSuccess("تم تنزيل الملف أوتوماتيكياً (تجاوزاً لتقييد المتصفح)");
      } else if(err.name !== 'AbortError') {
        toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل العملية: `+(err.message||err),`err`);
      } else {
        toast(`تم إلغاء الحفظ`,`err`);
      }
    }
    
    if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
  }, 100);
};

function getPlainTextHeader(repTitle, periodLabel) {
  if (settings.activeHeaderId === 'none') return '';
  if (settings.activeHeaderId && settings.activeHeaderId !== 'default' && settings.activeHeaderId !== '') {
    let h = (settings.reportHeaders || []).find(x => x.id === settings.activeHeaderId);
    if (h) return h.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return `${repTitle} - الموظف: ${settings.name} - الفترة: ${periodLabel}`;
}

function getPlainTextFooter() {
  if (settings.activeFooterId === 'none') return '';
  if (settings.activeFooterId && settings.activeFooterId !== 'default' && settings.activeFooterId !== '') {
    let f = (settings.reportFooters || []).find(x => x.id === settings.activeFooterId);
    if (f) return f.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return `تاريخ التقرير: ${todayKey()}`;
}

window.exeExpExcel=async function(){
  let btn = document.getElementById('btnExcelExp');
  let originalHtml = btn ? btn.innerHTML : '<i class="fa-solid fa-file-excel ml-2"></i>تصدير Excel';
  if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i> جاري التحميل...'; btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none'; }
  
  setTimeout(async () => {
    try {
      let d = new Date();
      let defaultName = `Attendance_Report_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}.csv`;
      let uf = document.getElementById(`expFileName`);
      let name = (uf && uf.value.trim() ? uf.value.trim() : defaultName) + (uf && uf.value.trim().endsWith('.csv') ? '' : (uf && uf.value.trim() ? '.csv' : ''));
      if(!name.endsWith('.csv')) name += '.csv';

      let filtered=[];
      if(periodMode===`custom`){
        let dsEl=document.getElementById(`dateStart`),deEl=document.getElementById(`dateEnd`); let ds=dsEl?dsEl.value:'',de=deEl?deEl.value:'';
        if(ds&&de){
          filtered = await RECDB.getRange(ds, de);
        }
      } else {
        filtered = await RECDB.getMonth(viewYear, viewMonth);
      }
      
      let q=document.getElementById(`recSearch`) ? document.getElementById(`recSearch`).value.toLowerCase().trim() : ``;
      if(q) {
        filtered = filtered.filter(r => searchMatch(r, q));
      }
      
      let sf=document.getElementById(`statusFilter`) ? document.getElementById(`statusFilter`).value : '';
      if(sf===`present`) filtered=filtered.filter(r=>isPresent(r.status));
      else if(sf===`absent`) filtered=filtered.filter(r=>r.status===`absent`);
      else if(sf===`late`) filtered=filtered.filter(r=>{if(!isPresent(r.status))return false;let dt=new Date(slashToISO(r.date));return lateMin(r.checkIn,getSchedule(dt.getFullYear(),dt.getMonth(),dt).start)>0;});
      else if(sf===`overtime`) filtered=filtered.filter(r=>hasOvertime(r));
      
      filtered.sort((a,b)=>slashToISO(a.date).localeCompare(slashToISO(b.date)));

      let columns = [
        { key: 'day', label: 'اليوم' },
        { key: 'date', label: 'التاريخ' },
        { key: 'checkIn', label: 'وقت الحضور' },
        { key: 'checkOut', label: 'وقت الانصراف' },
        { key: 'late', label: 'تأخير' },
        { key: 'early', label: 'خروج مبكر' },
        { key: 'overtime', label: 'إضافي' },
        { key: 'status', label: 'الحالة' },
        { key: 'absenceType', label: 'نوع الغياب' },
        { key: 'note', label: 'الملاحظات' }
      ].filter(c => settings.exportColumns[c.key]);

      let repTitle = (document.getElementById('expReportTitle') && document.getElementById('expReportTitle').value.trim()) || 'تقرير الحضور والغياب';
      let periodLabel = "";
      if(periodMode === 'custom') {
        let dsEl=document.getElementById(`dateStart`),deEl=document.getElementById(`dateEnd`); let ds=dsEl?dsEl.value:'',de=deEl?deEl.value:'';
        periodLabel = (ds && de) ? `من ${isoToSlash(ds)} إلى ${isoToSlash(de)}` : ``;
      } else {
        periodLabel = document.getElementById(`monthIn`) ? document.getElementById(`monthIn`).value : (MONTHS[viewMonth] + ` ` + viewYear);
      }

      let headerText = getPlainTextHeader(repTitle, periodLabel);
      let footerText = getPlainTextFooter();

      let csvContent = "\uFEFF";
      if (headerText) {
        csvContent += `"${headerText.replace(/"/g, '""')}"\n\n`;
      }
      csvContent += columns.map(c => c.label).join(",") + "\n";

      for (let r of filtered) {
        let dt = new Date(slashToISO(r.date));
        let sch = getSchedule(dt.getFullYear(),dt.getMonth(),dt);
        let late = isPresent(r.status)?lateMin(r.checkIn, sch.start):0;
        let early = r.checkOut?earlyMin(r.checkOut, sch.end):0;
        let isHol = isHoliday(dt) || !isWorkDay(dt);
        let extra = 0;
        if (isHol && r.checkIn && r.checkOut) {
          let [sh, sm] = (r.checkIn && r.checkIn.includes(":") ? r.checkIn : "00:00").split(":").map(Number); let [eh, em] = (r.checkOut && r.checkOut.includes(":") ? r.checkOut : "00:00").split(":").map(Number);
          extra = (eh*60+em) - (sh*60+sm);
          if (extra < 0) extra += 1440;
        } else if (r.checkOut) {
          extra = extraMin(r.checkOut, sch.overtimeStart);
        }
        let rowData = [];
        columns.forEach(c => {
          let val = "";
          if(c.key === 'day') val = DAYS[dt.getDay()];
          else if(c.key === 'date') val = r.date;
          else if(c.key === 'checkIn') val = r.checkIn || '-';
          else if(c.key === 'checkOut') val = r.checkOut || '-';
          else if(c.key === 'late') val = late > 0 ? formatMin(late) : '-';
          else if(c.key === 'early') val = early > 0 ? formatMin(early) : '-';
          else if(c.key === 'overtime') val = extra > 0 ? formatMin(extra) : '-';
          else if(c.key === 'status') {
             if(r.status === 'present') val = late > 0 ? 'حاضر (متأخر)' : 'حاضر';
             else if(r.status === 'absent') val = 'غائب';
             else val = r.status;
          }
          else if(c.key === 'absenceType') val = (r.status === 'absent' ? r.absenceType : (r.status === 'إجازة من الإضافي' ? 'إجازة تعويض إضافي' : '')) || '-';
          else if(c.key === 'note') {
            let leaveComp = (settings.compensations || []).find(x => x.date === r.date && x.type === 'leave');
            let exportNote = r.note || '';
            if (leaveComp) {
              let sourceDesc = formatCompSourceText(leaveComp, false);
              let compNote = leaveComp.note ? leaveComp.note : '';
              let compDetailStr = `خصم ${formatMin(leaveComp.minutes)} ${sourceDesc}`;
              exportNote = compNote ? `${compNote} - ${compDetailStr}` : compDetailStr;
              if (r.note && !r.note.includes('خصم') && !r.note.includes('الإضافي') && r.note !== compNote) {
                exportNote = `${r.note} | ${exportNote}`;
              }
            }
            val = exportNote;
          }
          
          let escCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;
          rowData.push(escCsv(val));
        });
        csvContent += rowData.join(",") + "\n";
      }

      if (footerText) {
        csvContent += `\n"${footerText.replace(/"/g, '""')}"\n`;
      }
      let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      
      if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
        await requestStoragePermission();
        await ensureDir(APP_FOLDER,`DOCUMENTS`);
        let bkPath = await uniqueFilePath(`${APP_FOLDER}/${name}`,`DOCUMENTS`);
        
        let reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async function() {
          let base64data = reader.result.split(',')[1];
          await window.Capacitor.Plugins.Filesystem.writeFile({
            path: bkPath,
            data: base64data,
            directory: `DOCUMENTS`,
            recursive: true
          });
          toast(`<i class="fa-solid fa-check ml-1"></i> تم الحفظ: ${name} في مجلد Documents`, `ok`);
          if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
        }
      } else {
        let link = document.createElement('a');
        let url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', name);
        link.style.visibility = 'hidden';
        if(document.body && document.body.appendChild) document.body.appendChild(link);
        if(typeof link.click === 'function') link.click();
        if(document.body && document.body.removeChild && link.parentNode) document.body.removeChild(link);
        toast(`<i class="fa-solid fa-check ml-1"></i> تم تصدير الملف بنجاح`, `ok`);
        if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
      }

    } catch(err) {
      console.error(err);
      toast("حدث خطأ أثناء التصدير", "err");
      if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    }
  }, 100);
};

window.exeExpShare=function(){
  let btn = document.getElementById('btnShare');
  let originalHtml = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i> جاري التحميل...'; btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none'; }
  
  setTimeout(async () => {
    let d = new Date();
    let defaultName = `Attendance_Report_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    let uf = document.getElementById(`expFileName`);
    let name = uf && uf.value.trim() ? uf.value.trim() : defaultName;
    let doc=await buildPDF(); 
    if(!doc) { if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; } return; }
    let blob=doc.output(`blob`);

  if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Share){
    try{
      let b64=await blobToBase64(blob);
      let tmpName=`tmp_share_${Date.now()}.pdf`;
      let written=await window.Capacitor.Plugins.Filesystem.writeFile({path:tmpName,data:b64,directory:`CACHE`});
      await window.Capacitor.Plugins.Share.share({
        title:`تقرير الحضور`,
        text:`تقرير الحضور والانصراف الموحد`,
        url:written.uri,
        dialogTitle:`مشاركة التقرير`
      });
    } catch(err){
      console.error(`Share PDF error:`,err);
      toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل المشاركة: `+(err.message||err),`err`);
    }
  } else {
    try{
      let file = (typeof File !== 'undefined') ? new File([blob],`${name}.pdf`,{type:`application/pdf`}) : blob;
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({title:`تقرير الحضور`,files:[file]});
      } else {
        let url=URL.createObjectURL(blob),a=document.createElement(`a`);
        a.href=url; a.download=`${name}.pdf`; a.click(); URL.revokeObjectURL(url);
        toast(`تم التحميل (تطبيق المشاركة غير مدعوم محلياً)`,`ok`);
      }
    } catch(err){
      console.error(`Web Share PDF error:`,err);
      if(err.name === 'NotAllowedError' || err.message.includes('gesture')) {
          let url=URL.createObjectURL(blob),a=document.createElement(`a`);
          a.href=url; a.download=`${name}.pdf`; a.click(); URL.revokeObjectURL(url);
          toast(`تم تنزيل الملف أوتوماتيكياً نظراً لقيود المتصفح الأمنية للنافذة`,`ok`);
      } else if (err.name !== 'AbortError') {
          toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل المشاركة: `+(err.message||err),`err`);
      }
    }
  }
  if(btn) { btn.innerHTML = originalHtml; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
  }, 100);
};



// ── Helper: Blob to Base64 ────────────────────────────────
function blobToBase64(blob){
  return new Promise((res,rej)=>{
    let reader=new FileReader();
    reader.onload=()=>res(reader.result.split(`,`)[1]);
    reader.onerror=rej;
    reader.readAsDataURL(blob);
  });
}

// ── Notifications setup ───────────────────────────────────
window.saveAlertSettings=async function(){
  let el=document.getElementById(`alertOffsetIn`); if(!el) return;
  let val=parseInt(el.value)||0;
  settings.alertOffset=val;
  saveSettings();
  if(val>0){
    toast(`<i class="fa-solid fa-bell ml-1"></i> جارٍ ضبط التنبيهات...`,``);
    await scheduleAllNotifications();
  } else {
    try {
      if(window.Capacitor && window.Capacitor.Plugins.LocalNotifications){
        let pending = [];
        try { pending = (await window.Capacitor.Plugins.LocalNotifications.getPending()).notifications || []; }catch(e){}
        if(pending.length) await window.Capacitor.Plugins.LocalNotifications.cancel({notifications:pending.map(n=>({id:n.id}))});
      }
    } catch(e) { console.error('Cancel notifications error:', e); }
    toast(`<i class="fa-solid fa-bell-slash ml-1"></i> تم إلغاء التنبيهات`,``);
  }
};

async function scheduleAllNotifications(silent = false){
  if(!window.Capacitor || !window.Capacitor.Plugins.LocalNotifications) return;
  const LN = window.Capacitor.Plugins.LocalNotifications;
  
  try {
    let perm = await LN.checkPermissions();
    if(perm.display === 'prompt') perm = await LN.requestPermissions();
    if(perm.display !== 'granted') {
      if(!silent) toast(`<i class="fa-solid fa-xmark ml-1"></i> يرجى السماح بالإشعارات من إعدادات الهاتف`,`err`);
      return console.warn('Notifications permission denied');
    }

    let pending = [];
    try { pending = (await LN.getPending()).notifications || []; } catch(e){}
    if(pending.length){
      try{ await LN.cancel({notifications:pending.map(n=>({id:n.id}))}); }catch(e){}
    }

    if(!settings.alertOffset || settings.alertOffset <= 0) return;

    let [baseH, baseMin] = settings.baseStart.split(':').map(Number);
    
    for(let day of settings.workDays){
      try {
        let capDay = parseInt(day) + 1;
        let totalMin = baseH * 60 + baseMin - settings.alertOffset;
        if(totalMin < 0) totalMin += 1440;
        let h = Math.floor(totalMin / 60);
        let m = totalMin % 60;

        await LN.schedule({
          notifications: [{
            title: 'تذكير بالدوام',
            body: `موعد الدوام يبدأ خلال ${settings.alertOffset} دقيقة (${fmt12(settings.baseStart)})`,
            id: capDay, 
            channelId: 'attendance_reminders',
            schedule: {
              on: { weekday: capDay, hour: h, minute: m },
              repeats: true,
              allowWhileIdle: true,
              every: 'week'
            },
            smallIcon: 'ic_launcher',
            iconColor: '#1d4ed8',
            sound: null,
            importance: 4,
            visibility: 1
          }]
        });
      } catch(e) { console.error(`Error scheduling day ${day}:`, e); }
    }

    if(!silent) toast(`<i class="fa-solid fa-check ml-1"></i> تم تفعيل التنبيهات بنجاح`,`ok`);
  } catch(err) {
    console.error('Scheduling error:', err);
    if(!silent) toast(`<i class="fa-solid fa-xmark ml-1"></i> فشل ضبط التنبيهات`,`err`);
  }
}

async function setupNotifications(){
  try{
    if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.LocalNotifications){
      let perm = await window.Capacitor.Plugins.LocalNotifications.checkPermissions();
      if(perm.display !== "granted") {
        perm = await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
      }
      if(perm.display === 'prompt') await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
      
      try {
        await window.Capacitor.Plugins.LocalNotifications.createChannel({
          id: 'attendance_reminders',
          name: 'تنبيهات الدوام',
          description: 'تنبيهات مواعيد الحضور والانصراف',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
          lights: true
        });
      } catch(chErr) { console.warn('Channel creation from JS:', chErr); }

      if(settings.alertOffset > 0) scheduleAllNotifications(true);
      
      setTimeout(() => checkXiaomiBatterySettings(), 3000);
    } else if(`Notification`in window&&Notification.permission!==`granted`&&Notification.permission!==`denied`){
      await Notification.requestPermission();
    }
  } catch(err){ console.warn(`Notification setup:`,err); }
}

async function checkXiaomiBatterySettings() {
  try {
    if(!window.NativeBridge) return;
    let manufacturer = (typeof window.NativeBridge.getDeviceManufacturer === "function" ? window.NativeBridge.getDeviceManufacturer() : "").toLowerCase(); if(!manufacturer) return;
    let isChinese = manufacturer.includes('xiaomi') || manufacturer.includes('redmi') || 
                    manufacturer.includes('huawei') || manufacturer.includes('honor') || 
                    manufacturer.includes('oppo') || manufacturer.includes('vivo') || 
                    manufacturer.includes('realme');
    if(!isChinese) return;
    let prompted = localStorage.getItem('pa_battery_prompted');
    if(prompted) return;
    let isOptimized = (typeof window.NativeBridge.isBatteryOptimized === "function" ? window.NativeBridge.isBatteryOptimized() : false);
    if(!isOptimized) return;
    
    let modal = document.createElement('div');
    modal.id = 'batteryModal';
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4';
    modal.style.cssText = 'background:rgba(0,0,0,0.6);backdrop-filter:blur(8px)';
    modal.innerHTML = `
      <div class="rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden" style="background:var(--surface,#fff)" onclick="event.stopPropagation()">
        <div style="background:linear-gradient(135deg,#dc2626,#f97316);padding:30px 20px;text-align:center;color:#fff">
          <i class="fa-solid fa-battery-half text-4xl mb-3" style="opacity:0.9"></i>
          <h3 class="font-black text-lg">إعدادات التنبيهات</h3>
          <p class="text-xs mt-2 opacity-90">لضمان وصول التنبيهات على جهازك</p>
        </div>
        <div style="padding:20px">
          <p class="text-xs font-bold mb-4" style="color:var(--text,#333);line-height:1.8">
            جهازك يقوم بإيقاف التنبيهات في الخلفية لتوفير البطارية. يرجى تفعيل التشغيل التلقائي وإلغاء تحسين البطارية لهذا التطبيق.
          </p>
          <div class="space-y-2">
            <button onclick="window.NativeBridge.openAutoStartSettings();this.innerText='✔ تم الفتح';this.disabled=true;this.style.opacity=0.5" 
              class="w-full py-3 rounded-xl text-sm font-bold text-white" style="background:linear-gradient(135deg,#1d4ed8,#3b82f6)">
              <i class="fa-solid fa-rocket ml-1"></i> تفعيل التشغيل التلقائي
            </button>
            <button onclick="window.NativeBridge.openBatterySettings();this.innerText='✔ تم الفتح';this.disabled=true;this.style.opacity=0.5" 
              class="w-full py-3 rounded-xl text-sm font-bold text-white" style="background:linear-gradient(135deg,#059669,#10b981)">
              <i class="fa-solid fa-battery-full ml-1"></i> إلغاء تحسين البطارية
            </button>
            <button onclick="localStorage.setItem('pa_battery_prompted','1');document.getElementById('batteryModal').remove()" 
              class="w-full py-2.5 rounded-xl text-xs font-bold" style="color:var(--text2,#999);background:var(--bg,#f1f5f9)">
              تخطي الآن
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch(e) { console.warn('Battery settings check:', e); }
}


// ── About modal ───────────────────────────────────────────
window.openAboutM=function(){let el=document.getElementById(`aboutM`);if(el){el.classList.remove(`hidden`);el.style.display=`flex`;}};
window.closeAboutM=function(){let el=document.getElementById(`aboutM`);if(el){el.classList.add(`hidden`);el.style.display=`none`;}};
window.openLogoViewer=function(){
  let el=document.getElementById(`logoViewerM`);
  if(el){
    el.classList.remove(`hidden`);
    el.classList.add(`flex`);
    setTimeout(() => { el.style.opacity = '1'; }, 10);
  }
};
window.closeLogoViewer=function(){
  let el=document.getElementById(`logoViewerM`);
  if(el){
    el.style.opacity = '0';
    setTimeout(() => {
      el.classList.add(`hidden`);
      el.classList.remove(`flex`);
    }, 700);
  }
};

// ── Welcome screen ────────────────────────────────────────
window.finishSetup=function(){
  let nameEl=document.getElementById(`wName`); if(!nameEl) return;
  let name=nameEl.value.trim(); if(!name) return;
  settings.name=name; saveSettings();
  let wm=document.getElementById(`welcM`); if(wm){wm.style.display=`none`;wm.classList.add(`hidden`);}
  renderHome(); setTimeout(setupNotifications,500);
};


// ── Expose global functions ───────────────────────────────
if (typeof toggleTheme !== 'undefined') window.toggleTheme=toggleTheme;
if (typeof go !== 'undefined') window.go=go;
if (typeof openCal !== 'undefined') window.openCal=openCal;
if (typeof closeCal !== 'undefined') window.closeCal=closeCal;
if (typeof renderRecords !== 'undefined') window.renderRecords=renderRecords;
if (typeof goToRecords !== 'undefined') window.goToRecords=goToRecords;
if (typeof renderMonthSummary !== 'undefined') window.renderMonthSum=renderMonthSummary;
if (typeof calP !== 'undefined') window.calP=calP;
if (typeof calN !== 'undefined') window.calN=calN;
if (typeof renderCal !== 'undefined') window.renderCal=renderCal;
if (typeof pickMonth !== 'undefined') window.pickMonth=pickMonth;
if (typeof togglePeriodFilter !== 'undefined') window.togglePeriodFilter=togglePeriodFilter;
if (typeof openEdit !== 'undefined') window.openEdit=openEdit;
if (typeof closeEdit !== 'undefined') window.closeEdit=closeEdit;
if (typeof openAddRecord !== 'undefined') window.openAddRecord=openAddRecord;
if (typeof onEditDateChange !== 'undefined') window.onEditDateChange=onEditDateChange;
if (typeof renderStats !== 'undefined') window.renderStats=renderStats;

// ── Trial & Hardware-Bound Licensing ──────────────────────
window.isAppTrial = false;
const HARDWARE_SALT_SECRET = "GLM2026_HARDWARE_SALT_xyz";

window.copyTrialDeviceId = function() {
  let f = document.getElementById('trialDeviceIdDisplay');
  if (f) {
    if (f.select) f.select();
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(f.value);
    toast("تم نسخ المعرف!", "ok");
  }
};

window.openPurchaseModal = async function() {
  let devId = "UNKNOWN";
  try {
    if(window.Capacitor && window.Capacitor.Plugins.Device) {
       let info = await window.Capacitor.Plugins.Device.getId();
       devId = info.identifier;
    } else {
       devId = localStorage.getItem('pa_fallback_uuid') || 'BROWSER-' + Date.now();
    }
  } catch(e) { console.error(e); }
  
  const cleanId = devId.replace(/\s+/g,'').toUpperCase();
  const d1 = document.getElementById('purchaseDeviceId');
  const d2 = document.getElementById('trialDeviceIdDisplay');
  if(d1) d1.value = cleanId;
  if(d2) d2.value = cleanId;
  
  const modal = document.getElementById('purchaseM');
  if(modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

window.copyPurchaseId = function() {
  const el = document.getElementById('purchaseDeviceId');
  if(el) {
    if (el.select) el.select();
    if (el.setSelectionRange) el.setSelectionRange(0, 99999);
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(el.value);
    toast("تم نسخ رمز الجهاز بنجاح","ok");
  }
};

window.sendLicenseRequest = function() {
  const devId = document.getElementById('purchaseDeviceId')?.value || '';
  const msg = encodeURIComponent(`السلام عليكم، أرغب في تفعيل النسخة الكاملة لتطبيق سجل الحضور. رمز جهازي هو: ${devId}`);
  toast("يرجى إرسال الرمز المنسوخ للمطور لتفعيل النسخة","ok");
  if (typeof window.open === 'function') window.open(`https://wa.me/?text=${msg}`, '_blank');
};

var _trialTimer = null;

window.verifyActivation = async function() {
  let inputEl = document.getElementById('trialActivationInput');
  let devIdEl = document.getElementById('trialDeviceIdDisplay');
  if(!inputEl || !devIdEl) return;
  let input = inputEl.value.trim().toUpperCase();
  let devId = devIdEl.value.replace(/\s+/g,'').toUpperCase();
  if(!input || !devId) return toast("يرجى إدخال مفتاح التفعيل", "err");
  
  try {
    let encodeStr = (str) => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Uint8Array.from([...str].map(c=>c.charCodeAt(0)));
    let encBytes = encodeStr(HARDWARE_SALT_SECRET);
    let devBytes = encodeStr(devId);
    let key = await crypto.subtle.importKey('raw', encBytes, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    let signature = await crypto.subtle.sign('HMAC', key, devBytes);
    let hashArray = Array.from(new Uint8Array(signature));
    let hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    let expectedKey = hashHex.substring(0,8) + '-' + hashHex.substring(8,16) + '-' + hashHex.substring(16,24) + '-' + hashHex.substring(24,32);
    
    if(input === expectedKey) {
      if(_trialTimer) { clearInterval(_trialTimer); _trialTimer = null; }
      await IDB.set('pa_activation_status', { activated: true });
      window.isAppTrial = false;
      document.getElementById('trialExpiredM').classList.add('hidden');
      document.getElementById('trialExpiredM').style.display = 'none';
      if(document.getElementById('trialBanner')) document.getElementById('trialBanner').classList.add('hidden');
      toast("تم تفعيل التطبيق بنجاح! شكراً لك.", "ok");
    } else {
      toast("مفتاح التفعيل غير صحيح!", "err");
    }
  } catch(e) { console.error("Activation Check Error:", e); toast("خطأ في التحقق التشفيري", "err"); }
};

async function initTrialSystem() {
  try {
    let activation = await IDB.get('pa_activation_status');
    if(activation && activation.activated) return true; // Unlocked forever
    
    let installData = await IDB.get('pa_install_meta');
    if(!installData || !installData.timestamp) {
       installData = { timestamp: Date.now() };
       await IDB.set('pa_install_meta', installData);
    }
    
    window.isAppTrial = true;
    
    let remainingMs = (installData.timestamp + 7 * 24 * 60 * 60 * 1000) - Date.now();
    
    if(remainingMs <= 0) {
      if(_trialTimer) { clearInterval(_trialTimer); _trialTimer = null; }
      // Trial expired! Fetch Device ID
      let devId = "UNKNOWN";
        if(window.Capacitor && window.Capacitor.Plugins.Device) {
         let info = await window.Capacitor.Plugins.Device.getId();
         devId = info.identifier; // The UUID provided by Android/iOS
      } else {
         let cache = localStorage.getItem('pa_fallback_uuid');
         if(!cache) { cache = uuid(); localStorage.setItem('pa_fallback_uuid', cache); }
         devId = cache;
      }
      
      let dEl = document.getElementById('trialDeviceIdDisplay');
      if(dEl) dEl.value = devId.replace(/\s+/g,'').toUpperCase();
      
      let m = document.getElementById('trialExpiredM');
      if(m) { m.classList.remove('hidden'); m.style.display='flex'; }
      if(document.getElementById('trialBanner')) document.getElementById('trialBanner').classList.add('hidden');
      return false; // App locked
    } else {
      // Still within trial - setup banner
      let banner = document.getElementById('trialBanner');
      if(banner) {
        banner.classList.remove('hidden');
        let cd = document.getElementById('trialCountdown');
        
        // Hide banner after 10 seconds as requested
        setTimeout(() => {
          if(banner) banner.classList.add('hidden');
        }, 10000);
        
        // Dynamic timer loop
        if(_trialTimer) clearInterval(_trialTimer);
        _trialTimer = setInterval(() => {
          let currRemaining = (installData.timestamp + 7 * 24 * 60 * 60 * 1000) - Date.now();
          if(currRemaining <= 0) {
            clearInterval(_trialTimer);
            _trialTimer = null;
            initTrialSystem(); // Trigger lock immediately
          } else if(cd) {
            let d = Math.floor(currRemaining / (1000 * 60 * 60 * 24));
            let h = Math.floor((currRemaining / (1000 * 60 * 60)) % 24).toString().padStart(2,'0');
            let mins = Math.floor((currRemaining / 60000) % 60).toString().padStart(2,'0');
            let s = Math.floor((currRemaining / 1000) % 60).toString().padStart(2,'0');
            cd.innerText = (d > 0 ? d + " يوم و " : "") + h + ":" + mins + ":" + s;
          }
        }, 1000);
      }
      return true;
    }
  } catch(err) {
    console.error("Trial System Init Error:", err);
    return true; // Fallback to allow app if DB fails to read to prevent catastrophic false locks.
  }
}

// ── App Init ──────────────────────────────────────────────
async function initApp(){
  try{
    // Step 1: Load Data & Check Trial Status
    try { 
      await loadData(); 
      await initTrialSystem(); // Blocks app UI if trial expired
      
      // Biometric Lock Check (v1.0.1 Priority)
      if(settings.enableBiometric && window.Capacitor && window.Capacitor.isNativePlatform) {
        let lock = document.getElementById('biometricLock');
        if(lock) {
          lock.classList.remove('hidden');
          lock.classList.add('flex');
          // Automatically trigger prompt
          setTimeout(() => { if(window.authBiometric) authBiometric(); }, 500);
        }
      }
      

    } catch(e) { throw new Error("LoadData or Trial Init Failed: " + e.message); }
    
    // Step 2: Apply Theme & Fonts
    try { 
      applyTheme(); 
      await loadAllFonts();
    } catch(e) { console.warn("ApplyTheme/Fonts Failed:", e); }
    
    // Step 3: Header Clock (pause in background)
    try {
      tickClock();
      clockInterval=setInterval(tickClock, 1000);
      document.addEventListener('visibilitychange',()=>{
        if(document.hidden){
          if(clockInterval){clearInterval(clockInterval);clockInterval=null;}
          if(timerHandle){clearInterval(timerHandle);timerHandle=null;}
        } else {
          if(!clockInterval){tickClock();clockInterval=setInterval(tickClock,1000);}
          if(!timerHandle && _activeTimerCheckIn){startTimer(_activeTimerCheckIn);}
        }
      });
    } catch(e) { console.warn("Clock Failed:", e); }
    
    // Step 4: Fill Absences (Logical step, usually safe)
    try { await fillAbsences(); } catch(e) { console.warn("FillAbsences Failed:", e); }
    
    // Step 5: Screen Rendering
    try {
      if(!settings.name){
        let wm=document.getElementById(`welcM`);
        if(wm){ wm.classList.remove(`hidden`); wm.style.display=`flex`; }
      }
      renderHome();
    } catch(e) { throw new Error("RenderHome Failed: " + e.message); }

    // Step 6: Native & Heavy tasks (Delayed)
    setTimeout(async () => {
       try { await doAutoBackup(); } catch(e) { console.warn("AutoBackup Delayed Failed:", e); }
       try { if(settings.name) await setupNotifications(); } catch(e) { console.warn("Notifications Delayed Failed:", e); }
    }, 3000);

  } catch(err){
    console.error(`App init critical error:`, err);
    alert(`خطأ حرج في تشغيل التطبيق:\n` + err.message);
  }
}

document.addEventListener(`DOMContentLoaded`,initApp);



// ── Advanced Preview Touch Handler (Pinch & Pan) ───────────
(function() {
  let scale = 1, x = 0, y = 0;
  let startX = 0, startY = 0;
  let isDragging = false, pinchDist = 0, startScale = 1;

  function updateTransform(el) {
    if (!el) return;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    el.style.cursor = scale > 1 ? 'grabbing' : 'grab';
  }

  window.zoomPreview = function(dir) {
    let img = document.getElementById('expPreviewImg');
    if (!img) return;
    if (dir === 0) { scale = 1; x = 0; y = 0; }
    else if (dir > 0) scale = Math.min(6, scale + 0.5);
    else scale = Math.max(1, scale - 0.5);
    
    if (scale <= 1) { x = 0; y = 0; }
    updateTransform(img);
  };

  function initPreviewTouch() {
    const wrap = document.getElementById('expPreviewImgWrap');
    const img = document.getElementById('expPreviewImg');
    if (!wrap || !img) return;

    // Reset state when modal opens
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class' && !wrap.classList.contains('hidden')) {
          scale = 1; x = 0; y = 0;
          updateTransform(img);
        }
      });
    });
    observer.observe(wrap, { attributes: true });

    wrap.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDragging = true;
        startX = e.touches[0].pageX - x;
        startY = e.touches[0].pageY - y;
      } else if (e.touches.length === 2) {
        isDragging = false;
        pinchDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
        startScale = scale;
      }
    }, { passive: false });

    wrap.addEventListener('touchmove', e => {
      if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        x = e.touches[0].pageX - startX;
        y = e.touches[0].pageY - startY;
        updateTransform(img);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        let dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
        let ratio = dist / pinchDist;
        scale = Math.max(1, Math.min(8, startScale * ratio));
        if (scale <= 1) { x = 0; y = 0; }
        updateTransform(img);
      }
    }, { passive: false });

    wrap.addEventListener('touchend', () => {
      isDragging = false;
    });

    let lastTap = 0;
    wrap.addEventListener('touchstart', e => {
        if (e.touches.length > 1) return;
        let now = Date.now();
        if (now - lastTap < 300) {
            e.preventDefault();
            if (scale > 1) { scale = 1; x = 0; y = 0; }
            else { scale = 3; x = 0; y = 0; }
            updateTransform(img);
        }
        lastTap = now;
    }, { passive: false });
  }

  if (document.readyState === 'complete') initPreviewTouch();
  else window.addEventListener('load', initPreviewTouch);
})();


window.uploadHeaderFooterImg = function(input, targetId) {
  if (input && input.files && input.files[0]) {
    let reader = new FileReader();
    reader.onload = function(e) {
      let b64 = e.target.result;
      let imgHtml = `<img src="${b64}" style="width:100%; height:auto; object-fit:contain; max-height:150px;">`;
      let el = document.getElementById(targetId);
      if(el) {
        if(el.value) el.value += '\n' + imgHtml;
        else el.value = imgHtml;
      }
      input.value = '';
    };
    reader.readAsDataURL(input.files[0]);
  }
};
// ── Global Mirroring Block ───────────────────────────────
try {
  if (typeof window !== "undefined") {
    Object.keys(window).forEach(key => {
      if (typeof window[key] === "function" && typeof globalThis[key] === "undefined") {
        try { globalThis[key] = window[key]; } catch(e) {}
      }
    });
  }
} catch(e) {}
