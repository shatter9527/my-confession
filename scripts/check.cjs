'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name.startsWith('.') || ['node_modules', 'data', 'test-results', 'playwright-report'].includes(entry.name)) return [];
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? files(file) : [file];
    });
}
const pages = files(path.join(root, 'pages')).filter(file => file.endsWith('.html')).concat(path.join(root, 'index.html'), path.join(root, '1.5.html'));
const anchors = new Map();
let links = 0, scripts = 0;
for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    // Ignore IDs in inline JavaScript templates; the browser checks runtime markup.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const markupIds = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(markupIds).size, markupIds.length, `${file}: duplicate HTML id`);
    anchors.set(file, new Set(ids));
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc=/.test(script[1]) && script[2].trim()) { new vm.Script(script[2], { filename: file }); scripts++; }
    }
}
for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        const value = match[1];
        if (/^(?:[a-z]+:|\/\/)/i.test(value)) continue;
        const url = new URL(value, 'http://local/' + path.relative(root, file).split(path.sep).join('/'));
        const target = path.join(root, decodeURIComponent(url.pathname));
        assert(fs.existsSync(target), `${file}: missing ${value}`);
        if (url.hash && anchors.has(target)) assert(anchors.get(target).has(decodeURIComponent(url.hash.slice(1))), `${file}: missing anchor ${value}`);
        links++;
    }
}
for (const file of ['server.js', 'admin.js', 'backup.js', ...fs.readdirSync(path.join(root, 'lib')).map(name => 'lib/' + name), ...fs.readdirSync(path.join(root, 'js')).map(name => 'js/' + name)]) {
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }); scripts++;
}
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/search-data.js'), 'utf8'), context);
for (const item of context.window.SEARCH_INDEX) {
    assert(anchors.get(path.join(root, item.p))?.has(item.a), `Search points to a missing entry: ${item.p}#${item.a}`);
}
console.log(`Checked ${pages.length} HTML pages, ${links} local links, ${scripts} scripts and ${context.window.SEARCH_INDEX.length} search targets.`);
