const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, 'www');
const OUTPUT_FILE = path.join(__dirname, 'Personal_Attendance_Standalone.html');

console.log('--- Starting Standalone Build ---');

let html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

// 1. Inline Scripts
const scriptRegex = /<script[^>]+src="([^"]+)"[^>]*><\/script>/g;
html = html.replace(scriptRegex, (match, src) => {
    const filePath = path.join(ROOT_DIR, src);
    if (fs.existsSync(filePath)) {
        console.log(`Inlining Script: ${src}`);
        const content = fs.readFileSync(filePath, 'utf8');
        return `<script>\n${content}\n</script>`;
    }
    return match;
});

// 2. Inline CSS and handle assets within CSS
const linkRegex = /<link[^>]+href="([^"]+)"[^>]*>/g;
html = html.replace(linkRegex, (match, href) => {
    if (!match.includes('rel="stylesheet"')) return match;
    if (href.startsWith('http')) return match; // Keep remote fonts remote to save size or if needed

    const filePath = path.join(ROOT_DIR, href);
    if (fs.existsSync(filePath)) {
        console.log(`Inlining CSS: ${href}`);
        let css = fs.readFileSync(filePath, 'utf8');
        
        // Inline URLs in CSS (Fonts/Images)
        const urlRegex = /url\(([^)]+)\)/g;
        css = css.replace(urlRegex, (m, url) => {
            const cleanUrl = url.replace(/['"]/g, '').trim();
            if (cleanUrl.startsWith('http')) return m;
            
            const assetPath = path.resolve(path.dirname(filePath), cleanUrl);
            if (fs.existsSync(assetPath)) {
                console.log(`  Converting CSS asset to Base64: ${cleanUrl}`);
                const ext = path.extname(assetPath).slice(1);
                const base64 = fs.readFileSync(assetPath).toString('base64');
                const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'ttf' ? 'font/ttf' : `image/${ext}`;
                return `url("data:${mime};base64,${base64}")`;
            }
            return m;
        });

        return `<style>\n${css}\n</style>`;
    }
    return match;
});

// 3. Inline Images in HTML
const imgRegex = /<img\s+([^>]*?)src="([^"]+)"([^>]*?)>/g;
html = html.replace(imgRegex, (match, prefix, src, suffix) => {
    if (src.startsWith('data:') || src.startsWith('http')) return match;
    const filePath = path.join(ROOT_DIR, src);
    if (fs.existsSync(filePath)) {
        console.log(`Converting HTML Image to Base64: ${src}`);
        const ext = path.extname(filePath).slice(1);
        const base64 = fs.readFileSync(filePath).toString('base64');
        return `<img ${prefix} src="data:image/${ext};base64,${base64}" ${suffix}>`;
    }
    return match;
});

// 4. Handle inline styles in HTML that might use local assets (like about-bg.png)
const inlineStyleAssetRegex = /style="([^"]*?)url\('([^']+)'\)([^"]*?)"/g;
html = html.replace(inlineStyleAssetRegex, (match, prefix, url, suffix) => {
    if (url.startsWith('data:') || url.startsWith('http')) return match;
    const filePath = path.join(ROOT_DIR, url);
    if (fs.existsSync(filePath)) {
        console.log(`Converting Inline Style Asset to Base64: ${url}`);
        const ext = path.extname(filePath).slice(1);
        const base64 = fs.readFileSync(filePath).toString('base64');
        return `style="${prefix}url('data:image/${ext};base64,${base64}')${suffix}"`;
    }
    return match;
});

fs.writeFileSync(OUTPUT_FILE, html);
console.log(`--- Success! File saved to: ${OUTPUT_FILE} ---`);
