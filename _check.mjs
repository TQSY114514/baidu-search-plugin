import { readFileSync } from 'node:fs';
const s = readFileSync('badge.svg', 'utf8');
const m = s.match(/aria-label="([^"]*)"/);
console.log('badge label:', m ? m[1] : '(none)');
