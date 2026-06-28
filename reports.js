// lib/reports.js
// ── إنشاء عميل SP-API لأي بائع (بتوكنه هو)، وسحب الـ4 تقارير المتأكد منها ──
const SellingPartner = require('amazon-sp-api');

function makeClient(refreshToken) {
  return new SellingPartner({
    region: process.env.REGION || 'eu',
    refresh_token: refreshToken,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: process.env.SP_CLIENT_ID,
      SELLING_PARTNER_APP_CLIENT_SECRET: process.env.SP_CLIENT_SECRET
    }
  });
}

function windowDates(extraDaysBack = 0) {
  const rawNow = new Date();
  const now = new Date(rawNow.getTime() - 5 * 60 * 1000);
  const from = new Date(now.getTime() - (110 + extraDaysBack) * 24 * 60 * 60 * 1000);
  return { from, now };
}

async function pullReimbursements(sp, marketplaceId) {
  const { from, now } = windowDates();
  const result = await sp.downloadReport({
    body: {
      reportType: 'GET_FBA_REIMBURSEMENTS_DATA',
      marketplaceIds: [marketplaceId],
      dataStartTime: from.toISOString(),
      dataEndTime: now.toISOString()
    },
    version: '2021-06-30',
    interval: 10000,
    cancel_after: 60,
    download: { json: true }
  });
  return Array.isArray(result) ? result : (result.json || result);
}

async function pullReturns(sp, marketplaceId) {
  // فترة أوسع (60 يوم زيادة) لأن المرتجع الفعلي ممكن يوصل قبل الاسترداد بفترة
  const { from, now } = windowDates(60);
  const result = await sp.downloadReport({
    body: {
      reportType: 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',
      marketplaceIds: [marketplaceId],
      dataStartTime: from.toISOString(),
      dataEndTime: now.toISOString()
    },
    version: '2021-06-30',
    interval: 10000,
    cancel_after: 60,
    download: { json: true }
  });
  return Array.isArray(result) ? result : (result.json || result);
}

async function pullLedger(sp, marketplaceId) {
  const { from, now } = windowDates();
  const result = await sp.downloadReport({
    body: {
      reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
      marketplaceIds: [marketplaceId],
      dataStartTime: from.toISOString(),
      dataEndTime: now.toISOString()
    },
    version: '2021-06-30',
    interval: 15000,
    cancel_after: 80,
    download: { json: true }
  });
  return Array.isArray(result) ? result : (result.json || result);
}

async function pullFinances(sp) {
  const { from, now } = windowDates();
  const all = [];
  let nextToken = null;
  do {
    const query = { postedAfter: from.toISOString(), postedBefore: now.toISOString() };
    if (nextToken) query.nextToken = nextToken;
    const res = await sp.callAPI({
      operation: 'listTransactions',
      endpoint: 'finances',
      options: { version: '2024-06-19' },
      query
    });
    const payload = res.payload || res;
    all.push(...(payload.transactions || []));
    nextToken = payload.nextToken || null;
  } while (nextToken);
  return all;
}

module.exports = { makeClient, pullReimbursements, pullReturns, pullLedger, pullFinances };
