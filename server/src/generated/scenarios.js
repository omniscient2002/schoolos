var MOCK_SCENARIOS = (() => {
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

  // src/mock/scenarios.ts
  var scenarios_exports = {};
  __export(scenarios_exports, {
    SCENARIOS: () => SCENARIOS
  });
  var SCENARIOS = [
    {
      id: "bus14",
      title: "Bus 14 breaks down",
      blurb: "The flagship loop: a transport event becomes a decision, a parent message, an incident, an audit entry and a memory record \u2014 without a single spreadsheet.",
      steps: [
        { label: "Event", detail: "Bus 14 stationary 14 min past expected window on Route 7", screen: "Event stream / Transport" },
        { label: "Detection", detail: "Reconciliation of GPS + route timetable flags verified delay (+13 min)", screen: "Attention feed" },
        { label: "Policy check", detail: "Transport \xA73.1: delay > 10 min \u2192 notify guardians within 15 min \u2014 AUTO", screen: "Event detail" },
        { label: "Notification", detail: "38 guardians receive revised ETA; 2 reply with concerns on WhatsApp", screen: "Parent messages" },
        { label: "Case", detail: "Kavita Sharma\u2019s complaint becomes case #1 with a 24h SLA", screen: "Cases" },
        { label: "Attention", detail: "SchoolOS correlates: 15 of 20 absent 8-B students ride Bus 14", screen: "Attention feed" },
        { label: "Briefing", detail: "Morning Briefing places this under \u201CNEEDS YOU\u201D with a 4-step evidence chain", screen: "Principal Today" },
        { label: "Evidence", detail: "Attendance trend, GPS timeline, roster overlap, parent messages \u2014 each sourced", screen: "Ask / evidence chain" },
        { label: "Draft", detail: "Reassurance message to 24 guardians of 8-B, drafted in policy tone", screen: "Action Center" },
        { label: "Approval", detail: "Posture APPROVAL REQUIRED \u2014 Principal reviews and approves", screen: "Action Center" },
        { label: "Delivery", detail: "WhatsApp delivery: 23 delivered, 1 retry, read receipts shown", screen: "Action detail" },
        { label: "Incident", detail: "Transport incident inc_1 tracked to resolution with timeline", screen: "Incidents" },
        { label: "Audit", detail: "Every step appended to the immutable audit ledger", screen: "Audit ledger" },
        { label: "Memory", detail: "Decision recorded: pre-route inspection for 4 weeks (dec_4), review due", screen: "Memory" }
      ]
    },
    {
      id: "fee-dip",
      title: "The week collections dipped",
      blurb: "A payment cluster that looks like a finance crisis turns out to be an operational side-effect \u2014 found, explained, and gently resolved.",
      steps: [
        { label: "Signal", detail: "Daily collection rate falls below the 4-week band", screen: "Fee Intelligence" },
        { label: "Cluster", detail: "47 failed payments isolated; 41 share Route 7 households", screen: "Fee Intelligence \xB7 WHAT CHANGED" },
        { label: "Explanation", detail: "Correlation with Bus 14 week; affordability ruled out (historical payment behaviour)", screen: "Insights" },
        { label: "Separation", detail: "23 gateway timeouts separated from true failures (reconciliation)", screen: "Data Health / Cases" },
        { label: "Action", detail: "Assistance message drafted \u2014 no-shaming tone, no late fee by policy", screen: "Action Center" },
        { label: "Approval", detail: "Bulk messaging requires approval (Communication \xA72.1)", screen: "Action Center" },
        { label: "Recovery", detail: "Retries allowed 5 days without late fee; finance call tasks for repeats", screen: "Workflow wf_4" },
        { label: "Audit", detail: "Draft, approval and sends logged with policy refs", screen: "Audit ledger" }
      ]
    },
    {
      id: "new-admission",
      title: "A new admission walks in",
      blurb: "From WhatsApp enquiry to enrolled student \u2014 every document chased, every fee obligation provisioned.",
      steps: [
        { label: "Enquiry", detail: "Guardian enquires via WhatsApp; lead created instantly", screen: "Admissions funnel" },
        { label: "Follow-up", detail: "Counsellor task with context: source, grade, sibling check", screen: "Lead detail" },
        { label: "Visit", detail: "Campus tour scheduled; reminder workflow armed", screen: "Calendar" },
        { label: "Documents", detail: "Document checklist auto-tracked; missing items chased gently", screen: "Documents" },
        { label: "Offer", detail: "Fee plan generated from fee structure; sibling waiver applied within cap", screen: "Lead detail" },
        { label: "Approval", detail: "Any concession above 10% routes to Principal (Fees \xA74.2)", screen: "Action Center" },
        { label: "Enrollment", detail: "Section assigned; transport route; fee obligations provisioned", screen: "People" },
        { label: "Migration", detail: "Day-1: student appears in attendance, WhatsApp, transport roster", screen: "All systems" }
      ]
    },
    {
      id: "projector",
      title: "The projector that got fixed",
      blurb: "The maintenance story end to end: a teacher reports in one line, SchoolOS understands it, a technician is recommended with reasons, and the repair closes the loop \u2014 evidence at every step.",
      steps: [
        { label: "Report", detail: "Priya Iyer types one line: \u201CThe projector in Science Lab 204 isn\u2019t turning on.\u201D No forms, no dropdowns.", screen: "Report issue" },
        { label: "Understanding", detail: "SchoolOS classifies AV, matches asset NOR-PRJ-204 at 97%, sets priority High (31 students affected this period), needs AV-systems skill.", screen: "Report issue \xB7 AI understanding" },
        { label: "Work order", detail: "WO-1045 opens on the board with SLA clock: respond 60 min, resolve 24h \u2014 deterministic policy, not vibes.", screen: "Maintenance board" },
        { label: "Recommendation", detail: "Arif Shaikh recommended: AV-trained, 96% first-time fix, 1 active job. The \u201Cwhy\u201D is shown in three plain lines.", screen: "Work order WO-1045" },
        { label: "Assignment", detail: "Facilities desk assigns with one tap. Ravi gets the job with location, history, and probable causes \u2014 no phone call.", screen: "Work order WO-1045" },
        { label: "Copilot", detail: "Technician view: last 2 failures on this projector, manual reference, 4 inspection steps. AI as decision support, never a verdict.", screen: "Technician workspace" },
        { label: "Repair", detail: "Power path fault \u2014 socket, not the projector. Voice note parsed: \u201CReplaced the cable. Works now. 40 minutes.\u201D", screen: "Technician workspace" },
        { label: "Verification", detail: "Status \u2192 verification. Priya gets a resolution notification with the fix summary and cost.", screen: "Work order WO-1045" },
        { label: "Close the loop", detail: "Reporter confirms. Asset history updates: 1 new failure record, spend logged, health recalculated.", screen: "Asset NOR-PRJ-204" },
        { label: "Learn", detail: "Insights update: AV category MTTR, lamp-hours watch item, and the preventive plan for projectors stays on track.", screen: "Maintenance intelligence" }
      ]
    },
    {
      id: "inspection",
      title: "The inspection visit",
      blurb: "An inspection notice arrives 3 weeks out. The school walks in with everything \u2014 because the obligations loop was already running.",
      steps: [
        { label: "Notice", detail: "Inspection date recorded; obligation created with lead time", screen: "Obligations" },
        { label: "Checklist", detail: "Compliance pack assembled: certificates, staff records, safety drills", screen: "Documents" },
        { label: "Gaps", detail: "Fire safety certificate expiring in 21 days \u2014 renewal task raised", screen: "Data Health" },
        { label: "Drill", detail: "Fire drill scheduled across campuses; attendance evidence captured", screen: "Calendar" },
        { label: "Constitution", detail: "Policy versions exported as effective on inspection date", screen: "Constitution" },
        { label: "Ready", detail: "Inspection pack generated; every claim traceable to a record", screen: "Documents" }
      ]
    }
  ];
  return __toCommonJS(scenarios_exports);
})();
