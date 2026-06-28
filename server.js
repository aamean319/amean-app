// server.js
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { exchangeCodeForRefreshToken } = require('./lwa');
const { saveSeller, getSeller, listSellers, saveSellerReport, getSellerReport } = require('./store');
const { makeClient, pullReimbursements, pullReturns, pullLedger, pullFinances } = require('./reports');
const { analyzeLost, analyzeReturns } = require('./analyze');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const APPLICATION_ID = process.env.SP_APPLICATION_ID; // amzn1.sp.solution.xxxx
const CLIENT_ID = process.env.SP_CLIENT_ID;
const CLIENT_SECRET = process.env.SP_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // لازم يكون مطابق تماماً لما هو مسجّل عند أمازون
const MARKETPLACE_ID = process.env.SP_MARKETPLACE_ID;

function need(name, val) {
  if (!val) {
    console.error(`❌ متغير ${name} مش موجود في .env`);
    process.exit(1);
  }
}
need('SP_APPLICATION_ID', APPLICATION_ID);
need('SP_CLIENT_ID', CLIENT_ID);
need('SP_CLIENT_SECRET', CLIENT_SECRET);
need('REDIRECT_URI', REDIRECT_URI);
need('SP_MARKETPLACE_ID', MARKETPLACE_ID);

// ── خطوة 1: زرار "اربط حسابك" يودي هنا، فيحوّل البائع لصفحة موافقة أمازون ──
app.get('/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // ملحوظة: النسخة دي مش بتتأكد من state بعد الرجوع (تبسيط لمرحلة الاختبار الأولى) — هنضيفها قبل الإطلاق العام
  const consentUrl = `https://sellercentral.amazon.com/apps/authorize/consent`
    + `?application_id=${encodeURIComponent(APPLICATION_ID)}`
    + `&state=${state}`
    + `&version=beta`; // beta = عشان الـ App لسه Draft (مرحلة الاختبار قبل الـ Listing الرسمي)
  res.redirect(consentUrl);
});

// ── خطوة 2: أمازون بترجّع البائع هنا بعد موافقته، مع كود تفويض مؤقت ──
app.get('/oauth/redirect', async (req, res) => {
  const { spapi_oauth_code, selling_partner_id, state } = req.query;

  if (!spapi_oauth_code || !selling_partner_id) {
    return res.status(400).send('حصل خطأ في الربط: بيانات ناقصة من أمازون. حاول تاني.');
  }

  try {
    const tokenData = await exchangeCodeForRefreshToken({
      code: spapi_oauth_code,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI
    });

    saveSeller(selling_partner_id, {
      refreshToken: tokenData.refresh_token,
      connectedAt: new Date().toISOString()
    });

    res.redirect(`/dashboard?seller=${encodeURIComponent(selling_partner_id)}&connected=1`);
  } catch (e) {
    console.error('❌ فشل ربط الحساب:', e.message);
    res.status(500).send('حصل خطأ أثناء ربط حسابك بأمازون. حاول تاني أو تواصل معانا.');
  }
});

// ── صفحة اللوحة الحقيقية لكل بائع ──
app.get('/dashboard', (req, res) => {
  const sellerId = req.query.seller;
  const seller = sellerId ? getSeller(sellerId) : null;
  if (!seller) return res.status(404).send('الحساب ده مش مربوط. ابدأ من صفحة الربط الأول.');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ── API: سحب تقرير معيّن لبائع معيّن وتخزينه ──
app.post('/api/sync/:report', async (req, res) => {
  const sellerId = req.query.seller;
  const seller = sellerId ? getSeller(sellerId) : null;
  if (!seller) return res.status(404).json({ error: 'الحساب مش مربوط' });

  const sp = makeClient(seller.refreshToken);
  const reportType = req.params.report;

  try {
    let data;
    if (reportType === 'reimbursements') data = await pullReimbursements(sp, MARKETPLACE_ID);
    else if (reportType === 'returns') data = await pullReturns(sp, MARKETPLACE_ID);
    else if (reportType === 'ledger') data = await pullLedger(sp, MARKETPLACE_ID);
    else if (reportType === 'finances') data = await pullFinances(sp);
    else return res.status(400).json({ error: 'نوع تقرير غير معروف' });

    saveSellerReport(sellerId, reportType, data);
    res.json({ ok: true, count: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    console.error(`❌ فشل سحب ${reportType}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: تشغيل التحليل على آخر بيانات محفوظة ──
app.post('/api/run/lost', (req, res) => {
  const sellerId = req.query.seller;
  const ledger = getSellerReport(sellerId, 'ledger');
  if (!ledger) return res.status(400).json({ error: 'لازم تسحب تقرير المخزون (ledger) الأول' });
  const results = analyzeLost(ledger.data);
  res.json({ results });
});

app.post('/api/run/returns', (req, res) => {
  const sellerId = req.query.seller;
  const finances = getSellerReport(sellerId, 'finances');
  const returns = getSellerReport(sellerId, 'returns');
  const reim = getSellerReport(sellerId, 'reimbursements');
  if (!finances || !returns || !reim) {
    return res.status(400).json({ error: 'لازم تسحب التقارير التلاتة الأول: finances, returns, reimbursements' });
  }
  const results = analyzeReturns(finances.data, returns.data, reim.data);
  res.json({ results });
});

// ── API: حالة آخر سحب لكل تقرير (يستخدمها الفرونت إند يعرض "آخر تحديث") ──
app.get('/api/status', (req, res) => {
  const sellerId = req.query.seller;
  const types = ['reimbursements', 'returns', 'ledger', 'finances'];
  const status = {};
  types.forEach(t => {
    const r = getSellerReport(sellerId, t);
    status[t] = r ? { fetchedAt: r.fetchedAt, count: Array.isArray(r.data) ? r.data.length : 0 } : null;
  });
  res.json(status);
});

app.get('/', (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
    <head><meta charset="utf-8"><title>Amean — أداة تحليل وتعويضات بائعي أمازون</title></head>
    <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.7;">
      <h1>Amean</h1>
      <p>أداة لبائعي أمازون لتتبع وحساب مطالبات التعويضات (Reimbursements) المستحقة عن المرتجعات والمخزون الضائع أو التالف، بالاعتماد المباشر على بيانات حسابك من Amazon Selling Partner API.</p>

      <h2>الخدمة</h2>
      <ul>
        <li>سحب وتحليل تقارير المرتجعات، الاستردادات، واستردادات التكاليف من حسابك على أمازون مباشرة</li>
        <li>تحديد المطالبات المستحقة عن المخزون الضائع أو التالف في المستودعات</li>
        <li>عرض النتائج في لوحة تحكم واضحة لكل بائع لوحده</li>
      </ul>

      <h2>السعر</h2>
      <p>الخدمة حالياً في مرحلة اختبار محدودة (Beta) مع عدد قليل من البائعين، بدون أي تكلفة خلال هذه المرحلة.</p>

      <p>
        <a href="/connect">🔗 اربط حسابك بأمازون</a> &nbsp;|&nbsp;
        <a href="/privacy">سياسة الخصوصية</a> &nbsp;|&nbsp;
        <a href="/terms">شروط الاستخدام</a>
      </p>
    </body>
    </html>
  `);
});

app.get('/privacy', (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
    <head><meta charset="utf-8"><title>سياسة الخصوصية — Amean</title></head>
    <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8;">
      <h1>سياسة الخصوصية</h1>
      <p>آخر تحديث: ${new Date().toISOString().slice(0,10)}</p>

      <h2>البيانات اللي بنجمعها</h2>
      <p>لما تربط حسابك على أمازون بالأداة، بنحصل بس على البيانات اللي توافق عليها صريح عبر صفحة موافقة أمازون نفسها (Reimbursements، المرتجعات، التحويلات المالية، دفتر المخزون)، وعلى رمز الدخول (Refresh Token) اللازم نتعامل بيه مع حسابك.</p>

      <h2>إزاي بنستخدم البيانات</h2>
      <p>البيانات دي بتستخدم فقط لحساب وعرض مطالبات التعويض المستحقة لك. مفيش بيانات بتُستخدم لأي غرض تسويقي أو تتباع لأي طرف ثالث.</p>

      <h2>تخزين البيانات</h2>
      <p>بياناتك بتُخزّن بشكل منفصل عن باقي البائعين. كل بائع يشوف بياناته بس.</p>

      <h2>مشاركة البيانات</h2>
      <p>مفيش بيانات بتتشارك مع أي طرف خارجي. البيانات بتُستخدم فقط داخل الأداة نفسها لعرض النتائج ليك.</p>

      <h2>حذف البيانات</h2>
      <p>تقدر تطلب حذف بياناتك وإلغاء ربط حسابك في أي وقت عبر التواصل معانا.</p>

      <h2>التواصل</h2>
      <p>لأي استفسار يخص الخصوصية: a.amean.319@gmail.com</p>
    </body>
    </html>
  `);
});

app.get('/terms', (req, res) => {
  res.send(`
    <html dir="rtl" lang="ar">
    <head><meta charset="utf-8"><title>شروط الاستخدام — Amean</title></head>
    <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8;">
      <h1>شروط الاستخدام</h1>
      <p>آخر تحديث: ${new Date().toISOString().slice(0,10)}</p>

      <h2>الخدمة</h2>
      <p>الأداة بتساعدك تحدد وتراقب مطالبات التعويض المستحقة لك من أمازون، بناءً على بياناتك الحقيقية من حسابك. الأداة لا تقدّم أي مطالبة لأمازون بشكل تلقائي بالنيابة عنك — أنت اللي تتخذ القرار النهائي وترفع المطالبة بنفسك.</p>

      <h2>الدقة</h2>
      <p>بنبذل أقصى جهد لضمان دقة البيانات والنتائج، لكن الأداة لسه في مرحلة اختبار (Beta)، وعليك مراجعة كل نتيجة بنفسك قبل اتخاذ أي قرار مالي بناءً عليها.</p>

      <h2>إلغاء الاستخدام</h2>
      <p>تقدر توقف استخدام الأداة وتلغي ربط حسابك في أي وقت.</p>

      <h2>التواصل</h2>
      <p>لأي استفسار: a.amean.319@gmail.com</p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
  console.log(`عدد البائعين المربوطين حالياً: ${listSellers().length}`);
});
