#!/usr/bin/env node
// Write the five CRM CSVs from a Stage 1 file before Stage 2 has run (report_status stays "pending", no links).
// Uses the same export code as the Leads tab (leads.js). Usage: node tools/leads/export-pending.mjs <stage1.csv> <out dir> [min years]
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [src, outDir, min = '8'] = process.argv.slice(2);
const ctx = { LeadsCore: require('../../leadscore.js'), URLSearchParams, console };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('../../leads.js', import.meta.url), 'utf8') + '\nthis.LeadsTab = LeadsTab;', ctx);
const rows = ctx.LeadsCore.parseCSV(fs.readFileSync(src, 'utf8'));
const files = await ctx.LeadsTab.exportLeadCSVs(rows, ctx.LeadsTab.memoryStore(), +min === 7 ? 7 : 8);
fs.mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) { fs.writeFileSync(path.join(outDir, name), '﻿' + text); console.log(name, ctx.LeadsCore.parseCSV(text).length, 'rows'); }
