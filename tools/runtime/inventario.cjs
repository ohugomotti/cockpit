'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const validPanel = p => p && (p.paneId || p.sessaoId || p.contexto || p.rascunho);
function inventory(config) {
  if (!config || !Array.isArray(config.abas)) throw Error('Configuração sem abas válidas.');
  const tabs = config.abas.map(tab => ({ id: tab.id, panels: (tab.paineis || []).filter(validPanel).map(p => ({ engine: p.engine || '', session: p.sessaoId || '', draft: hash(p.rascunho || '') })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const preferenceHashes = Object.fromEntries(Object.entries(config).filter(([key]) => !['abas', 'temposTrabalho', 'conectoresQuando', 'conectoresVistos'].includes(key)).map(([key, value]) => [key, hash(value)]));
  const tabPreferenceHashes = Object.fromEntries(config.abas.map(tab => [tab.id, Object.fromEntries(Object.entries(tab).filter(([key]) => key !== 'paineis').map(([key, value]) => [key, hash(value)]))]));
  return { tabs, activeTab: config.abaAtiva, theme: config.tema || 'escuro', savedPanels: tabs.reduce((n, tab) => n + tab.panels.length, 0), preferenceHashes, tabPreferenceHashes };
}
function compare(before, after) {
  return { inventoryPreserved: JSON.stringify(before.tabs) === JSON.stringify(after.tabs), activeTabPreserved: before.activeTab === after.activeTab, themePreserved: before.theme === after.theme, preferencesPreserved: Object.entries(before.preferenceHashes).every(([key, value]) => after.preferenceHashes[key] === value), tabSettingsPreserved: Object.entries(before.tabPreferenceHashes).every(([id, fields]) => Object.entries(fields).every(([key, value]) => after.tabPreferenceHashes?.[id]?.[key] === value)) };
}
if (require.main === module) {
  const options = Object.fromEntries(process.argv.slice(2).map(argument => { const i = argument.indexOf('='); return [argument.slice(2, i), argument.slice(i + 1)]; }));
  const config = JSON.parse(fs.readFileSync(options.config, 'utf8').replace(/^\uFEFF/, ''));
  const snapshot = inventory(config);
  const report = options.before ? { ...snapshot, checks: compare(JSON.parse(fs.readFileSync(options.before, 'utf8').replace(/^\uFEFF/, '')), snapshot) } : snapshot;
  fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  if (report.checks && !Object.values(report.checks).every(Boolean)) process.exitCode = 1;
  console.log(JSON.stringify({ status: process.exitCode ? 'failed' : 'passed', tabs: snapshot.tabs.length, savedPanels: snapshot.savedPanels, contentsIncluded: false }));
}
module.exports = { inventory, compare, canonical };
