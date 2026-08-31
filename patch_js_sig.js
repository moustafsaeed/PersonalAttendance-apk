const fs = require('fs');
let code = fs.readFileSync('./www/assets/clean_app_source.js', 'utf8');

let addition = `
let uploadedSigImg = null;
window.handleSigImageUpload = function(e) {
  let file = e.target.files[0];
  if(!file) return;
  let reader = new FileReader();
  reader.onload = function(evt) {
    let img = new Image();
    img.onload = function() {
      uploadedSigImg = img;
      document.getElementById('sigImageControls').classList.remove('hidden');
      document.getElementById('sigImageControls').classList.add('flex');
      // Reset sliders
      document.getElementById('sigScale').value = 100;
      document.getElementById('sigOffsetX').value = 0;
      document.getElementById('sigOffsetY').value = 0;
      redrawSigImage();
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
};

window.redrawSigImage = function() {
  if(!sigCanvas || !sigCtx || !uploadedSigImg) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  
  let scale = parseInt(document.getElementById('sigScale').value) / 100;
  let offsetX = parseInt(document.getElementById('sigOffsetX').value);
  let offsetY = parseInt(document.getElementById('sigOffsetY').value);
  
  let w = uploadedSigImg.width * scale;
  let h = uploadedSigImg.height * scale;
  
  // Center by default, plus offsets
  let cx = (sigCanvas.width - w) / 2 + offsetX;
  let cy = (sigCanvas.height - h) / 2 + offsetY;
  
  sigCtx.drawImage(uploadedSigImg, cx, cy, w, h);
};
`;

let targetFunc = `window.clearSigCanvas = function() {`;
let clearAddition = `
  uploadedSigImg = null;
  let ctrls = document.getElementById('sigImageControls');
  if(ctrls) { ctrls.classList.add('hidden'); ctrls.classList.remove('flex'); }
  let uf = document.getElementById('sigImageUpload');
  if(uf) uf.value = '';
`;

code = code.replace(targetFunc, addition + '\n' + targetFunc + clearAddition);

let openSigPadRegex = /window\.openSigPad = function\(colId\) \{([\s\S]*?)let m = document\.getElementById\('sigPadM'\);/;
code = code.replace(openSigPadRegex, `window.openSigPad = function(colId) {
  document.getElementById('sigTargetCol').value = colId;
  window.clearSigCanvas(); // reset state when opening
  let m = document.getElementById('sigPadM');`);

fs.writeFileSync('./www/assets/clean_app_source.js', code);
console.log("JS patched");
