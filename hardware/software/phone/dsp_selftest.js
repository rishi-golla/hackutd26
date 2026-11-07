#!/usr/bin/env node
// Runs the phone page's DSP self-test (compression-rate detection) under Node,
// without a browser. It loads the <script id="dsp"> block from index.html, so
// the page and this test always use the same code.
//
//   node dsp_selftest.js        (from software/phone; exit code 1 on failure)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/^<script id="dsp">$([\s\S]*?)^<\/script>$/m);
if (!m) {
  console.error('FAIL  could not find <script id="dsp"> in index.html');
  process.exit(1);
}
const sandbox = { module: { exports: {} }, Math, console };
vm.runInNewContext(m[1], sandbox, { filename: 'index.html#dsp' });
const dsp = sandbox.module.exports;

const results = dsp.selfTest();
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
