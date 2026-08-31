const fs = require('fs');
let html = fs.readFileSync('./www/index.html', 'utf8');

let newModalContent = `
      <div class="text-[11px] text-slate-500 mb-2 flex justify-between items-center">
        <span>يرجى رسم التوقيع أو إرفاق صورة:</span>
        <button onclick="document.getElementById('sigImageUpload').click()" class="btn btn-outline py-1 px-2 text-[10px]"><i class="fa-solid fa-image ml-1"></i> إرفاق صورة</button>
        <input type="file" id="sigImageUpload" class="hidden" accept="image/*" onchange="handleSigImageUpload(event)" />
      </div>
      <div class="bg-white rounded-xl border-2 overflow-hidden mb-2 flex justify-center relative" style="border-color: var(--c-border); touch-action: none;">
        <canvas id="sigCanvas" width="300" height="150" class="cursor-crosshair w-full" style="max-width: 300px; height: 150px;"></canvas>
      </div>
      
      <div id="sigImageControls" class="hidden flex-col gap-2 mb-3 bg-slate-50 dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
         <div class="flex items-center text-[10px]">
           <label class="w-12">التكبير:</label>
           <input type="range" id="sigScale" min="10" max="300" value="100" class="flex-1 h-1" oninput="redrawSigImage()" />
         </div>
         <div class="flex items-center text-[10px]">
           <label class="w-12">أفقي:</label>
           <input type="range" id="sigOffsetX" min="-150" max="150" value="0" class="flex-1 h-1" oninput="redrawSigImage()" />
         </div>
         <div class="flex items-center text-[10px]">
           <label class="w-12">عمودي:</label>
           <input type="range" id="sigOffsetY" min="-75" max="75" value="0" class="flex-1 h-1" oninput="redrawSigImage()" />
         </div>
      </div>
`;

html = html.replace(
  /<div class="text-\[11px\] text-slate-500 mb-2">يرجى رسم التوقيع داخل المربع أدناه \(يمكنك استخدام الماوس أو اللمس\):<\/div>\s*<div class="bg-white rounded-xl border-2 overflow-hidden mb-3 flex justify-center" style="border-color: var\(--c-border\); touch-action: none;">\s*<canvas id="sigCanvas" width="300" height="150" class="cursor-crosshair w-full" style="max-width: 300px; height: 150px;"><\/canvas>\s*<\/div>/g, 
  newModalContent
);

fs.writeFileSync('./www/index.html', html);
console.log("HTML patched");
