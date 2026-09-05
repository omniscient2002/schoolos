var MOCK_RECEPTION = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/mock/reception.ts
  var reception_exports = {};
  __export(reception_exports, {
    callById: () => callById,
    calls: () => calls,
    deskAnalytics: () => deskAnalytics,
    deskIntents: () => deskIntents,
    deskSettings: () => deskSettings,
    gatePasses: () => gatePasses,
    visitors: () => visitors
  });
  var minsAgo = (m) => new Date(Date.now() - m * 6e4);
  var at = (h, m) => {
    const d = /* @__PURE__ */ new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  var T = (arr) => arr.map(([a, speaker, text]) => ({ at: a, speaker, text }));
  var deskSettings = {
    hours: "Mon\u2013Sat 07:30\u201316:30",
    aiAnswerThresholdSec: 15,
    languages: ["English", "Hindi", "Hinglish"],
    escalationNumber: "+91 22 4000 4500 (front office landline)",
    recordingConsentLine: "This call may be recorded for quality. Say STOP to disable.",
    maxCallDurationMin: 12,
    emergencyPolicy: "Front Desk \xA71.4 \u2014 emergencies interrupt everything and ring the duty principal"
  };
  var deskIntents = [
    { id: "hours", label: "Timings & calendar", callsToday: 14, resolvedByAiPct: 100, example: "Is there school tomorrow?" },
    { id: "transport", label: "Bus & transport", callsToday: 11, resolvedByAiPct: 91, example: "Where is Bus 14 right now?" },
    { id: "fees", label: "Fees & receipts", callsToday: 9, resolvedByAiPct: 78, example: "I paid yesterday, receipt nahi aaya" },
    { id: "attendance", label: "Absence reporting", callsToday: 6, resolvedByAiPct: 100, example: "My son is unwell, he will be absent" },
    { id: "documents", label: "TC / documents", callsToday: 4, resolvedByAiPct: 75, example: "Transfer certificate kab milega?" },
    { id: "admissions", label: "Admissions enquiry", callsToday: 3, resolvedByAiPct: 67, example: "Grade 6 admission is still open?" },
    { id: "maintenance", label: "Facilities complaint", callsToday: 2, resolvedByAiPct: 50, example: "The water cooler on floor 2 is leaking again" },
    { id: "emergency", label: "Emergency", callsToday: 0, resolvedByAiPct: 0, example: "(interrupts everything \u2014 rings duty principal)" }
  ];
  var calls = [
    {
      id: "RC-214",
      on: minsAgo(12),
      channel: "phone",
      callerNumber: "+91 98204 4xx71",
      callerName: "Guardian \u2014 Meera Sharma (Aarav, 8-B)",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [4, "caller", "Bus 14 kahan tak pahuncha? My son usually calls from the bus."],
        [9, "ai", "Bus 14 is on Route 7 near Sector 12, running about 4 minutes late \u2014 15 of 38 stops completed. I can send you a live tracking link on WhatsApp."],
        [19, "caller", "Haan, send karo."],
        [22, "ai", "Sent to your registered number. Anything else?"],
        [25, "caller", "No, thank you."]
      ]),
      intents: ["transport"],
      resolvedByAi: true,
      outcome: "resolved",
      durationSec: 28,
      callerSentiment: "satisfied",
      recordingConsent: true,
      linkedRecords: ["Bus 14 \xB7 Route 7", "GPS feed"],
      language: "Hinglish"
    },
    {
      id: "RC-213",
      on: minsAgo(41),
      channel: "phone",
      callerNumber: "+91 99303 4xx18",
      callerName: "Guardian \u2014 R. Iyer (Ananya, 6-A)",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [5, "caller", "I paid the Term 2 balance yesterday evening but the receipt hasn\u2019t come."],
        [11, "ai", "I can see a payment of \u20B957,457 initiated yesterday at 6:42 pm from your bank, which is pending settlement \u2014 the gateway shows a UPI timeout, not a failed payment. No late fee will apply. The receipt will be issued automatically once tonight\u2019s settlement file is imported, and I\u2019ll send it to you on WhatsApp. Would you like me to note this for the accounts team?"],
        [34, "caller", "Yes please, and can someone confirm tomorrow?"],
        [39, "ai", "I\u2019ve logged a callback request for the accounts team with your reference. You\u2019ll get a call before 5 pm tomorrow."]
      ]),
      intents: ["fees"],
      resolvedByAi: true,
      outcome: "callback-scheduled",
      callbackFor: "Finance (Accounts)",
      durationSec: 47,
      callerSentiment: "neutral",
      recordingConsent: true,
      linkedRecords: ["Fee ledger \u2014 pending settlement", "Gateway status", "Fees \xA74.2 (no late fee on retries)"],
      language: "English"
    },
    {
      id: "RC-212",
      on: minsAgo(58),
      channel: "whatsapp",
      transcript: T([
        [0, "caller", "TC meri beti ke liye chahiye. Kab milega?"],
        [3, "ai", "Transfer certificates are issued within 5 working days of the request (Documents \xA72.1). I don\u2019t see a TC request for your daughter yet. Would you like me to start one? I\u2019ll need the last class and reason."],
        [16, "caller", "Class 7, relocating to Pune."],
        [19, "ai", "Started. Reference DOC-TC-0912. The registrar will WhatsApp you the document checklist within a day."]
      ]),
      intents: ["documents"],
      resolvedByAi: true,
      outcome: "resolved",
      durationSec: 34,
      callerSentiment: "satisfied",
      recordingConsent: true,
      linkedRecords: ["Documents \xA72.1", "DOC-TC-0912"],
      language: "Hinglish"
    },
    {
      id: "RC-211",
      on: minsAgo(72),
      channel: "phone",
      callerNumber: "+91 98198 7xx45",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [4, "caller", "The water cooler on the second floor is leaking again, someone slipped near it this morning."],
        [10, "ai", "Thank you \u2014 this is safety-relevant. I\u2019ve filed it as an urgent facilities report with the location, and flagged that a slip hazard exists. The facilities desk is being notified now. May I confirm which campus and floor?"],
        [22, "caller", "North campus, Block B, second floor corridor."],
        [27, "ai", "Recorded. Report reference has been sent to you on WhatsApp. If anyone is injured, please inform the front office immediately \u2014 that line rings the nurse directly."],
        [38, "human-staff", "(Vikram Joshi joined the call \u2014 maintenance WO raised)"]
      ]),
      intents: ["maintenance"],
      resolvedByAi: false,
      handedOffTo: "Vikram Joshi",
      handoffReason: "Recurring leak + slip hazard \u2014 FM took the call live",
      outcome: "handoff",
      durationSec: 55,
      callerSentiment: "frustrated",
      recordingConsent: true,
      linkedRecords: ["NOR-WC-07", "Front Desk \xA71.3 (hazard \u2192 immediate handoff)"],
      language: "English"
    },
    {
      id: "RC-210",
      on: at(8, 41),
      channel: "phone",
      callerNumber: "unknown",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [4, "caller", "(silence, then background voices)"],
        [9, "ai", "I\u2019m sorry, I didn\u2019t catch that. Are you calling about transport, fees, or something else?"],
        [15, "caller", "(disconnects)"],
        [16, "ai", "No problem \u2014 you can reach us any time between 7:30 and 4:30, or WhatsApp us anytime."]
      ]),
      intents: ["other"],
      resolvedByAi: true,
      outcome: "voicemail",
      durationSec: 17,
      callerSentiment: "neutral",
      recordingConsent: true,
      language: "English"
    },
    {
      id: "RC-209",
      on: at(8, 12),
      channel: "phone",
      callerNumber: "+91 98204 4xx71",
      callerName: "Guardian \u2014 Meera Sharma (Aarav, 8-B)",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [3, "caller", "Aarav is unwell, he won\u2019t come today. Fever since last night."],
        [8, "ai", 'Thank you. I\u2019ve marked Aarav Sharma of 8-B absent today with reason "Fever \u2014 informed by guardian" and the class teacher will see it on her register. Wishing him a quick recovery.'],
        [18, "caller", "Thank you."]
      ]),
      intents: ["attendance"],
      resolvedByAi: true,
      outcome: "resolved",
      durationSec: 21,
      callerSentiment: "satisfied",
      recordingConsent: true,
      linkedRecords: ["Attendance register 8-B", "Attendance \xA71.1 (guardian-informed absence)"],
      language: "English"
    },
    {
      id: "RC-208",
      on: at(7, 55),
      channel: "phone",
      callerNumber: "+91 99872 1xx09",
      callerName: "Prospect parent (Grade 6 enquiry)",
      transcript: T([
        [0, "ai", "Good morning, Meridian International Academy. How can I help?"],
        [4, "caller", "Grade 6 admission is still open? What are the fees?"],
        [9, "ai", "Grade 6 has a short waitlist with 4 seats provisionally available for the current term. The term fee is \u20B91,18,000 with transport optional by route. I can book you a campus visit this week \u2014 Tuesday or Thursday at 10 am?"],
        [26, "caller", "Thursday works."],
        [29, "ai", "Booked for Thursday 10 am, guided by our admissions coordinator Meenakshi Rao. You\u2019ll get a confirmation on WhatsApp with directions and the document list."]
      ]),
      intents: ["admissions"],
      resolvedByAi: true,
      outcome: "resolved",
      durationSec: 36,
      callerSentiment: "satisfied",
      recordingConsent: true,
      linkedRecords: ["Admissions pipeline \u2014 Grade 6", "Fee schedule 2026-27"],
      language: "English"
    }
  ];
  var visitors = [
    { id: "V-118", name: "Kavita Menon", purpose: "Admissions visit", host: "Meenakshi Rao", on: minsAgo(24), badgeNo: "B-041", photoVerified: true, preRegistered: true },
    { id: "V-117", name: "Suresh Gupta (AquaSure)", purpose: "Vendor", host: "Vikram Joshi", on: minsAgo(66), badgeNo: "B-040", photoVerified: true, preRegistered: true },
    { id: "V-116", name: "Dr. Anil Deshmukh", purpose: "Govt / board", host: "Principal office", on: minsAgo(95), badgeNo: "B-039", photoVerified: true, preRegistered: false },
    { id: "V-115", name: "Farah Khan", purpose: "Interview", host: "HR \u2014 Anjali Bose", on: at(9, 30), badgeNo: "B-038", out: minsAgo(35), photoVerified: true, preRegistered: true },
    { id: "V-114", name: "Ravi Kadam (courier)", purpose: "Delivery", host: "Front office", on: at(9, 5), badgeNo: "B-037", out: at(9, 12), photoVerified: false, preRegistered: false }
  ];
  var gatePasses = [
    { id: "GP-062", student: "Ishaan Verma", section: "7-C", reason: "Dentist appointment (pre-approved)", on: minsAgo(48), approvedBy: "Coordinator desk", guardianSms: true, collectedBy: "Mother (verified)" },
    { id: "GP-061", student: "Sana Qureshi", section: "9-A", reason: "Not feeling well \u2014 nurse advised home rest", on: at(10, 42), approvedBy: "School nurse", guardianSms: true, collectedBy: "Father (verified)" }
  ];
  var deskAnalytics = () => {
    const total = calls.length;
    const handoff = calls.filter((c) => c.outcome === "handoff").length;
    return {
      callsToday: 49,
      // 7 logged + 42 summarized from the day's log
      answeredByAi: 47,
      avgAnswerSec: 3,
      handoffRate: Math.round(handoff / total * 100),
      avgDurationSec: Math.round(calls.reduce((a, c) => a + c.durationSec, 0) / total),
      missedCalls: 0,
      guardrailTriggers: 1,
      // RC-211 hazard rule
      byIntent: deskIntents.map((i) => ({ intent: i.label, count: i.callsToday, aiResolved: Math.round(i.callsToday * i.resolvedByAiPct / 100) }))
    };
  };
  var callById = (id) => calls.find((c) => c.id === id);
  return __toCommonJS(reception_exports);
})();
