var MOCK_MAINTENANCE = (() => {
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

  // src/mock/maintenance.ts
  var maintenance_exports = {};
  __export(maintenance_exports, {
    SLA_POLICY: () => SLA_POLICY,
    assetById: () => assetById,
    assets: () => assets,
    campusWorkOrders: () => campusWorkOrders,
    inspections: () => inspections,
    inventory: () => inventory,
    maintAnalytics: () => maintAnalytics,
    maintPlans: () => maintPlans,
    openWorkOrders: () => openWorkOrders,
    recommendTechnicians: () => recommendTechnicians,
    replacementView: () => replacementView,
    slaState: () => slaState,
    technicianByName: () => technicianByName,
    technicians: () => technicians,
    vendors: () => vendors,
    woById: () => woById,
    woSpend: () => woSpend,
    workOrders: () => workOrders
  });
  var NOW = Date.now();
  var minsAgo = (m) => new Date(NOW - m * 6e4);
  var daysAgo = (d, h = 10, m = 0) => {
    const dt = new Date(NOW - d * 864e5);
    dt.setHours(h, m, 0, 0);
    return dt;
  };
  var daysAhead = (d, h = 10, m = 0) => {
    const dt = new Date(NOW + d * 864e5);
    dt.setHours(h, m, 0, 0);
    return dt;
  };
  var SLA_POLICY = {
    emergency: { responseMins: 10, resolveMins: 240 },
    critical: { responseMins: 30, resolveMins: 480 },
    high: { responseMins: 60, resolveMins: 1440 },
    medium: { responseMins: 240, resolveMins: 4320 },
    low: { responseMins: 480, resolveMins: 10080 }
  };
  var assets = [
    {
      id: "NOR-AC-04",
      name: "Science Lab AC \u2014 Room 204",
      category: "HVAC",
      campus: "north",
      building: "Block A",
      floor: 2,
      room: "204",
      manufacturer: "Voltas",
      model: "Viestar 5.0T 3-Phase",
      installedOn: daysAgo(2920),
      warrantyUntil: daysAgo(-365),
      purchaseCost: 74e3,
      criticality: "high",
      status: "degraded",
      health: 42,
      healthFactors: [
        { factor: "Repeated failures", impact: -24, note: "4 cooling failures in 63 days" },
        { factor: "Repair spend trend", impact: -14, note: "\u20B918,400 this year \u2014 25% of replacement cost" },
        { factor: "Age vs expected life", impact: -12, note: "8.0 yrs of 10 yr design life" },
        { factor: "Preventive adherence", impact: -8, note: "2 filter service windows missed" }
      ],
      lastService: daysAgo(21),
      serviceIntervalDays: 90,
      repairSpendYTD: 18400,
      expectedLifeYears: 10,
      manualDoc: "Voltas Viestar service manual \xB7 v3",
      failures: [
        { on: daysAgo(63), summary: "Cooling failure \u2014 capacitor replaced", cost: 4200, workOrderId: "WO-0986" },
        { on: daysAgo(41), summary: "Low airflow \u2014 filter blockage", cost: 900, workOrderId: "WO-1011" },
        { on: daysAgo(24), summary: "Cooling failure \u2014 gas top-up", cost: 6100, workOrderId: "WO-1027" },
        { on: daysAgo(4), summary: "Trips breaker after 10 min", cost: 7200, workOrderId: "WO-1040" }
      ]
    },
    {
      id: "NOR-PRJ-204",
      name: "Projector \u2014 Room 204 (Science Lab)",
      category: "AV",
      campus: "north",
      building: "Block A",
      floor: 2,
      room: "204",
      manufacturer: "Epson",
      model: "EB-X49 XGA",
      installedOn: daysAgo(1120),
      warrantyUntil: daysAhead(210),
      purchaseCost: 42500,
      criticality: "medium",
      status: "down",
      health: 58,
      healthFactors: [
        { factor: "Lamp hours", impact: -18, note: "4,120 hrs of 6,000 rated" },
        { factor: "Dust environment", impact: -10, note: "Lab room \u2014 higher intake dust" },
        { factor: "Failure pattern", impact: -8, note: "2 power events in 14 months" }
      ],
      lastService: daysAgo(150),
      serviceIntervalDays: 180,
      repairSpendYTD: 2600,
      manualDoc: "Epson EB-X49 quick service guide",
      failures: [{ on: daysAgo(420), summary: "HDMI board intermittent \u2014 reseated", cost: 2600, workOrderId: "WO-0712" }]
    },
    {
      id: "NOR-GEN-01",
      name: "Diesel Generator 125 kVA",
      category: "Power",
      campus: "north",
      building: "Utility yard",
      floor: 0,
      room: "Yard",
      manufacturer: "Kirloskar",
      model: "KG1-125AS",
      installedOn: daysAgo(2190),
      purchaseCost: 89e4,
      criticality: "high",
      status: "watch",
      health: 64,
      healthFactors: [
        { factor: "Compliance window", impact: -20, note: "Quarterly inspection overdue by 5 days" },
        { factor: "Runtime since service", impact: -8, note: "412 hrs since oil change (limit 500)" }
      ],
      lastService: daysAgo(48),
      serviceIntervalDays: 90,
      repairSpendYTD: 21400,
      expectedLifeYears: 15,
      failures: [{ on: daysAgo(300), summary: "Battery weak \u2014 replaced", cost: 8400, workOrderId: "WO-0615" }]
    },
    {
      id: "NOR-WC-07",
      name: "Drinking water cooler \u2014 Block B corridor",
      category: "Water",
      campus: "north",
      building: "Block B",
      floor: 1,
      room: "Corridor",
      manufacturer: "Blue Star",
      model: "PCG4040",
      installedOn: daysAgo(1460),
      purchaseCost: 38e3,
      criticality: "high",
      status: "down",
      health: 36,
      healthFactors: [
        { factor: "Active failure", impact: -30, note: "Leak at supply joint \u2014 isolated 09:10" },
        { factor: "Hygiene risk", impact: -14, note: "Drinking-water asset, 400+ students daily" }
      ],
      lastService: daysAgo(60),
      serviceIntervalDays: 60,
      repairSpendYTD: 3100,
      failures: [{ on: daysAgo(190), summary: "Cooling element \u2014 replaced", cost: 3100, workOrderId: "WO-0930" }]
    },
    {
      id: "NOR-EL-02",
      name: "Passenger lift \u2014 Block A",
      category: "Safety",
      campus: "north",
      building: "Block A",
      floor: 0,
      room: "Lift lobby",
      manufacturer: "Kone",
      model: "Monospace 700",
      installedOn: daysAgo(2470),
      warrantyUntil: daysAgo(500),
      purchaseCost: 185e4,
      criticality: "high",
      status: "watch",
      health: 71,
      healthFactors: [
        { factor: "Entrapment history", impact: -18, note: "1 abnormal stop with passengers, 7 months ago" },
        { factor: "AMC compliance", impact: -6, note: "Monthly vendor visit \u2014 1 missed" }
      ],
      lastService: daysAgo(26),
      serviceIntervalDays: 30,
      repairSpendYTD: 15800,
      expectedLifeYears: 20,
      manualDoc: "Kone monthly safety checklist",
      failures: [{ on: daysAgo(215), summary: "Abnormal stop between floors \u2014 passengers assisted out", cost: 12400, workOrderId: "WO-0881" }]
    },
    {
      id: "NOR-FP-01",
      name: "Fire pump \u2014 hydrant system",
      category: "Safety",
      campus: "north",
      building: "Utility yard",
      floor: 0,
      room: "Pump room",
      manufacturer: "Kirloskar",
      model: "HC-95",
      installedOn: daysAgo(1980),
      purchaseCost: 24e4,
      criticality: "high",
      status: "operational",
      health: 88,
      healthFactors: [{ factor: "Inspection due", impact: -8, note: "Weekly churn test due Friday" }],
      lastService: daysAgo(9),
      serviceIntervalDays: 30,
      repairSpendYTD: 0,
      failures: []
    },
    {
      id: "CIT-WP-01",
      name: "RO water purifier \u2014 dining hall",
      category: "Water",
      campus: "city",
      building: "Dining block",
      floor: 0,
      room: "Kitchen",
      manufacturer: "Kent",
      model: "Supreme 500 LPH",
      installedOn: daysAgo(980),
      purchaseCost: 85e3,
      criticality: "high",
      status: "operational",
      health: 82,
      healthFactors: [{ factor: "Filter life", impact: -12, note: "Membrane at 78% of rated output" }],
      lastService: daysAgo(34),
      serviceIntervalDays: 45,
      repairSpendYTD: 5600,
      failures: [{ on: daysAgo(200), summary: "TDS drift \u2014 membrane flushed", cost: 1800 }]
    },
    {
      id: "EAS-AC-11",
      name: "Library AC \u2014 east wing",
      category: "HVAC",
      campus: "east",
      building: "Library block",
      floor: 1,
      room: "Reading hall",
      manufacturer: "Daikin",
      model: "SkyAir FFA71",
      installedOn: daysAgo(1680),
      purchaseCost: 96e3,
      criticality: "medium",
      status: "watch",
      health: 61,
      healthFactors: [
        { factor: "Age vs expected life", impact: -14, note: "4.6 yrs \u2014 condenser corrosion typical in coastal east" },
        { factor: "Service adherence", impact: -10, note: "Pre-monsoon service pending" }
      ],
      lastService: daysAgo(140),
      serviceIntervalDays: 120,
      repairSpendYTD: 4800,
      failures: [{ on: daysAgo(77), summary: "Water drip from unit \u2014 drain cleared", cost: 1500 }]
    },
    {
      id: "NOR-CCTV-08",
      name: "CCTV NVR + camera bank (8ch)",
      category: "Security",
      campus: "north",
      building: "Admin",
      floor: 1,
      room: "Server room",
      manufacturer: "Hikvision",
      model: "DS-7608NI",
      installedOn: daysAgo(1260),
      warrantyUntil: daysAhead(120),
      purchaseCost: 68e3,
      criticality: "medium",
      status: "operational",
      health: 90,
      healthFactors: [{ factor: "Storage headroom", impact: -6, note: "82% disk used \u2014 retention trimming ok" }],
      lastService: daysAgo(70),
      serviceIntervalDays: 180,
      repairSpendYTD: 0,
      failures: []
    },
    {
      id: "NOR-BSW-12",
      name: "Bus 14 \u2014 school bus",
      category: "Safety",
      campus: "north",
      building: "Transport bay",
      floor: 0,
      room: "Bay 3",
      manufacturer: "Tata",
      model: "LPO 1618 \xB7 45-seat",
      installedOn: daysAgo(2010),
      purchaseCost: 285e4,
      criticality: "high",
      status: "maintenance",
      health: 55,
      healthFactors: [
        { factor: "Active incident", impact: -28, note: "Coolant leak \u2014 in workshop (inc_1)" },
        { factor: "Pre-route inspections", impact: -8, note: "Policy WOC review in 3 weeks (dec_4)" }
      ],
      lastService: daysAgo(2),
      serviceIntervalDays: 30,
      repairSpendYTD: 22600,
      failures: [{ on: daysAgo(0), summary: "Coolant leak near Sector 12 \u2014 bus withdrawn from route", cost: 18600, workOrderId: "WO-1041" }]
    }
  ];
  var technicians = [
    { id: "tech_ravi", name: "Ravi Kumar", skills: ["Plumbing", "Water", "Civil"], certifications: ["Plumbing level-2", "Water hygiene handled"], campus: "north", phone: "+91 98204 41127", currentJobs: 1, firstTimeFixRate: 0.94, avgResolutionMins: 96, jobs30d: 31, lastSeen: "On campus \xB7 Block B corridor", shift: "07:30\u201316:30" },
    { id: "tech_sunita", name: "Sunita Yadav", skills: ["HVAC", "Electrical"], certifications: ["HVAC level-3", "Electrical safety"], campus: "north", phone: "+91 98204 41130", currentJobs: 2, firstTimeFixRate: 0.91, avgResolutionMins: 128, jobs30d: 27, lastSeen: "On campus \xB7 Utility yard", shift: "08:00\u201317:00" },
    { id: "tech_arif", name: "Arif Shaikh", skills: ["AV", "Electrical", "Lab"], certifications: ["AV systems", "Lab equipment handled"], campus: "north", phone: "+91 98204 41133", currentJobs: 1, firstTimeFixRate: 0.96, avgResolutionMins: 74, jobs30d: 22, lastSeen: "En route \xB7 Sector 11 depot", shift: "08:30\u201317:30" },
    { id: "tech_manoj", name: "Manoj Patil", skills: ["Safety", "Power", "Electrical"], certifications: ["Fire systems", "DG operation"], campus: "north", phone: "+91 98204 41136", currentJobs: 0, firstTimeFixRate: 0.89, avgResolutionMins: 141, jobs30d: 18, lastSeen: "On campus \xB7 Pump room", shift: "07:00\u201316:00" },
    { id: "tech_leena", name: "Leena D\u2019Souza", skills: ["HVAC", "Cleanliness", "Civil"], certifications: ["HVAC level-2"], campus: "city", phone: "+91 98204 41140", currentJobs: 1, firstTimeFixRate: 0.92, avgResolutionMins: 118, jobs30d: 24, lastSeen: "City campus \xB7 Dining block", shift: "08:00\u201317:00" },
    { id: "tech_imran", name: "Imran Qureshi", skills: ["Electrical", "Plumbing", "Safety"], certifications: ["Electrical safety", "Plumbing level-2"], campus: "east", phone: "+91 98204 41144", currentJobs: 2, firstTimeFixRate: 0.9, avgResolutionMins: 133, jobs30d: 26, lastSeen: "East campus \xB7 Library", shift: "07:30\u201316:30" }
  ];
  var mkSla = (priority, reportedOn) => ({
    responseMins: SLA_POLICY[priority].responseMins,
    resolveMins: SLA_POLICY[priority].resolveMins,
    responseBy: new Date(reportedOn.getTime() + SLA_POLICY[priority].responseMins * 6e4),
    resolveBy: new Date(reportedOn.getTime() + SLA_POLICY[priority].resolveMins * 6e4)
  });
  var workOrders = [
    {
      id: "WO-1046",
      title: "CCTV camera at main gate 2 offline",
      description: "Camera feed has been dark since yesterday evening. Recording light off. Night coverage gap on the gate register.",
      source: "inspection",
      category: "Electrical",
      assetId: "NOR-CCTV-08",
      campus: "north",
      building: "Main gate",
      room: "Gate 2",
      priority: "medium",
      status: "en-route",
      reportedBy: "Security desk",
      reportedRole: "coordinator",
      reportedOn: minsAgo(210),
      assignedTo: "Arif Shaikh",
      assignedOn: minsAgo(180),
      acceptedOn: minsAgo(172),
      sla: mkSla("medium", minsAgo(210)),
      respondedOn: minsAgo(180),
      timeline: [
        { on: minsAgo(210), actor: "Security desk", note: "Nightly camera check found gate 2 feed dark", kind: "note" },
        { on: minsAgo(205), actor: "SchoolOS", note: "Electrical \xB7 surveillance asset \xB7 medium priority (no learning impact, security coverage reduced)", kind: "ai" },
        { on: minsAgo(180), actor: "Facilities desk", note: "Assigned to Arif Shaikh \u2014 AV + electrical certified, 1 active job", kind: "assign" },
        { on: minsAgo(172), actor: "Arif Shaikh", note: "Accepted \u2014 collecting ladder and spare PSU, en route", kind: "status" }
      ],
      partsUsed: [],
      labourMins: 0,
      voiceNotes: []
    },
    {
      id: "WO-1045",
      title: "Projector in Science Lab 204 not turning on",
      description: "Power light does not come on at all. Tried the wall switch and the remote \u2014 no response. First period class moved to 204-B.",
      source: "app",
      category: "AV",
      assetId: "NOR-PRJ-204",
      campus: "north",
      building: "Block A",
      room: "204",
      priority: "high",
      status: "reported",
      reportedBy: "Priya Iyer",
      reportedRole: "teacher",
      reportedOn: minsAgo(34),
      sla: mkSla("high", minsAgo(34)),
      aiUnderstanding: {
        category: "AV",
        assetMatch: { assetId: "NOR-PRJ-204", confidence: 0.97 },
        severity: "high",
        safetyRelevant: false,
        urgency: "today",
        affectedPeople: 31,
        suggestedSkill: "AV systems",
        confidence: 0.92,
        reasoning: [
          "\u201Cnot turning on\u201D + power light dark \u2192 power-path fault, not display setting",
          "Room 204 has exactly one registered AV asset: Epson EB-X49 (NOR-PRJ-204) \u2014 match 97%",
          "Class in session this period \u2192 affects 31 students today",
          "No safety signal; deadline driven by today\u2019s timetable"
        ]
      },
      priorityFactors: [
        { factor: "Learning impact", weight: 28, note: "Lab sessions displaced today" },
        { factor: "Asset criticality", weight: 12, note: "Shared AV for Grade 9\u201310 labs" },
        { factor: "Recurrence", weight: 6, note: "1 similar power event in 14 months" }
      ],
      timeline: [
        { on: minsAgo(34), actor: "Priya Iyer", note: "Reported from staff app: \u201CProjector in Science Lab 204 isn\u2019t turning on.\u201D", kind: "note" },
        { on: minsAgo(33), actor: "SchoolOS", note: "Classified AV \xB7 asset NOR-PRJ-204 matched (97%) \xB7 priority High \xB7 skill: AV systems", kind: "ai" }
      ]
    },
    {
      id: "WO-1044",
      title: "Water cooler leaking \u2014 Block B corridor",
      description: "Puddle forming behind the cooler. Supply valve shut as a precaution; alternate cooler signed nearby.",
      source: "qr",
      category: "Plumbing",
      assetId: "NOR-WC-07",
      campus: "north",
      building: "Block B",
      room: "Corridor",
      priority: "critical",
      status: "on-site",
      reportedBy: "Sanjay Kulkarni (IT, on rounds)",
      reportedRole: "itadmin",
      reportedOn: minsAgo(96),
      assignedTo: "Ravi Kumar",
      assignedOn: minsAgo(88),
      acceptedOn: minsAgo(80),
      startedOn: minsAgo(61),
      sla: mkSla("critical", minsAgo(96)),
      respondedOn: minsAgo(88),
      timeline: [
        { on: minsAgo(96), actor: "QR scan NOR-WC-07", note: "Leaking at supply joint \u2014 scanned asset tag and reported in 40 seconds", kind: "note" },
        { on: minsAgo(90), actor: "SchoolOS", note: "Drinking-water asset \xB7 hygiene risk \u2192 priority CRITICAL (auto rule)", kind: "ai" },
        { on: minsAgo(88), actor: "Facilities desk", note: "Assigned to Ravi Kumar \u2014 plumbing certified, 0.3 km, 1 active job", kind: "assign" },
        { on: minsAgo(80), actor: "Ravi Kumar", note: "Accepted \xB7 ETA 10 min", kind: "status" },
        { on: minsAgo(61), actor: "Ravi Kumar", note: "On site \u2014 isolating joint", kind: "status" }
      ]
    },
    {
      id: "WO-1043",
      title: "Generator quarterly inspection overdue",
      description: "Compliance window closed 5 days ago. DG is primary backup for exam-week power.",
      source: "inspection",
      category: "Safety",
      assetId: "NOR-GEN-01",
      campus: "north",
      building: "Utility yard",
      room: "Yard",
      priority: "critical",
      status: "assigned",
      reportedBy: "Compliance calendar",
      reportedRole: "coordinator",
      reportedOn: minsAgo(7200),
      assignedTo: "Manoj Patil",
      assignedOn: minsAgo(120),
      acceptedOn: minsAgo(110),
      sla: mkSla("critical", minsAgo(7200)),
      respondedOn: minsAgo(120),
      timeline: [
        { on: minsAgo(7200), actor: "Preventive plan MP-03", note: "Inspection window elapsed \u2014 auto-raised as WO", kind: "ai" },
        { on: minsAgo(120), actor: "Facilities desk", note: "Assigned to Manoj Patil \u2014 fire & DG certified", kind: "assign" },
        { on: minsAgo(110), actor: "Manoj Patil", note: "Accepted \u2014 scheduled after pump-room round", kind: "status" }
      ]
    },
    {
      id: "WO-1042",
      title: "AC trips breaker after ~10 minutes",
      description: "Science Lab AC runs, then the circuit trips. Third cooling-related call this term.",
      source: "app",
      category: "HVAC",
      assetId: "NOR-AC-04",
      campus: "north",
      building: "Block A",
      room: "204",
      priority: "high",
      status: "repairing",
      reportedBy: "Lab attendant",
      reportedRole: "coordinator",
      reportedOn: minsAgo(5760),
      assignedTo: "Sunita Yadav",
      assignedOn: minsAgo(5540),
      acceptedOn: minsAgo(5500),
      startedOn: minsAgo(5480),
      sla: mkSla("high", minsAgo(5760)),
      respondedOn: minsAgo(5540),
      recurrenceOf: "WO-1027",
      timeline: [
        { on: minsAgo(5760), actor: "Lab attendant", note: "Breaker trips repeatedly \u2014 unit warm to touch", kind: "note" },
        { on: minsAgo(5540), actor: "Facilities desk", note: "Assigned to Sunita Yadav \u2014 HVAC level-3, 96% fix rate on this asset type", kind: "assign" },
        { on: minsAgo(5480), actor: "Sunita Yadav", note: "On site. Suspect compressor capacitor or gas pressure \u2014 checking both.", kind: "status" },
        { on: minsAgo(4300), actor: "Sunita Yadav", note: "Capacitor within range. Gas pressure low \u2014 topping up and leak-testing.", kind: "note" },
        { on: minsAgo(3100), actor: "SchoolOS", note: "SLA note: resolution due in 6h. Recurrence flagged \u2014 4th failure in 63 days for NOR-AC-04.", kind: "sla" }
      ]
    },
    {
      id: "WO-1041",
      title: "Bus 14 \u2014 coolant leak, withdrawn from route",
      description: "Coolant leak confirmed near Sector 12. Bus at workshop; spare deployed on Route 7.",
      source: "staff",
      category: "Safety",
      assetId: "NOR-BSW-12",
      campus: "north",
      building: "Transport bay",
      room: "Bay 3",
      priority: "emergency",
      status: "verification",
      reportedBy: "Rajeev Nair",
      reportedRole: "transport",
      reportedOn: minsAgo(320),
      assignedTo: "Manoj Patil",
      assignedOn: minsAgo(305),
      acceptedOn: minsAgo(300),
      startedOn: minsAgo(290),
      completedOn: minsAgo(60),
      sla: mkSla("emergency", minsAgo(320)),
      respondedOn: minsAgo(305),
      timeline: [
        { on: minsAgo(320), actor: "Rajeev Nair", note: "Driver reported coolant leak + temperature climb. Bus stopped safely.", kind: "note" },
        { on: minsAgo(315), actor: "SchoolOS", note: "Safety-relevant \xB7 38 students affected \u2192 EMERGENCY (auto rule)", kind: "ai" },
        { on: minsAgo(305), actor: "Facilities desk", note: "Assigned to Manoj Patil", kind: "assign" },
        { on: minsAgo(60), actor: "Manoj Patil", note: "Hose replaced, pressure-tested 20 min. Ready for verification.", kind: "status" }
      ],
      partsUsed: [{ inventoryId: "inv_hose_02", name: "Radiator hose 22mm", qty: 1, cost: 1450 }],
      labourMins: 195,
      resolution: { summary: "Coolant hose replaced and pressure-tested.", rootCause: "Hose chafing at bracket \u2014 routed clear of sharp edge.", preventiveNote: "Bracket padded; all 10 buses to be checked for the same routing (dec_4 in effect)." }
    },
    {
      id: "WO-1039",
      title: "Library AC (east) dripping water",
      description: "Stain on reading-hall ceiling edge below unit.",
      source: "app",
      category: "HVAC",
      assetId: "EAS-AC-11",
      campus: "east",
      building: "Library block",
      room: "Reading hall",
      priority: "medium",
      status: "resolved",
      reportedBy: "Librarian (east)",
      reportedRole: "coordinator",
      reportedOn: daysAgo(3, 9, 30),
      assignedTo: "Imran Qureshi",
      assignedOn: daysAgo(3, 10, 10),
      acceptedOn: daysAgo(3, 10, 40),
      startedOn: daysAgo(3, 11, 5),
      completedOn: daysAgo(3, 14, 10),
      verifiedBy: "Arjun Bhat",
      verificationNote: "Drain clear, ceiling dried and repainted spot.",
      reporterRating: 4,
      sla: mkSla("medium", daysAgo(3, 9, 30)),
      respondedOn: daysAgo(3, 10, 10),
      timeline: [
        { on: daysAgo(3, 9, 30), actor: "Librarian (east)", note: "Drip stain spreading during rain spell", kind: "note" },
        { on: daysAgo(3, 10, 10), actor: "Facilities desk", note: "Assigned to Imran Qureshi", kind: "assign" },
        { on: daysAgo(3, 14, 10), actor: "Imran Qureshi", note: "Drain line flushed, slope corrected. Ran 30 min \u2014 dry.", kind: "status" },
        { on: daysAgo(2, 9, 0), actor: "Arjun Bhat", note: "Verified with librarian. Resolved.", kind: "status" }
      ],
      partsUsed: [{ inventoryId: "inv_drain", name: "AC drain pipe 1m", qty: 1, cost: 120 }],
      labourMins: 185,
      resolution: { summary: "Drain line flushed and re-sloped.", rootCause: "Blockage + settle of drain slope." }
    },
    {
      id: "WO-1036",
      title: "Classroom 7-A tube lights (2) flickering",
      description: "Both front tubes flicker; likely chokes.",
      source: "whatsapp",
      category: "Electrical",
      campus: "north",
      building: "Block A",
      room: "107",
      priority: "low",
      status: "resolved",
      reportedBy: "Class teacher 7-A",
      reportedRole: "teacher",
      reportedOn: daysAgo(5, 8, 40),
      assignedTo: "Sunita Yadav",
      assignedOn: daysAgo(5, 9, 30),
      completedOn: daysAgo(4, 12, 0),
      verifiedBy: "Facilities desk",
      sla: mkSla("low", daysAgo(5, 8, 40)),
      respondedOn: daysAgo(5, 9, 30),
      timeline: [
        { on: daysAgo(5, 8, 40), actor: "Class teacher 7-A", note: "WhatsApp: \u201C7-A ke front lights baar-baar blink kar rahe hain\u201D", kind: "note" },
        { on: daysAgo(4, 12, 0), actor: "Sunita Yadav", note: "Chokes + tubes replaced both fittings.", kind: "status" }
      ],
      partsUsed: [
        { inventoryId: "inv_tube", name: "LED tube 4ft", qty: 2, cost: 720 },
        { inventoryId: "inv_choke", name: "Electronic choke", qty: 2, cost: 640 }
      ],
      labourMins: 90,
      resolution: { summary: "Fittings replaced.", rootCause: "Ageing chokes." }
    }
  ];
  var maintPlans = [
    {
      id: "MP-01",
      title: "AC filter & coil service",
      assetIds: ["NOR-AC-04", "EAS-AC-11"],
      type: "time",
      frequency: "Quarterly",
      intervalDays: 90,
      lastDone: daysAgo(21),
      nextDue: daysAhead(69),
      owner: "Sunita Yadav",
      compliance: "on-track",
      checklist: ["Power down unit", "Remove & wash filters", "Coil chemical clean", "Airflow differential check", "Record gas pressure"],
      safetyNotes: ["Isolate breaker before opening panel"]
    },
    {
      id: "MP-02",
      title: "Lift monthly safety check (vendor)",
      assetIds: ["NOR-EL-02"],
      type: "compliance",
      frequency: "Monthly",
      intervalDays: 30,
      lastDone: daysAgo(26),
      nextDue: daysAhead(4),
      owner: "Kone AMC vendor",
      compliance: "on-track",
      checklist: ["Door interlocks", "Leveling accuracy", "Emergency phone", "Buffers & guides"],
      policyRef: "Lift safety code \xA72.4"
    },
    {
      id: "MP-03",
      title: "Generator quarterly inspection & load test",
      assetIds: ["NOR-GEN-01"],
      type: "compliance",
      frequency: "Quarterly",
      intervalDays: 90,
      lastDone: daysAgo(95),
      nextDue: daysAgo(5),
      owner: "Manoj Patil",
      compliance: "overdue",
      checklist: ["Oil & coolant levels", "Battery load test", "Fuel polish / water drain", "30-min load run", "Log running hours"],
      safetyNotes: ["Yard cleared during load run", "Hearing protection for 125 kVA run"],
      policyRef: "Fire & power code \xA74.1"
    },
    {
      id: "MP-04",
      title: "RO membrane & UV check",
      assetIds: ["CIT-WP-01"],
      type: "condition",
      frequency: "45-day",
      intervalDays: 45,
      lastDone: daysAgo(34),
      nextDue: daysAhead(11),
      owner: "Leena D\u2019Souza",
      compliance: "due-soon",
      checklist: ["TDS in/out", "UV lamp hours", "Membrane output %", "Sanitize storage tank"],
      policyRef: "Water hygiene \xA71.2"
    },
    {
      id: "MP-05",
      title: "Fire pump churn test",
      assetIds: ["NOR-FP-01"],
      type: "compliance",
      frequency: "Weekly",
      intervalDays: 7,
      lastDone: daysAgo(5),
      nextDue: daysAhead(2),
      owner: "Manoj Patil",
      compliance: "on-track",
      checklist: ["Suction pressure", "Churn 3 min", "Jockey pump cut-in", "Panel lamps"],
      safetyNotes: ["Notify fire panel monitoring before test"],
      policyRef: "Fire safety code \xA74.1"
    },
    {
      id: "MP-06",
      title: "Pre-monsoon roof & drainage",
      assetIds: [],
      type: "seasonal",
      frequency: "Annual (May)",
      intervalDays: 365,
      lastDone: daysAgo(110),
      nextDue: daysAhead(255),
      owner: "Facilities desk",
      compliance: "on-track",
      checklist: ["Terrace drains", "Downpipe joints", "Seepage markers", "Sump pumps"]
    },
    {
      id: "MP-07",
      title: "Projector lamp & filter check",
      assetIds: ["NOR-PRJ-204"],
      type: "usage",
      frequency: "Half-yearly (600 lamp-hrs)",
      intervalDays: 180,
      lastDone: daysAgo(150),
      nextDue: daysAhead(30),
      owner: "Arif Shaikh",
      compliance: "on-track",
      checklist: ["Lamp hours log", "Intake filter clean", "Lens & focus", "Cable strain check"]
    },
    {
      id: "MP-08",
      title: "Bus fleet pre-route inspection sweep",
      assetIds: ["NOR-BSW-12"],
      type: "compliance",
      frequency: "Daily (4 weeks)",
      intervalDays: 1,
      lastDone: daysAgo(1),
      nextDue: daysAgo(0),
      owner: "Rajeev Nair",
      compliance: "due-soon",
      checklist: ["Coolant & oil", "Tyres & brakes", "Emergency exit", "First-aid & extinguisher"],
      policyRef: "Transport \xA73.1 (dec_4, 3 weeks remaining)"
    }
  ];
  var inspections = [
    { id: "IN-0211", planId: "MP-05", title: "Fire pump churn test \u2014 weekly", assetId: "NOR-FP-01", campus: "north", on: daysAhead(2), status: "scheduled", inspector: "Manoj Patil" },
    { id: "IN-0210", planId: "MP-02", title: "Lift monthly safety check", assetId: "NOR-EL-02", campus: "north", on: daysAhead(4), status: "scheduled", inspector: "Kone AMC vendor" },
    { id: "IN-0209", planId: "MP-03", title: "Generator quarterly inspection", assetId: "NOR-GEN-01", campus: "north", on: daysAgo(5), status: "scheduled", inspector: "Manoj Patil" },
    { id: "IN-0208", planId: "MP-04", title: "RO membrane & UV check", assetId: "CIT-WP-01", campus: "city", on: daysAgo(34), status: "completed", inspector: "Leena D\u2019Souza", result: "pass-with-notes", findings: [{ item: "TDS in/out", ok: true, note: "212 \u2192 18 ppm" }, { item: "UV lamp hours", ok: true }, { item: "Membrane output", ok: false, note: "78% \u2014 plan replacement next window" }] },
    { id: "IN-0207", title: "Playground equipment spot check", campus: "east", on: daysAgo(6), status: "completed", inspector: "Imran Qureshi", result: "fail", findings: [{ item: "Climbing frame bolts", ok: false, note: "1 loose \u2014 roped off" }, { item: "Surface impact pads", ok: true }] }
  ];
  var inventory = [
    { id: "inv_cap_01", name: "AC run capacitor 35\xB5F", category: "HVAC", unit: "pcs", stock: 4, threshold: 3, unitCost: 850, consumed30d: 5, consumptionTrend: [2, 3, 2, 4, 5], linkedCategories: ["HVAC"], store: "North store" },
    { id: "inv_gas_02", name: "R32 refrigerant (kit)", category: "HVAC", unit: "kit", stock: 2, threshold: 2, unitCost: 3100, consumed30d: 3, consumptionTrend: [1, 2, 1, 3, 3], linkedCategories: ["HVAC"], store: "North store", pendingRequests: [{ qty: 2, forWo: "WO-1042", on: daysAgo(0, 11, 20) }] },
    { id: "inv_filter_ac", name: "AC filter set (split)", category: "HVAC", unit: "set", stock: 9, threshold: 4, unitCost: 420, consumed30d: 6, consumptionTrend: [3, 4, 2, 6, 6], linkedCategories: ["HVAC"], store: "Central store" },
    { id: "inv_hose_02", name: "Radiator hose 22mm", category: "Power", unit: "pcs", stock: 3, threshold: 2, unitCost: 1450, consumed30d: 1, consumptionTrend: [0, 1, 0, 0, 1], linkedCategories: ["Power"], store: "Transport bay store" },
    { id: "inv_tube", name: "LED tube 4ft", category: "Electrical", unit: "pcs", stock: 22, threshold: 10, unitCost: 360, consumed30d: 14, consumptionTrend: [8, 10, 9, 12, 14], linkedCategories: ["Electrical"], store: "Central store" },
    { id: "inv_choke", name: "Electronic choke", category: "Electrical", unit: "pcs", stock: 6, threshold: 5, unitCost: 320, consumed30d: 4, consumptionTrend: [2, 3, 2, 4, 4], linkedCategories: ["Electrical"], store: "Central store" },
    { id: "inv_drain", name: "AC drain pipe 1m", category: "Plumbing", unit: "pcs", stock: 8, threshold: 4, unitCost: 120, consumed30d: 3, consumptionTrend: [1, 2, 1, 3, 3], linkedCategories: ["Plumbing", "HVAC"], store: "North store" },
    { id: "inv_lamp_prj", name: "Projector lamp ELPLP78", category: "AV", unit: "pcs", stock: 1, threshold: 1, unitCost: 7400, consumed30d: 0, consumptionTrend: [0, 0, 1, 0, 0], linkedCategories: ["AV"], store: "Central store" },
    { id: "inv_couple", name: "Water cooler coupling kit", category: "Plumbing", unit: "kit", stock: 2, threshold: 2, unitCost: 610, consumed30d: 2, consumptionTrend: [1, 1, 2, 2, 2], linkedCategories: ["Plumbing", "Water"], store: "North store" },
    { id: "inv_ro_mem", name: "RO membrane 500 LPH", category: "Water", unit: "pcs", stock: 1, threshold: 1, unitCost: 12800, consumed30d: 0, consumptionTrend: [0, 0, 0, 0, 0], linkedCategories: ["Water"], store: "Central store" }
  ];
  var vendors = [
    { id: "ven_kone", name: "Kone Elevator AMC", categories: ["Safety"], contractUntil: daysAhead(220), slaPct: 98, avgResponseMins: 45, jobsYTD: 11, spendYTD: 186e3, rating: 4.6, empanelled: true },
    { id: "ven_coolzone", name: "CoolZone HVAC Services", categories: ["HVAC"], contractUntil: daysAhead(90), slaPct: 91, avgResponseMins: 130, jobsYTD: 24, spendYTD: 148500, rating: 4.1, empanelled: true },
    { id: "ven_aquasure", name: "AquaSure Water Systems", categories: ["Water", "Plumbing"], contractUntil: daysAgo(20), slaPct: 84, avgResponseMins: 220, jobsYTD: 9, spendYTD: 61200, rating: 3.4, empanelled: false },
    { id: "ven_sparkwell", name: "SparkWell Electricals", categories: ["Electrical", "Power"], contractUntil: daysAhead(310), slaPct: 93, avgResponseMins: 95, jobsYTD: 31, spendYTD: 98400, rating: 4.3, empanelled: true },
    { id: "ven_safefirst", name: "SafeFirst Fire Systems", categories: ["Safety"], contractUntil: daysAhead(150), slaPct: 96, avgResponseMins: 60, jobsYTD: 14, spendYTD: 88200, rating: 4.5, empanelled: true }
  ];
  var woById = (id) => workOrders.find((w) => w.id === id);
  var assetById = (id) => assets.find((a) => a.id === id);
  var technicianByName = (n) => technicians.find((t) => t.name === n);
  var woSpend = (wo) => wo.partsUsed?.reduce((a, p) => a + p.cost, 0) ?? 0;
  var campusWorkOrders = (campus) => workOrders.filter((w) => campus === "all" || w.campus === campus);
  var openWorkOrders = (campus) => campusWorkOrders(campus).filter((w) => !["resolved", "closed", "cancelled"].includes(w.status));
  var slaState = (wo) => {
    const active = !["resolved", "closed", "cancelled"].includes(wo.status);
    const remaining = wo.sla.resolveBy.getTime() - NOW;
    const responseRemaining = wo.sla.responseBy.getTime() - NOW;
    if (!active) return { label: "Met", tone: "success", remaining: 0, breached: false };
    if (wo.respondedOn) {
      if (remaining <= 0) return { label: "Breached", tone: "danger", remaining, breached: true };
      if (remaining < 60 * 6e4) return { label: `${Math.round(remaining / 6e4)} min left`, tone: "danger", remaining, breached: false };
      if (remaining < 4 * 36e5) return { label: `${Math.round(remaining / 36e5)}h left`, tone: "warning", remaining, breached: false };
      return { label: `${Math.round(remaining / 36e5)}h left`, tone: "neutral", remaining, breached: false };
    }
    if (responseRemaining <= 0) return { label: "Response overdue", tone: "danger", remaining: responseRemaining, breached: true };
    return { label: `Respond in ${Math.max(1, Math.round(responseRemaining / 6e4))} min`, tone: responseRemaining < 15 * 6e4 ? "warning" : "neutral", remaining: responseRemaining, breached: false };
  };
  function recommendTechnicians(category, campus, limit = 3) {
    return technicians.filter((t) => campus === "all" || t.campus === campus).map((t) => {
      const skillMatch = t.skills.includes(category) || t.certifications.some((c) => c.toLowerCase().includes(category.toLowerCase()));
      const score = (skillMatch ? 0.45 : 0) + t.firstTimeFixRate * 0.3 + (1 - Math.min(t.currentJobs, 4) / 4) * 0.25;
      const why = [];
      why.push(skillMatch ? `${t.skills[0]}-trained${t.certifications[0] ? ` \xB7 ${t.certifications[0]}` : ""}` : "Nearest general skill set");
      why.push(`${t.currentJobs} active job${t.currentJobs === 1 ? "" : "s"}`);
      why.push(`${Math.round(t.firstTimeFixRate * 100)}% first-time fix on ${category.toLowerCase()} work`);
      return { tech: t, score, skillMatch, why };
    }).sort((a, b) => Number(b.skillMatch) - Number(a.skillMatch) || b.score - a.score).slice(0, limit);
  }
  function replacementView(a) {
    if (!a.expectedLifeYears) return null;
    const ageYears = (NOW - a.installedOn.getTime()) / (365.25 * 864e5);
    const repairRatio = a.repairSpendYTD / a.purchaseCost;
    const failureCount = a.failures.length;
    const trigger = repairRatio > 0.2 || ageYears > 0.75 * a.expectedLifeYears && failureCount >= 3;
    const estReplacement = Math.round(a.purchaseCost * (1 + 0.04) ** Math.min(ageYears, 10) / 1e3) * 1e3;
    return {
      ageYears: Number(ageYears.toFixed(1)),
      repairRatio,
      failureCount,
      estReplacement,
      trigger,
      verdict: trigger ? "Replacement evaluation recommended" : "Continue maintain-in-place",
      rationale: trigger ? `\u20B9${a.repairSpendYTD.toLocaleString("en-IN")} repair spend this year is ${Math.round(repairRatio * 100)}% of replacement cost, with ${failureCount} failures in the last 63\u201390 days.` : "Repair spend and failure rate remain within healthy bands for this asset class."
    };
  }
  var maintAnalytics = (campus) => {
    const wos = campusWorkOrders(campus);
    const resolved = wos.filter((w) => ["resolved", "closed"].includes(w.status));
    const breached = wos.filter((w) => w.slaBreached || ["resolved", "closed"].includes(w.status) && w.completedOn && w.completedOn.getTime() > w.sla.resolveBy.getTime());
    const openCount = openWorkOrders(campus).length;
    const emergency = openWorkOrders(campus).filter((w) => w.priority === "emergency" || w.priority === "critical").length;
    const avgResolutionHrs = resolved.length ? resolved.reduce((a, w) => a + ((w.completedOn?.getTime() ?? NOW) - w.reportedOn.getTime()) / 36e5, 0) / resolved.length : 0;
    const spend = wos.reduce((a, w) => a + woSpend(w), 0);
    const byBuilding = /* @__PURE__ */ new Map();
    wos.forEach((w) => byBuilding.set(`${w.campus} \xB7 ${w.building}`, (byBuilding.get(`${w.campus} \xB7 ${w.building}`) ?? 0) + woSpend(w) + (w.labourMins ?? 0) * 2));
    const pmTasks = maintPlans.length;
    const pmOverdue = maintPlans.filter((p) => p.compliance === "overdue").length;
    return {
      openCount,
      emergency,
      resolvedCount: resolved.length,
      slaPct: wos.length ? Math.round((wos.length - breached.length) / wos.length * 100) : 100,
      avgResolutionHrs,
      spend,
      byBuilding: [...byBuilding.entries()].map(([k, v]) => ({ building: k, spend: v })).sort((a, b) => b.spend - a.spend),
      pmTasks,
      pmOverdue,
      riskyAssets: assets.filter((a) => (campus === "all" || a.campus === campus) && (a.health < 65 || a.status === "down")).sort((a, b) => a.health - b.health)
    };
  };
  return __toCommonJS(maintenance_exports);
})();
