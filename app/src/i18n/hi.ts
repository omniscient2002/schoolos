/* hi — short-code Hindi bundle (Crew A, Master Action Plan 0.6 + 3.1 Hindi-first).
   Covers nav + auth (sign-in / password / two-step) + common actions first, so a
   low-end parent phone gets the critical paths in Hindi even where the fuller
   hi-IN scaffold has gaps. Looked up through the same t() infra: Lang 'hi'
   reads hi → hi-IN → en-IN, and 'hi-IN' reads hi-IN → hi → en-IN, so the two
   Hindi codes back each other up and every other key still falls back to
   English. Persisted like every language via schoolos.lang (see index.ts). */
export const hi: Record<string, string> = {
  // Nav
  'nav.switchSchool': 'स्कूल बदलें',
  'nav.today': 'आज',
  'nav.attention': 'ध्यान दें',
  'nav.ask': 'पूछें',
  'nav.next': 'आगे',
  'nav.people': 'लोग',
  'nav.fees': 'शुल्क',
  'nav.feePlans': 'शुल्क योजनाएँ',
  'nav.learning': 'पढ़ाई',
  'nav.operations': 'संचालन',
  'nav.maintenance': 'रखरखाव',
  'nav.reception': 'स्वागत कक्ष',
  'nav.insights': 'जानकारी',
  'nav.more': 'और',
  'nav.family': 'परिवार',
  'nav.consents': 'सहमति',
  'nav.requests': 'अनुरोध',
  'nav.parentHome': 'होम',
  'nav.messages': 'संदेश',

  // Auth — sign-in
  'login.title': 'अपने स्कूल के वर्कस्पेस में साइन इन करें',
  'login.subtitle': 'स्कूलों के लिए बुद्धिमान ऑपरेटिंग सिस्टम। जारी रखने के लिए साइन इन करें।',
  'login.method.email': 'ईमेल',
  'login.method.phone': 'फ़ोन',
  'login.method.google': 'Google',
  'login.email': 'ईमेल',
  'login.password': 'पासवर्ड',
  'login.phone': 'फ़ोन नंबर',
  'login.signIn': 'साइन इन',
  'login.requestCode': 'कोड मँगवाएँ',
  'login.verifyCode': 'कोड सत्यापित करें',
  'login.mfa.title': 'सत्यापन कोड',
  'login.mfa.hint': 'अपने प्रमाणक ऐप का 6-अंकों का कोड दर्ज करें — या अपना कोई एक बार उपयोग होने वाला रिकवरी कोड।',
  'login.mfa.verify': 'सत्यापित करें और साइन इन करें',
  'login.mfa.back': 'साइन-इन पर वापस',

  // Auth — multi-school chooser
  'login.tenant.title': 'स्कूल चुनें',
  'login.tenant.hint': 'यह खाता {count} स्कूलों से जुड़ा है। खोलने के लिए एक चुनें — आपकी भूमिका हर स्कूल में अलग हो सकती है।',
  'login.tenant.here': 'यहाँ साइन इन है',
  'login.tenant.back': 'साइन-इन पर वापस',

  // Auth — password + two-step (core actions only)
  'pw.title': 'नया पासवर्ड सेट करें',
  'pw.current': 'वर्तमान पासवर्ड',
  'pw.next': 'नया पासवर्ड',
  'pw.confirm': 'नया पासवर्ड दोबारा लिखें',
  'pw.mismatch': 'दोनों नए पासवर्ड मेल नहीं खाते।',
  'pw.same': 'नया पासवर्ड वर्तमान पासवर्ड से अलग होना चाहिए।',
  'pw.save': 'नया पासवर्ड सहेजें',
  'pw.otherAccount': 'दूसरे खाते से साइन इन करें',
  'mfa.setup': 'नया प्रमाणक सेट करें',
  'mfa.turnOff': 'दो-चरणीय साइन-इन बंद करें',
  'mfa.confirm': 'पुष्टि करें और चालू करें',
  'mfa.cancel': 'रद्द करें',
  'mfa.onBadge': 'दो-चरणीय साइन-इन चालू है',
  'mfa.copyAll': 'सभी कोड कॉपी करें',
  'mfa.done': 'हो गया — मैंने सहेज लिया',

  // Settings + parent
  'settings.language': 'भाषा',
  'settings.languagePartial': 'हिन्दी अभी इंटरफ़ेस का एक छोटा हिस्सा दिखाती है — बाकी अंग्रेज़ी में रहेगा।',
  'parent.greeting': 'नमस्ते, {name}',
  'parent.fees': 'शुल्क',

  // Common actions
  'common.save': 'सहेजें',
  'common.cancel': 'रद्द करें',
  'common.close': 'बंद करें',
  'common.retry': 'पुनः प्रयास करें',
  'common.loading': 'लोड हो रहा है…',
  'common.search': 'खोजें',
};
