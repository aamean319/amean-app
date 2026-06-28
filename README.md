# Amean — خطوة ربط حساب البائع (نسخة اختبار أولى)

ده أول جزء من السيرفر: صفحة "اربط حسابك بأمازون"، واستلام الرد من أمازون، وحفظ توكن كل بائع لوحده. لسه مفيش واجهة كاملة أو زراير سحب بيانات — ده الأساس بس.

## الفكرة بالترتيب

1. البائع يدخل على رابط السيرفر، يدوس "اربط حسابك"
2. يتحول لصفحة أمازون يوافق فيها
3. أمازون ترجّعه لرابط `/oauth/redirect` بتاعنا مع كود مؤقت
4. السيرفر يستبدل الكود ده بـ Refresh Token دائم، ويحفظه مرتبط برقم البائع (Selling Partner ID) في `data/sellers.json`

## الخطوات قبل التشغيل

### 1) ثبّت المكتبات
```
npm install
```

### 2) جهّز `.env`
نسخة من `.env.example` باسم `.env`، وحط فيها `SP_CLIENT_SECRET` بتاعك.

### 3) محتاج رابط حقيقي على الإنترنت (مش localhost) — استضافة مجانية على Render

لأن أمازون لازم "تشوف" الرابط ده عشان ترجّع البائع له بعد الموافقة، مش هينفع تجربة على جهازك لوحده. الخطوات:

1. روح [render.com](https://render.com)، اعمل حساب مجاني
2. اربط حساب GitHub بتاعك (لو الكود مرفوع هناك)، أو ارفع الفولدر مباشرة
3. "New Web Service" → اختار الفولدر ده → Build Command: `npm install` → Start Command: `node server.js`
4. ضيف متغيرات البيئة (Environment Variables) بنفس أسماء `.env` في لوحة Render
5. بعد ما يشتغل، Render هيديك رابط شكله `https://amean.onrender.com`

### 4) سجّل الرابط عند أمازون

روح Seller Central → Apps and Services → Develop Apps → Edit App بتاع "Amean Seller Analytics"، وحط:
- **OAuth Login URI**: `https://amean.onrender.com/connect`
- **OAuth Redirect URI**: `https://amean.onrender.com/oauth/redirect`

وحدّث `.env` بتاعك على Render بنفس الرابط في `REDIRECT_URI`.

### 5) جرب الربط

افتح `https://amean.onrender.com` وجرب تدوس "اربط حسابك بأمازون" — جرب بحسابك انت الأول قبل أي بائع تاني.

⚠️ **ملحوظة أمان مهمة:** التوكنات دلوقتي بتُحفظ في ملف `sellers.json` عادي (غير مشفّر). ده مقبول لمرحلة الاختبار بعدد قليل من البائعين، لكن قبل أي إطلاق عام لازم نرفع لقاعدة بيانات حقيقية مع تشفير.
