/* hi-IN — HONEST partial scaffold (L5-3.3). Covers the most-used proof
   strings only; every other key falls back to en-IN. The language switcher
   shows the real coverage — no "fully translated" claim. */
export const hiIN: Record<string, string> = {
  // Shell
  'nav.switchSchool': 'स्कूल बदलें',
  'nav.today': 'आज',
  'nav.attention': 'आपके ध्यान की ज़रूरत',
  'nav.ask': 'पूछें',
  'nav.people': 'लोग',
  'nav.fees': 'शुल्क',
  'nav.feePlans': 'शुल्क योजनाएँ',
  'nav.learning': 'सीखना',
  'nav.family': 'परिवार',
  'nav.consents': 'सहमतियाँ',
  'nav.requests': 'अनुरोध',
  'nav.parentHome': 'होम',
  'nav.messages': 'संदेश',

  // Login
  'login.title': 'अपने स्कूल के वर्कस्पेस में साइन इन करें',
  'login.subtitle': 'स्कूलों के लिए बुद्धिमान ऑपरेटिंग सिस्टम। जारी रखने के लिए साइन इन करें।',
  'login.email': 'ईमेल',
  'login.password': 'पासवर्ड',
  'login.phone': 'फ़ोन नंबर',
  'login.signIn': 'साइन इन',
  'login.mfa.title': 'सत्यापन कोड',
  'login.mfa.hint': 'अपने प्रमाणक ऐप (authenticator) का 6-अंकों का कोड दर्ज करें — या अपने किसी एक बार उपयोग होने वाले रिकवरी कोड को।',
  'login.tenant.title': 'स्कूल चुनें',
  'login.tenant.hint': 'इस खाते से {count} स्कूल जुड़े हैं। खोलने के लिए एक चुनें — आपकी भूमिका प्रति स्कूल अलग हो सकती है।',
  'login.tenant.here': 'यहाँ साइन इन है',
  'login.tenant.back': 'साइन-इन पर वापस',

  // Password change (subset — advisory copy falls back to English)
  'pw.title': 'नया पासवर्ड सेट करें',
  'pw.current': 'वर्तमान पासवर्ड',
  'pw.next': 'नया पासवर्ड',
  'pw.confirm': 'नया पासवर्ड दोबारा',
  'pw.mismatch': 'दोनों नए पासवर्ड मेल नहीं खाते।',
  'pw.same': 'नया पासवर्ड वर्तमान से अलग होना चाहिए।',
  'pw.save': 'नया पासवर्ड सेव करें',
  'pw.otherAccount': 'दूसरे खाते का उपयोग करें',

  // MFA (subset)
  'mfa.setup': 'नया प्रमाणक सेट करें',
  'mfa.turnOff': 'दो-चरण साइन-इन बंद करें',
  'mfa.turnOffNote': 'दो-चरण बंद करना अभी उपलब्ध नहीं है — इसे सर्वर सहायता चाहिए।',
  'mfa.uriLabel': 'एक बार का सेटअप URI (otpauth)',
  'mfa.secretLabel': 'सीक्रेट (यदि आपका ऐप टाइप करके लेता है)',
  'mfa.confirm': 'पुष्टि करें और चालू करें',
  'mfa.cancel': 'रद्द करें',
  'mfa.onBadge': 'दो-चरण साइन-इन चालू है',
  'mfa.copyAll': 'सभी कोड कॉपी करें',
  'mfa.done': 'हो गया — मैंने सेव कर लिया',

  // Settings
  'settings.language': 'भाषा',
  'settings.languagePartial': 'हिन्दी आज इंटरफ़ेस का एक छोटा हिस्सा दिखाती है — बाकी अंग्रेज़ी में रहेगा।',

  // Parent
  'parent.greeting': 'नमस्ते, {name}',
  'parent.fees': 'शुल्क',
};
