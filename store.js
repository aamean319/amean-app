// lib/store.js
// ── تخزين بسيط لبيانات كل بائع لوحده (ملف JSON) ──
// ⚠️ ملحوظة أمان مهمة: ده مناسب لمرحلة الاختبار (أقل من 25 بائع) بس.
// قبل الإطلاق العام، لازم ننتقل لقاعدة بيانات حقيقية مع تشفير للتوكنات (مش ملف JSON عادي).
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'sellers.json');

function readAll() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('⚠️ ملف sellers.json تالف، بنرجع بيانات فاضية:', e.message);
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getSeller(sellingPartnerId) {
  const all = readAll();
  return all[sellingPartnerId] || null;
}

function saveSeller(sellingPartnerId, info) {
  const all = readAll();
  all[sellingPartnerId] = {
    ...(all[sellingPartnerId] || {}),
    ...info,
    sellingPartnerId,
    updatedAt: new Date().toISOString()
  };
  writeAll(all);
  return all[sellingPartnerId];
}

function listSellers() {
  const all = readAll();
  return Object.values(all);
}

// ── تخزين نتائج التقارير والتحليل لكل بائع لوحده ──
function saveSellerReport(sellingPartnerId, reportType, data) {
  const all = readAll();
  if (!all[sellingPartnerId]) all[sellingPartnerId] = { sellingPartnerId };
  if (!all[sellingPartnerId].reports) all[sellingPartnerId].reports = {};
  all[sellingPartnerId].reports[reportType] = { data, fetchedAt: new Date().toISOString() };
  writeAll(all);
}

function getSellerReport(sellingPartnerId, reportType) {
  const all = readAll();
  const rec = all[sellingPartnerId];
  if (!rec || !rec.reports || !rec.reports[reportType]) return null;
  return rec.reports[reportType];
}

module.exports = { getSeller, saveSeller, listSellers, saveSellerReport, getSellerReport };
