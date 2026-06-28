// lib/analyze.js
// ── منطق التحليل المتأكد منه بالكامل — منقول من السكريبتات اللي اتفقنا عليها، كدوال نقية ──

function stripQuotes(s) { return typeof s === 'string' ? s.replace(/^"+|"+$/g, '') : s; }
function normalize(row) {
  const out = {};
  for (const k in row) out[stripQuotes(k).toLowerCase().replace(/[\s_-]+/g, '')] = stripQuotes(row[k]);
  return out;
}
function getToday() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(m[3] + '-' + m[1] + '-' + m[2]);
  let d = new Date(String(s).replace(' UTC', ''));
  if (!isNaN(d)) return d;
  d = new Date(s);
  if (!isNaN(d)) return d;
  return null;
}
function days(d) {
  if (!d) return null;
  const diff = Math.floor((getToday() - d) / 86400000);
  return diff < 0 ? 0 : diff;
}

const REASONS_AR = {
  DAMAGED_WAREHOUSE: 'تالف في المستودع', LOST_WAREHOUSE: 'ضايع في المستودع',
  DAMAGED: 'تالف', LOST: 'ضايع'
};
const DISP_AR = {
  SELLABLE: 'قابل للبيع', WAREHOUSE_DAMAGED: 'تالف في المستودع', CUSTOMER_DAMAGED: 'تالف بسبب العميل',
  DEFECTIVE: 'معيب', CARRIER_DAMAGED: 'تالف من الشحن', DISTRIBUTOR_DAMAGED: 'تالف من الموزع', EXPIRED: 'منتهي الصلاحية'
};

// ════════════════════════════════════════════════════════════
// التوالف/الضايع
// ════════════════════════════════════════════════════════════
function analyzeLost(rawRows) {
  const results = [];
  rawRows.forEach(raw => {
    const r = normalize(raw);
    const qty = parseInt(r['quantity'] || '0') || 0;
    if (qty >= 0) return;
    const unrec = Math.abs(parseInt(r['unreconciledquantity'] || '0') || 0);
    if (unrec <= 0) return;

    const refId = (r['referenceid'] || '').trim();
    const reason = (r['reason'] || '').trim().toUpperCase();
    const reasonAr = REASONS_AR[reason] || reason;
    const dt = parseDate(r['date'] || r['dateandtime'] || '');
    const d = days(dt);

    let st, sl;
    if (d === null) { st = 'unk'; sl = 'بدون تاريخ'; }
    else if (d > 60) { st = 'review60'; sl = 'تجاوزت 60 يوم — راجع يدوياً'; }
    else { st = 'rdy'; sl = 'جاهزة — ارفع الآن'; }

    const disp = (r['disposition'] || '').trim().toUpperCase();

    results.push({
      date: r['date'] || '', asin: r['asin'] || '', fnsku: r['fnsku'] || '', sku: r['msku'] || '',
      name: (r['title'] || '').substring(0, 60), qty: unrec, fc: r['fulfillmentcenter'] || '',
      disp: DISP_AR[disp] || disp, reason, reasonAr, refId, days: d, status: st, statusLabel: sl
    });
  });
  results.sort((a, b) => (b.days || 0) - (a.days || 0) || b.qty - a.qty);
  return results;
}

// ════════════════════════════════════════════════════════════
// مطالبات المرتجعات
// ════════════════════════════════════════════════════════════
function analyzeReturns(financesRaw, returnsRaw, reimRaw) {
  const refundsByRefundId = {};
  financesRaw.forEach(t => {
    if (t.transactionType !== 'Refund') return;
    const refIdEntry = (t.relatedIdentifiers || []).find(i => i.relatedIdentifierName === 'REFUND_ID');
    const refundId = refIdEntry ? refIdEntry.relatedIdentifierValue : t.transactionId;
    if (!refundsByRefundId[refundId]) refundsByRefundId[refundId] = t;
    else if (t.transactionStatus === 'RELEASED' && refundsByRefundId[refundId].transactionStatus !== 'RELEASED') {
      refundsByRefundId[refundId] = t;
    }
  });

  const refundLines = [];
  Object.values(refundsByRefundId).forEach(t => {
    const oidEntry = (t.relatedIdentifiers || []).find(i => i.relatedIdentifierName === 'ORDER_ID');
    const oid = oidEntry ? oidEntry.relatedIdentifierValue : '';
    if (!oid) return;
    const dt = t.postedDate ? new Date(t.postedDate) : null;
    (t.items || []).forEach(item => {
      const ctx = (item.contexts || []).find(c => c.contextType === 'ProductContext') || {};
      const sku = ctx.sku || '';
      const pcBreakdown = (item.breakdowns || []).find(b => b.breakdownType === 'ProductCharges');
      const psTotal = pcBreakdown ? Math.abs(pcBreakdown.breakdownAmount.currencyAmount) : 0;
      const qtyShipped = ctx.quantityShipped && ctx.quantityShipped > 0 ? ctx.quantityShipped : 1;
      const psPerUnit = psTotal / qtyShipped;
      if (oid && psPerUnit > 0) {
        for (let u = 0; u < qtyShipped; u++) {
          refundLines.push({ oid, sku, dt, ps: psPerUnit, desc: (item.description || '').substring(0, 60) });
        }
      }
    });
  });

  const retMap = {}, retDet = {}, retBySkuMap = {}, retDetBySku = {};
  returnsRaw.forEach(raw => {
    const r = normalize(raw);
    const oid = (r['orderid'] || '').trim();
    if (!oid) return;
    const sku = (r['sku'] || '').trim();
    const qty = parseInt(r['quantity'] || '1') || 1;
    retMap[oid] = (retMap[oid] || 0) + qty;
    const key = oid + '||' + sku;
    retBySkuMap[key] = (retBySkuMap[key] || 0) + qty;
    const detVal = {
      asin: r['asin'] || '', sku: r['sku'] || '', fnsku: r['fnsku'] || '',
      name: (r['productname'] || '').substring(0, 60), reason: r['reason'] || '', disp: r['detaileddisposition'] || ''
    };
    if (!retDet[oid]) retDet[oid] = detVal;
    if (!retDetBySku[key]) retDetBySku[key] = detVal;
  });

  const reimMap = {}, reimBySkuMap = {}, reimDetBySku = {};
  reimRaw.forEach(raw => {
    const r = normalize(raw);
    if ((r['reason'] || '').trim().toLowerCase() !== 'customerreturn') return;
    const oid = (r['amazonorderid'] || '').trim();
    if (!oid) return;
    const sku = (r['sku'] || '').trim();
    const qty = parseInt(r['quantityreimbursedtotal'] || '0') || 0;
    const amt = Math.abs(parseFloat(String(r['amounttotal'] || '0').replace(/,/g, '')) || 0);
    if (!reimMap[oid]) reimMap[oid] = { qty: 0, amt: 0 };
    reimMap[oid].qty += qty; reimMap[oid].amt += amt;
    const key = oid + '||' + sku;
    if (!reimBySkuMap[key]) reimBySkuMap[key] = { qty: 0, amt: 0 };
    reimBySkuMap[key].qty += qty; reimBySkuMap[key].amt += amt;
    if (!reimDetBySku[key]) reimDetBySku[key] = { asin: r['asin'] || '', fnsku: r['fnsku'] || '', name: (r['productname'] || '').substring(0, 60) };
  });

  const results = [];
  const refOidsSeen = {};
  const byOid = {};
  refundLines.forEach(l => { (byOid[l.oid] = byOid[l.oid] || []).push(l); });

  Object.keys(byOid).forEach(oid => {
    refOidsSeen[oid] = true;
    const lines = byOid[oid];
    lines.sort((a, b) => (a.dt || 0) - (b.dt || 0));
    const det = retDet[oid] || {};

    const skuReturnedUsed = {}, skuReimUsed = {};

    const lineResults = lines.map((line, idx) => {
      const key = oid + '||' + line.sku;
      let thisReturned = 0;
      if (retBySkuMap[key] !== undefined) {
        const usedR = skuReturnedUsed[key] || 0;
        if (usedR < retBySkuMap[key]) { thisReturned = 1; skuReturnedUsed[key] = usedR + 1; }
      }
      return { line, idx, key, thisReturned };
    });

    lineResults.forEach(({ line, key, thisReturned }) => {
      const dt = line.dt;
      const d = days(dt);
      const sku = line.sku;

      let thisReimbursed = 0;
      if (thisReturned === 0 && reimBySkuMap[key] !== undefined) {
        const usedX = skuReimUsed[key] || 0;
        if (usedX < reimBySkuMap[key].qty) { thisReimbursed = 1; skuReimUsed[key] = usedX + 1; }
      }

      const missing = thisReturned ? 0 : 1;
      const owed = (missing > 0 && !thisReimbursed) ? 1 : 0;
      const owedAmt = owed ? line.ps : 0;

      let st, sl;
      if (owed <= 0 && missing <= 0) { st = 'ok'; sl = 'رجع للمخزن'; }
      else if (owed <= 0 && missing > 0) { st = 'reim'; sl = 'تم التعويض'; }
      else if (d === null) { st = 'unk'; sl = 'بدون تاريخ'; }
      else if (d > 105) { st = 'exp'; sl = 'انتهت الفرصة'; }
      else if (d >= 45) { st = 'rdy'; sl = 'جاهزة — ارفع الآن'; }
      else { st = 'early'; sl = 'انتظر (أقل من 45)'; }

      const pieceDet = retDetBySku[key] || reimDetBySku[key] || det || {};
      results.push({
        oid, asin: pieceDet.asin || '', sku: pieceDet.sku || sku || '', fnsku: pieceDet.fnsku || '',
        name: pieceDet.name || line.desc || '', missing, owed, owedAmt,
        refDate: dt ? dt.toISOString().substring(0, 10) : '', days: d, status: st, statusLabel: sl, totalAmt: line.ps
      });
    });
  });

  Object.keys(retMap).forEach(oid => {
    if (!refOidsSeen[oid]) {
      const det = retDet[oid] || {};
      results.push({
        oid, asin: det.asin || '', sku: det.sku || '', fnsku: det.fnsku || '', name: det.name || '',
        missing: 0, owed: 0, owedAmt: 0, refDate: '', days: null, status: 'noref', statusLabel: 'رجع بدون استرداد', totalAmt: 0
      });
    }
  });

  results.sort((a, b) => (b.days || 0) - (a.days || 0));
  return results;
}

module.exports = { analyzeLost, analyzeReturns };
