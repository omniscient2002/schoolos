var MOCK_SEED = (() => {
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

  // src/mock/seed.ts
  var seed_exports = {};
  __export(seed_exports, {
    DEMO_GUARDIAN: () => DEMO_GUARDIAN,
    DEMO_SECTION_ID: () => DEMO_SECTION_ID,
    DEMO_STUDENT: () => DEMO_STUDENT,
    FEE_STORY: () => FEE_STORY,
    SCHOOL: () => SCHOOL,
    TERM_DAYS: () => TERM_DAYS,
    actionItems: () => actionItems,
    aiUsage: () => aiUsage,
    attendance: () => attendance,
    attendanceMarkedToday: () => attendanceMarkedToday,
    auditEntries: () => auditEntries,
    busRoutes: () => busRoutes,
    calendarEvents: () => calendarEvents,
    campuses: () => campuses,
    cases: () => cases,
    decisions: () => decisions,
    documents: () => documents,
    feeObligations: () => feeObligations,
    findPerson: () => findPerson,
    guardianChat: () => guardianChat,
    guardianIdByStudent: () => guardianIdByStudent,
    guardianLinks: () => guardianLinks,
    guardians: () => guardians,
    guardiansOfStudent: () => guardiansOfStudent,
    healthIssues: () => healthIssues,
    healthScore: () => healthScore,
    incidents: () => incidents,
    insights: () => insights,
    leads: () => leads,
    meetings: () => meetings,
    memoryDocs: () => memoryDocs,
    models: () => models,
    notifications: () => notifications,
    obligations: () => obligations,
    payments: () => payments,
    peopleAll: () => peopleAll,
    policies: () => policies,
    sectionAttendanceToday: () => sectionAttendanceToday,
    sectionOfStudent: () => sectionOfStudent,
    sections: () => sections,
    staff: () => staff,
    studentAttendanceRate: () => studentAttendanceRate,
    studentFeeSummary: () => studentFeeSummary,
    students: () => students,
    studentsOfSection: () => studentsOfSection,
    teachers: () => teachers,
    timetable: () => timetable,
    workflowRuns: () => workflowRuns,
    workflows: () => workflows
  });

  // src/lib/rng.ts
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed);
    return {
      next: r,
      int(min, max) {
        return Math.floor(r() * (max - min + 1)) + min;
      },
      float(min, max) {
        return r() * (max - min) + min;
      },
      pick(arr) {
        return arr[Math.floor(r() * arr.length)];
      },
      picks(arr, n) {
        const copy = [...arr];
        const out = [];
        for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
        return out;
      },
      chance(p) {
        return r() < p;
      },
      /* Date offset in days from today, at given hour:minute */
      date(daysOffset2, hour = 9, minute = 0) {
        const d = /* @__PURE__ */ new Date();
        d.setDate(d.getDate() + daysOffset2);
        d.setHours(hour, minute, 0, 0);
        return d;
      },
      pastDays(daysBack, hour = 9, minute = 0) {
        return this.date(-daysOffset(daysBack), hour, minute);
      }
    };
  }
  function daysOffset(n) {
    return n;
  }

  // src/mock/seed.ts
  var SCHOOL = { name: "Meridian International Academy", short: "Meridian", established: 1998, board: "CBSE + IGCSE" };
  var rng = makeRng(20260904);
  var FIRST_M = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Reyansh", "Ishaan", "Kabir", "Anaya", "Rohan", "Dhruv", "Karan", "Aryan", "Nikhil", "Rahul", "Samar", "Yash", "Dev", "Ayaan", "Zayn", "Ridhaan", "Pranav", "Tanish", "Uday", "Advait", "Neel", "Sarthak", "Aryan", "Omkar", "Shaurya", "Liam", "Noah", "Ethan", "Leo", "Owen", "Rahim", "Farhan", "Imran", "Sameer", "Vikram", "Manav", "Kunal", "Yusuf", "Rehan", "Arnav", "Aryan", "Aryan"].filter((v, i, a) => a.indexOf(v) === i);
  var FIRST_F = ["Aanya", "Diya", "Aadhya", "Saanvi", "Myra", "Anika", "Ira", "Kiara", "Aisha", "Zara", "Meera", "Navya", "Prisha", "Riya", "Tara", "Siya", "Anvi", "Charvi", "Ishita", "Kavya", "Mira", "Naina", "Pari", "Sara", "Tanvi", "Urvi", "Vaani", "Amara", "Layla", "Noor", "Aisha", "Fatima", "Hana", "Inaya", "Jiya", "Kiran", "Leela", "Mahi", "Nitya", "Oviya", "Rhea", "Sia", "Trisha", "Zoya"].filter((v, i, a) => a.indexOf(v) === i);
  var LAST = ["Sharma", "Verma", "Patel", "Iyer", "Reddy", "Khan", "Gupta", "Mehta", "Singh", "Nair", "Joshi", "Rao", "Malhotra", "Kapoor", "Chopra", "Das", "Bose", "Menon", "Pillai", "Agarwal", "Bansal", "Saxena", "Trivedi", "Kulkarni", "Deshpande", "Bhatt", "Shah", "Jain", "Kaur", "Gill", "Fernandes", "D Souza", "Ansari", "Sheikh", "Qureshi", "Bose", "Sengupta", "Mukherjee", "Banerjee", "Chatterjee"];
  var FIRST_T_M = ["Rajesh", "Sanjay", "Arun", "Vikas", "Naveen", "Suresh", "Prakash", "Amit", "Rahul", "Deepak", "Manoj", "Anil", "Harish", "Kiran", "Mohan", "Ravi", "Tarun", "Yogesh"];
  var FIRST_T_F = ["Priya", "Sunita", "Anita", "Kavita", "Deepa", "Meenakshi", "Shalini", "Ritu", "Neha", "Pooja", "Archana", "Lakshmi", "Divya", "Rekha", "Swati", "Nandini", "Sarita", "Vaishali"];
  var TEACHER_LAST = ["Sharma", "Iyer", "Menon", "Krishnan", "Bhat", "Rao", "Kulkarni", "Nair", "Deshmukh", "Chandra", "Verma", "Reddy", "Pillai", "Joshi", "Saxena", "Kaul", "Sinha", "Mishra"];
  var SUBJECTS = ["Mathematics", "Science", "English", "Social Studies", "Hindi", "Computer Science", "Art", "Physical Education", "Physics", "Chemistry", "Biology", "History", "Geography"];
  var GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  var SECTION_NAMES = ["A", "B", "C"];
  var campuses = [
    { id: "north", name: "North Campus", shortName: "North", students: 228, capacity: 260, hue: "var(--campus-a)" },
    { id: "city", name: "City Campus", shortName: "City", students: 176, capacity: 210, hue: "var(--campus-b)" },
    { id: "east", name: "East Campus", shortName: "East", students: 132, capacity: 190, hue: "var(--campus-c)" }
  ];
  var today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  var daysAgo = (n, h = 9, m = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    d.setHours(h, m, 0, 0);
    return d;
  };
  var daysAhead = (n, h = 9, m = 0) => daysAgo(-n, h, m);
  function schoolDays(n) {
    const out = [];
    const d = new Date(today);
    while (out.length < n) {
      const dow = d.getDay();
      if (dow !== 0) out.push(new Date(d));
      d.setDate(d.getDate() - 1);
    }
    return out.reverse();
  }
  var TERM_DAYS = schoolDays(30);
  function personName(type, i) {
    if (type === "student") {
      const first2 = i % 2 === 0 ? rng.pick(FIRST_M) : rng.pick(FIRST_F);
      return `${first2} ${rng.pick(LAST)}`;
    }
    const first = rng.chance(0.55) ? rng.pick(FIRST_T_F) : rng.pick(FIRST_T_M);
    return `${first} ${rng.pick(TEACHER_LAST)}`;
  }
  var students = [];
  var teachers = [];
  var staff = [];
  var guardians = [];
  var guardianLinks = [];
  var sections = [];
  var timetable = [];
  var sid = 1;
  var gid = 1;
  var tid = 1;
  var stid = 1;
  var SECTION_PLAN = {
    north: [{ grade: 1, count: 1 }, { grade: 2, count: 1 }, { grade: 3, count: 1 }, { grade: 4, count: 1 }, { grade: 5, count: 1 }, { grade: 6, count: 1 }, { grade: 7, count: 2 }, { grade: 8, count: 2 }, { grade: 9, count: 2 }, { grade: 10, count: 2 }],
    city: [{ grade: 1, count: 1 }, { grade: 2, count: 1 }, { grade: 3, count: 1 }, { grade: 4, count: 1 }, { grade: 5, count: 1 }, { grade: 6, count: 1 }, { grade: 7, count: 2 }, { grade: 8, count: 2 }, { grade: 9, count: 2 }, { grade: 10, count: 2 }],
    east: [{ grade: 1, count: 1 }, { grade: 2, count: 1 }, { grade: 3, count: 1 }, { grade: 4, count: 1 }, { grade: 5, count: 1 }, { grade: 6, count: 1 }, { grade: 7, count: 1 }, { grade: 8, count: 1 }, { grade: 9, count: 1 }, { grade: 10, count: 1 }]
  };
  var DEMO_CLASS_SIZE = 26;
  campuses.forEach((campus) => {
    const plan = SECTION_PLAN[campus.id];
    const nSections = plan.reduce((a, p) => a + p.count, 0);
    const base = Math.floor(campus.students / nSections);
    let remainder = campus.students - base * nSections;
    const sizes = plan.flatMap((p) => Array.from({ length: p.count }, () => ({ grade: p.grade, size: base + (remainder-- > 0 ? 1 : 0) })));
    if (campus.id === "north") {
      const g8 = sizes.filter((x) => x.grade === 8);
      const bIdx = sizes.findIndex((x) => x.grade === 8 && x === g8[1]);
      const delta = DEMO_CLASS_SIZE - sizes[bIdx].size;
      sizes[bIdx].size = DEMO_CLASS_SIZE;
      let left = delta;
      for (const sz of sizes) {
        if (left <= 0) break;
        if (sz !== sizes[bIdx] && sz.size > 12) {
          const take = Math.min(left, sz.size - 12);
          sz.size -= take;
          left -= take;
        }
      }
    }
    const byGrade = /* @__PURE__ */ new Map();
    sizes.forEach((sz) => {
      const arr = byGrade.get(sz.grade) ?? [];
      arr.push(sz);
      byGrade.set(sz.grade, arr);
    });
    byGrade.forEach((arr) => arr.forEach((sz) => void (sz.size = sz.size)));
    plan.forEach((p) => {
      const arr = byGrade.get(p.grade);
      for (let secIdx = 0; secIdx < p.count; secIdx++) {
        const secName = SECTION_NAMES[secIdx];
        const secId = `${campus.id}-g${p.grade}-${secName.toLowerCase()}`;
        const size = arr[secIdx].size;
        sections.push({ id: secId, grade: p.grade, name: secName, campus: campus.id, classTeacherId: "", room: `${p.grade}${secName} \xB7 Fl ${1 + p.grade % 3}`, studentCount: size });
        for (let i = 0; i < size; i++) {
          const name = personName("student", sid + i);
          const id = `st_${campus.id}_${sid++}`;
          students.push({
            id,
            name,
            type: "student",
            campus: campus.id,
            email: `${id.replace("_", ".")}@student.meridian.edu`,
            phone: `+91 98${rng.int(1e8, 999999999)}`,
            grade: p.grade,
            section: secName,
            rollNo: String(i + 1).padStart(2, "0"),
            status: "active",
            admissionNo: `MIA-${2018 + p.grade % 7}-${String(1e3 + sid).slice(1)}`,
            dob: `${2012 + (10 - p.grade)}-0${rng.int(1, 9)}-1${rng.int(0, 9)}`
          });
        }
      }
    });
  });
  var allSections = [...sections];
  allSections.forEach((sec, i) => {
    const name = personName("adult", i);
    const id = `tf_${tid++}`;
    const teacher = {
      id,
      name,
      type: "teacher",
      campus: sec.campus,
      email: `${name.toLowerCase().replace(" ", ".")}@meridian.edu`,
      phone: `+91 97${rng.int(1e8, 999999999)}`,
      role: "Class Teacher",
      subjects: rng.picks(SUBJECTS, 2),
      classes: [`${sec.grade}-${sec.name}`],
      joinedOn: fmt(rng.int(2, 12))
    };
    teachers.push(teacher);
    sec.classTeacherId = id;
  });
  for (let i = teachers.length; i < 52; i++) {
    const campus = campuses[i % 3];
    const name = personName("adult", i);
    const id = `tf_${tid++}`;
    teachers.push({
      id,
      name,
      type: "teacher",
      campus: campus.id,
      email: `${name.toLowerCase().replace(" ", ".")}@meridian.edu`,
      phone: `+91 97${rng.int(1e8, 999999999)}`,
      role: rng.pick(["Subject Teacher", "Subject Teacher", "Coordinator", "HOD \u2014 Science", "HOD \u2014 Mathematics", "Counselor"]),
      subjects: rng.picks(SUBJECTS, rng.int(1, 3)),
      classes: [`${rng.pick(GRADES)}-${rng.pick(SECTION_NAMES)}`],
      joinedOn: fmt(rng.int(1, 14))
    });
  }
  var STAFF_ROLES = ["Accounts Executive", "Front Office", "Lab Assistant", "Librarian", "Nurse", "Transport Supervisor", "Admin Officer", "IT Support", "Sports Coach", "HR Executive"];
  for (let i = 0; i < 20; i++) {
    const campus = campuses[i % 3];
    const name = personName("adult", i + 7);
    const id = `stf_${stid++}`;
    staff.push({ id, name, type: "staff", campus: campus.id, email: `${name.toLowerCase().replace(" ", ".")}@meridian.edu`, phone: `+91 96${rng.int(1e8, 999999999)}`, role: STAFF_ROLES[i % STAFF_ROLES.length], joinedOn: fmt(rng.int(1, 10)) });
  }
  function fmt(years) {
    const d = daysAgo(rng.int(200, 360 * years));
    return d.toISOString().slice(0, 10);
  }
  var guardianIdsByStudent = /* @__PURE__ */ new Map();
  students.forEach((st) => {
    const n = rng.chance(0.65) ? 1 : 2;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const relation = i === 0 ? rng.chance(0.6) ? "Mother" : "Father" : rng.pick(["Father", "Mother", "Grandmother", "Guardian"]);
      const gName = relation.startsWith("M") && rng.chance(0.7) ? `${rng.pick(FIRST_F)} ${st.name.split(" ").pop()}` : `${rng.pick(FIRST_M)} ${st.name.split(" ").pop()}`;
      const id = `gd_${gid++}`;
      guardians.push({
        id,
        name: gName,
        type: "guardian",
        campus: st.campus,
        email: `${id.replace("_", ".")}@gmail.com`,
        phone: `+91 9${rng.int(6e8, 999999999)}`,
        role: relation,
        status: "active"
      });
      ids.push(id);
      guardianLinks.push({ guardianId: id, studentId: st.id, relation, primary: i === 0, pickupAuthorized: i === 0 || rng.chance(0.4), verified: rng.chance(0.86) });
    }
    guardianIdsByStudent.set(st.id, ids);
  });
  var guardianIdByStudent = guardianIdsByStudent;
  var PERIODS = ["08:00", "08:50", "09:40", "10:50", "11:40", "12:30"];
  allSections.forEach((sec) => {
    for (let day = 1; day <= 6; day++) {
      PERIODS.forEach((start, p) => {
        const subject = SUBJECTS[(day * 3 + p) % SUBJECTS.length];
        const t = teachers.find((x) => x.campus === sec.campus && x.subjects?.includes(subject)) ?? teachers.find((x) => x.campus === sec.campus);
        timetable.push({ id: `tt_${sec.id}_${day}_${p}`, day, period: p + 1, start, end: nextSlot(start), subject, teacherId: t.id, sectionId: sec.id, room: sec.room });
      });
    }
  });
  function nextSlot(start) {
    const [h, m] = start.split(":").map(Number);
    const nm = m + 50;
    return `${String(nm >= 60 ? h + 1 : h).padStart(2, "0")}:${String(nm % 60).padStart(2, "0")}`;
  }
  var busRoutes = [];
  var ROUTE_NAMES = ["Route 1 \u2014 Sector 4", "Route 2 \u2014 Sector 9", "Route 3 \u2014 Old Town", "Route 4 \u2014 Green Park", "Route 5 \u2014 Lake View", "Route 6 \u2014 Station Road", "Route 7 \u2014 Sector 12", "Route 8 \u2014 Hill Road", "Route 9 \u2014 Market", "Route 10 \u2014 Riverside"];
  ROUTE_NAMES.forEach((name, i) => {
    const campus = campuses[i % 3];
    const isR7 = name.startsWith("Route 7");
    busRoutes.push({
      id: `route_${i + 1}`,
      name,
      campus: campus.id,
      driver: `${rng.pick(FIRST_T_M)} ${rng.pick(TEACHER_LAST)}`,
      vehicle: `MH ${["01", "02", "03"][i % 3]} AB ${1e3 + i * 37}`,
      capacity: 45,
      students: isR7 ? 38 : rng.int(18, 42),
      stops: Array.from({ length: 6 }, (_, s) => ({ name: `${name.split("\u2014")[1]?.trim()} Stop ${s + 1}`, time: `07:${String(10 + s * 7).padStart(2, "0")}`, students: rng.int(2, 9) })),
      status: isR7 ? "delayed" : rng.chance(0.15) ? "maintenance" : "on-time",
      delayMins: isR7 ? 13 : void 0
    });
  });
  var r7 = busRoutes.find((r) => r.id === "route_7");
  var demoClass = studentsOfSection("north-g8-b");
  var R7_DEMO_INDICES = [0, 2, 3, 5, 7, 8, 10, 12, 14, 16, 18, 19, 21, 23, 25];
  R7_DEMO_INDICES.forEach((i) => {
    if (demoClass[i]) demoClass[i].busRoute = r7.name;
  });
  var otherNorth = students.filter((st) => st.campus === "north" && !st.busRoute);
  otherNorth.slice(0, 38 - R7_DEMO_INDICES.length).forEach((st) => {
    st.busRoute = r7.name;
  });
  var r7Riders = students.filter((st) => st.busRoute === r7.name);
  var attendance = [];
  var attRng = makeRng(7788);
  var todayTs = TERM_DAYS[TERM_DAYS.length - 1].getTime();
  var demoRoster = demoClass;
  var demoChildId = demoRoster[3]?.id;
  var r7InDemo = new Set(r7Riders.filter((st) => st.campus === "north" && st.grade === 8 && st.section === "B").map((st) => st.id));
  TERM_DAYS.forEach((day) => {
    const isToday = day.getTime() === todayTs;
    allSections.forEach((sec) => {
      const roster = studentsOfSection(sec.id);
      roster.forEach((st) => {
        let status = "present";
        let note;
        if (sec.id === "north-g8-b" && isToday) {
          const idx = demoRoster.indexOf(st);
          if (r7InDemo.has(st.id)) {
            status = "absent";
            note = "Bus 14 \u2014 Route 7 delayed";
          } else if ([1, 4, 6, 9, 11].includes(idx)) {
            status = "absent";
            note = idx === 1 ? "Fever" : "Not reported";
          } else status = "present";
        } else {
          if (st.id === demoChildId) {
            status = "present";
          } else {
            const r = attRng.next();
            if (r < 0.045) {
              status = "absent";
              note = attRng.chance(0.4) ? rng.pick(["Fever", "Family function", "Not reported", "Travel"]) : void 0;
            } else if (r < 0.07) status = "late";
            else if (r < 0.08) status = "excused";
          }
        }
        attendance.push({ id: `att_${st.id}_${day.getTime()}`, studentId: st.id, sectionId: sec.id, date: day, status, markedBy: sec.classTeacherId, note });
      });
    });
  });
  var attendanceMarkedToday = () => {
    const t = TERM_DAYS[TERM_DAYS.length - 1];
    return attendance.filter((a) => a.date.getTime() === t.getTime());
  };
  var feeObligations = [];
  var payments = [];
  var feeRng = makeRng(4242);
  var TERMS = ["Term 1 2026-27", "Term 2 2026-27"];
  var riderLastNames = new Set(r7Riders.map((st) => st.name.split(" ").pop()));
  var householdSiblings = [];
  for (const st of students) {
    if (st.busRoute === r7.name || st.campus !== "north") continue;
    if (riderLastNames.has(st.name.split(" ").pop()) && !householdSiblings.includes(st.id)) householdSiblings.push(st.id);
    if (householdSiblings.length >= 3) break;
  }
  var failedSet = new Set(r7Riders.map((st) => st.id));
  householdSiblings.forEach((id) => failedSet.add(id));
  var feeShuffle = feeRng.picks(students.map((st) => st.id).filter((id) => !failedSet.has(id)), students.length);
  var otherFailed = feeShuffle.slice(0, Math.max(0, 47 - failedSet.size));
  otherFailed.forEach((id) => failedSet.add(id));
  var t2Order = feeShuffle.filter((id) => !failedSet.has(id));
  var paidSet = new Set(t2Order.slice(0, 441));
  var overdueSet = new Set(t2Order.slice(441, 471));
  students.forEach((st) => {
    TERMS.forEach((term, ti) => {
      const tuition = [42e3, 46e3, 51e3, 56e3][Math.min(3, Math.floor((st.grade ?? 1) / 3))];
      const transport = st.busRoute ? 8e3 : 0;
      const total = tuition + transport + 4500;
      const dueDate = ti === 0 ? daysAgo(45) : daysAhead(12);
      let status;
      let paidAmount = 0;
      let paidOn;
      let method;
      let failureReason;
      if (ti === 0) {
        const r = feeRng.next();
        if (r < 0.86) {
          status = "paid";
          paidAmount = total;
          paidOn = new Date(dueDate.getTime() + feeRng.int(0, 9) * 864e5);
          method = feeRng.pick(["UPI", "Net Banking", "Card", "Cheque"]);
        } else if (r < 0.93) {
          status = "overdue";
        } else {
          status = "waived";
        }
      } else if (failedSet.has(st.id)) {
        status = "failed";
        failureReason = st.busRoute === r7.name ? "UPI timeout" : feeRng.pick(["Insufficient funds", "UPI timeout", "Bank declined"]);
      } else if (paidSet.has(st.id)) {
        status = "paid";
        paidAmount = total;
        paidOn = daysAgo(feeRng.int(1, 20));
        method = feeRng.pick(["UPI", "Net Banking", "Card"]);
      } else if (overdueSet.has(st.id)) {
        status = "overdue";
      } else {
        status = "due";
      }
      feeObligations.push({ id: `fee_${st.id}_${ti}`, studentId: st.id, term, category: transport ? "Tuition + Transport" : "Tuition", amount: total, dueDate, status, paidAmount, paidOn, method, failureReason, concession: feeRng.chance(0.05) ? Math.round(total * 0.1) : 0 });
      if (status === "paid" && paidOn) {
        payments.push({ id: `pay_${st.id}_${ti}`, studentId: st.id, obligationId: `fee_${st.id}_${ti}`, amount: total, on: paidOn, method: method ?? "UPI", status: "success", reference: `MER${feeRng.int(1e5, 999999)}` });
      }
      if (status === "failed") {
        payments.push({ id: `payf_${st.id}_${ti}`, studentId: st.id, obligationId: `fee_${st.id}_${ti}`, amount: total, on: daysAgo(feeRng.int(1, 5), 10, feeRng.int(0, 50)), method: "UPI", status: "failed", reference: `MERF${feeRng.int(1e5, 999999)}` });
      }
    });
  });
  var FEE_STORY = { clusterRoute: "Route 7 \u2014 North", dipPct: 4.7, failedCount: 47 };
  var leads = [];
  var LEAD_STAGES = ["inquiry", "inquiry", "inquiry", "contacted", "contacted", "visit", "visit", "interview", "offer", "accepted", "enrolled", "rejected", "withdrawn"];
  var SOURCES = ["Website", "Referral \u2014 Parent", "Walk-in", "Google Ads", "School Exhibition", "Sibling", "Facebook"];
  for (let i = 0; i < 68; i++) {
    const campus = campuses[Math.floor(rng.next() * 3)];
    const name = personName("student", i);
    leads.push({
      id: `lead_${i + 1}`,
      name,
      grade: rng.pick(GRADES),
      campus: campus.id,
      stage: rng.pick(LEAD_STAGES),
      source: rng.pick(SOURCES),
      guardian: `${rng.pick(FIRST_M)} ${name.split(" ").pop()}`,
      phone: `+91 9${rng.int(1e8, 999999999)}`,
      createdOn: daysAgo(rng.int(1, 75)),
      lastTouch: daysAgo(rng.int(0, 12)),
      value: [42e3, 46e3, 51e3, 56e3][Math.min(3, Math.floor(rng.pick(GRADES) / 3))],
      owner: rng.pick(teachers).name,
      note: rng.chance(0.3) ? rng.pick(["Interested in transport from Sector 12", "Asked about IGCSE stream", "Sibling of current 5-A student", "Wants campus tour on Saturday", "Needs scholarship info"]) : void 0
    });
  }
  function studentFeeSummary(studentId) {
    const items = feeObligations.filter((f) => f.studentId === studentId);
    const due = items.filter((f) => f.status === "due" || f.status === "overdue").reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const overdue = items.filter((f) => f.status === "overdue").reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const paid = items.filter((f) => f.status === "paid").reduce((a, f) => a + f.paidAmount, 0);
    return { items, due, overdue, paid, hasFailed: items.some((f) => f.status === "failed") };
  }
  function studentAttendanceRate(studentId, lastN = 30) {
    const days = TERM_DAYS.slice(-lastN);
    const recs = attendance.filter((a) => a.studentId === studentId && days.some((d) => d.getTime() === a.date.getTime()));
    const absent = recs.filter((r) => r.status === "absent").length;
    const late = recs.filter((r) => r.status === "late").length;
    const excused = recs.filter((r) => r.status === "excused").length;
    const rate = Math.round((lastN - absent - late) / lastN * 1e3) / 10;
    return { rate, absent, late, excused, series: days.map((d) => {
      const r = recs.find((x) => x.date.getTime() === d.getTime());
      return r ? r.status === "present" ? 1 : 0 : 1;
    }) };
  }
  function sectionAttendanceToday(sectionId) {
    const t = TERM_DAYS[TERM_DAYS.length - 1];
    const recs = attendance.filter((a) => a.sectionId === sectionId && a.date.getTime() === t.getTime());
    const total = students.filter((s) => sections.find((x) => x.id === sectionId)?.campus === s.campus && s.grade === sections.find((x) => x.id === sectionId)?.grade && s.section === sections.find((x) => x.id === sectionId)?.name).length;
    const absent = recs.filter((r) => r.status === "absent").length;
    const late = recs.filter((r) => r.status === "late").length;
    return { total, absent, late, pct: total ? Math.round((total - absent) / total * 100) : 0, unmarked: Math.max(0, total - recs.length) };
  }
  var demoSec = sections.find((x) => x.id === "north-g8-b");
  var demoTeacher = teachers.find((t) => t.id === demoSec.classTeacherId);
  if (demoTeacher) {
    demoTeacher.name = "Priya Iyer";
    demoTeacher.email = "priya.iyer@meridian.edu";
    demoTeacher.subjects = ["Mathematics"];
    demoTeacher.role = "Class Teacher";
  }
  var DEMO_STUDENT = studentsOfSection("north-g8-b")[3] ?? students[0];
  DEMO_STUDENT.name = "Aarav Sharma";
  DEMO_STUDENT.busRoute = "Route 7 \u2014 Sector 12";
  var demoGuardianPair = guardiansOfStudent(DEMO_STUDENT.id).find((g) => g.link.primary);
  if (demoGuardianPair) {
    demoGuardianPair.guardian.name = "Kavita Sharma";
    demoGuardianPair.guardian.email = "kavita.s@gmail.com";
    demoGuardianPair.guardian.role = "Mother";
    demoGuardianPair.link.relation = "Mother";
    demoGuardianPair.link.verified = true;
    demoGuardianPair.link.pickupAuthorized = true;
  }
  var DEMO_GUARDIAN = demoGuardianPair?.guardian;
  var DEMO_SECTION_ID = "north-g8-b";
  var documents = [];
  var DOC_TITLES = ["Birth Certificate", "Aadhaar Copy", "Transfer Certificate", "Vaccination Record", "Transport Agreement", "Medical Form", "Parent ID Proof", "Address Proof"];
  students.slice(0, 140).forEach((st) => {
    const title = rng.pick(DOC_TITLES);
    const exp = rng.chance(0.25) ? daysAhead(rng.int(-20, 40)) : void 0;
    documents.push({ id: `doc_${st.id}_${rng.int(1, 999)}`, ownerType: "student", ownerId: st.id, ownerName: st.name, title, category: rng.pick(["Identity", "Medical", "Academic", "Transport"]), expiresOn: exp, status: exp ? exp.getTime() < today.getTime() ? "expired" : exp.getTime() < today.getTime() + 30 * 864e5 ? "expiring" : "valid" : "valid", size: `${rng.int(80, 4200)} KB` });
  });
  ["Fire Safety Certificate", "Building OC", "Bus Fitness Certificates", "Lab Chemical License"].forEach((t, i) => documents.push({ id: `doc_school_${i}`, ownerType: "school", ownerId: "school", ownerName: SCHOOL.name, title: t, category: "Compliance", expiresOn: daysAhead(rng.int(5, 90)), status: "expiring", size: `${rng.int(200, 900)} KB` }));
  var incidents = [
    { id: "inc_1", title: "Bus 14 breakdown \u2014 Sector 12 bridge", kind: "transport", severity: "high", status: "resolved", openedOn: daysAgo(2, 7, 42), owner: "Transport Supervisor", campus: "north", summary: "Coolant leak on Route 7 vehicle; 38 students transferred to spare bus with 22-min delay.", timeline: [{ on: daysAgo(2, 7, 42), actor: "GPS Monitor (auto)", note: "Vehicle stationary 14 min past expected window" }, { on: daysAgo(2, 7, 51), actor: "Transport Supervisor", note: "Driver confirmed coolant leak; spare bus MH03 AB 1048 dispatched" }, { on: daysAgo(2, 8, 5), actor: "SchoolOS (policy)", note: "Guardian delay notifications queued for 38 students \u2014 Route 7" }, { on: daysAgo(2, 8, 30), actor: "Principal", note: "Approved guardian message + requested maintenance quote" }, { on: daysAgo(2, 9, 10), actor: "Transport Supervisor", note: "All students reached campus; spare bus returned" }, { on: daysAgo(1, 17, 0), actor: "Principal", note: "Reviewed: resolved. Workshop quote received; repair scheduled Sat." }] },
    { id: "inc_2", title: "Repeated lab period clashes \u2014 Grade 10", kind: "other", severity: "medium", status: "triaged", openedOn: daysAgo(4), owner: "Academic Coordinator", campus: "city", summary: "Chemistry lab double-booked Tuesdays for 10-A and 10-C; timetable engine flagged 6 clashes.", timeline: [{ on: daysAgo(4), actor: "Timetable engine", note: "6 conflicts detected in weekly check" }] },
    { id: "inc_3", title: "Payment gateway timeouts \u2014 Term 2 receipts", kind: "payment", severity: "medium", status: "in-progress", openedOn: daysAgo(1, 11, 20), owner: "Accounts Executive", campus: "city", summary: "UPI provider reported intermittent timeouts 11:00\u201311:40; 23 payments queued for retry.", timeline: [{ on: daysAgo(1, 11, 20), actor: "Reconciliation worker", note: "23 gateway successes missing fee-ledger entries" }] },
    { id: "inc_4", title: "Water leakage \u2014 East wing corridor", kind: "facilities", severity: "low", status: "assigned", openedOn: daysAgo(3), owner: "Admin Officer", campus: "east", summary: "Seepage near library corridor; plumbing vendor scheduled Friday.", timeline: [{ on: daysAgo(3), actor: "Housekeeping", note: "Reported via QR code scan" }] },
    { id: "inc_5", title: "Playground minor injury \u2014 Grade 4", kind: "student", severity: "low", status: "reviewed", openedOn: daysAgo(6), owner: "School Nurse", campus: "east", summary: "Scraped knee during break; first aid given; guardian informed by phone + WhatsApp.", timeline: [{ on: daysAgo(6, 10, 15), actor: "Duty Teacher", note: "First aid administered" }, { on: daysAgo(6, 10, 25), actor: "School Nurse", note: "Guardian informed \u2014 acknowledged" }] }
  ];
  var cases = [
    { id: "case_1", kind: "complaint", title: "Bus 14 \u2014 repeated delays this week", openedOn: daysAgo(2, 8, 15), openedBy: "guardian", origin: "parent-whatsapp", owner: "Transport Supervisor", priority: "high", slaHours: 24, status: "in-progress", campus: "north", messages: [{ on: daysAgo(2, 8, 15), from: "Kavita Sharma (guardian, 8-B)", text: "Bus 14 was 20 minutes late again today. This is the third time this week. Please check." }, { on: daysAgo(2, 8, 40), from: "SchoolOS (auto)", text: "Case opened \xB7 SLA 24h \xB7 linked to transport incident inc_1", internal: true }], linkedRecords: [{ label: "Bus 14 \u2014 Route 7", ref: "/transport" }, { label: "Attendance 8-B", ref: "/attendance" }] },
    { id: "case_2", kind: "request", title: "Fee installment change \u2014 Term 2", openedOn: daysAgo(3), openedBy: "guardian", origin: "parent-whatsapp", owner: "Accounts Executive", priority: "normal", slaHours: 48, status: "open", campus: "city", messages: [{ on: daysAgo(3), from: "Rajesh Verma (guardian, 6-A)", text: "Can I pay Term 2 in two parts? Salary cycle changed this month." }], linkedRecords: [{ label: "Fee ledger \u2014 Term 2", ref: "/fees" }] },
    { id: "case_3", kind: "reconciliation", title: "23 gateway successes missing ledger entries", openedOn: daysAgo(1, 11, 25), openedBy: "system", origin: "system", owner: "Accounts Executive", priority: "high", slaHours: 12, status: "triaged", campus: "city", messages: [{ on: daysAgo(1, 11, 25), from: "Reconciliation worker", text: "Payment gateway reported 23 successful UPI transactions between 11:00\u201311:40 that are not in the fee ledger. Suggested action: import settlement file and re-match.", internal: true }] },
    { id: "case_4", kind: "transport", title: "Pickup point change request \u2014 Sector 12 Stop 3", openedOn: daysAgo(5), openedBy: "guardian", origin: "parent-whatsapp", owner: "Transport Supervisor", priority: "normal", slaHours: 72, status: "resolved", campus: "north", messages: [{ on: daysAgo(5), from: "Sunita Rao (guardian, 3-B)", text: "We have moved houses. Please change pickup to Sector 12 Stop 3." }, { on: daysAgo(2), from: "Transport Supervisor", text: "Change effective from Monday. Route sheet updated." }] },
    { id: "case_5", kind: "compliance", title: "Fire safety certificate renewal \u2014 North", openedOn: daysAgo(9), openedBy: "system", origin: "system", owner: "Admin Officer", priority: "high", slaHours: 240, status: "in-progress", campus: "north", messages: [{ on: daysAgo(9), from: "Obligation monitor", text: "Fire Safety Certificate expires in 21 days. Vendor quote requested.", internal: true }] }
  ];
  var actionItems = [
    { id: "act_1", kind: "recommendation", title: "Grade 8-B attendance dropped to 23% today", detail: "Only 6 of 26 students present; 15 of the 20 absentees ride Bus 14 (Route 7). Presence is 4\xD7 below the school baseline of 92%.", why: "Sudden cluster suggests transport, not illness. Unaddressed, this distorts today\u2019s registers and worries parents.", priority: "critical", owner: "You (Principal)", deadline: daysAhead(0, 12, 0), evidence: [{ label: "8-B attendance trend (10 days)", data: [81, 85, 92, 100, 92, 92, 96, 96, 100, 23], detail: "Today: 23% present vs 93% 10-day average", ref: "/attendance" }, { label: "Bus 14 \u2014 Route 7 status", detail: "Delayed 13 min \xB7 38 students \xB7 breakdown reported 07:42", ref: "/transport" }, { label: "Guardian complaints", detail: "2 new WhatsApp messages about Bus 14 this morning" }], actions: [{ label: "Send reassurance message to 8-B parents", type: "message", audience: "Grade 8-B guardians", audienceCount: 24, channel: "WhatsApp", posture: "APPROVAL", draft: "Dear Parents, we are aware that Bus 14 is delayed today due to a mechanical issue near Sector 12. A spare bus has been arranged and students are being picked up. Ms. Kavita Iyer (Class Teacher, 8-B) will mark attendance leniently until 9:30 and share updates here. \u2014 Meridian Academy" }, { label: "Open transport incident", type: "investigate", detail: "Link Bus 14 breakdown to this attendance dip and assign Transport Supervisor." }, { label: "Ask coordinator to call the non-transport absent households", type: "task", detail: "Creates a task for the Admin Office with student list and numbers." }], status: "open", on: daysAgo(0, 7, 55), aiInvolved: true },
    { id: "act_2", kind: "approval", title: "Fee concession \u2014 12.5% sibling waiver (verify policy)", detail: "Admissions Counselor approved sibling discount for Dhruv Khanna (2-A); policy caps sibling waiver at 10%. Needs your confirmation to override.", why: "Exceeds the fee policy cap in the School Constitution. Approving sets precedent for sibling case.", priority: "high", owner: "You (Principal)", deadline: daysAhead(1, 17, 0), evidence: [{ label: "Policy \u2014 Fees \xA74.2", detail: "\u201CSibling waiver: maximum 10% of tuition.\u201D", ref: "/constitution" }, { label: "Fee record \u2014 Dhruv Khanna", detail: "Term 2 tuition \u20B946,000 \xB7 proposed concession \u20B95,750 (12.5%)", ref: "/fees" }], actions: [{ label: "Approve 10% cap concession instead", type: "workflow", detail: "Applies policy-compliant 10% and notifies accounts." }, { label: "Approve 12.5% as exception", type: "workflow", detail: "Records exception with your reason; audits the override." }, { label: "Reject and ask for resubmission", type: "task" }], status: "open", on: daysAgo(0, 8, 30), aiInvolved: false },
    { id: "act_3", kind: "approval", title: "Substitute needed \u2014 Ms. Sarita Mishra (7-A) on leave", detail: "Approved leave for tomorrow (2 days). 5 periods affected across 7-A, 8-B. Substitute candidates ranked by free periods and subject match.", why: "Uncovered classes tomorrow morning; parents notice quickly when registers are disrupted.", priority: "high", owner: "Academic Coordinator", deadline: daysAhead(0, 16, 0), evidence: [{ label: "Leave request", detail: "Family function \xB7 approved per HR policy \xA72.1", ref: "/operations/hr" }, { label: "Candidates", detail: "Mr. Naveen Kaul (3 free periods, Mathematics) \xB7 Ms. Swati Rao (4 free periods, Science)" }], actions: [{ label: "Assign Mr. Naveen Kaul (best fit)", type: "workflow", detail: "Generates substitute pack: timetable, seating, medical notes, duty list." }, { label: "Generate cover plan first", type: "task" }], status: "open", on: daysAgo(0, 9, 5), aiInvolved: true },
    { id: "act_4", kind: "exception", title: "47 failed Term-2 payments cluster on Route 7 households", detail: "UPI failures spiked Tue\u2013Wed. 41 of 47 failed payments belong to Route 7 families \u2014 likely linked to the bus disruption week, not affordability.", why: "Collection rate is down 4.7% this week. A gentle combined message (bus + payment) usually recovers 60% within 48h.", priority: "high", owner: "Finance", deadline: daysAhead(2, 17, 0), evidence: [{ label: "Collection rate trend (14 days)", data: [88, 87, 89, 90, 91, 88, 86, 85, 84, 83, 85, 84, 83, 82.3], detail: "This week: 82.3% vs 88% 4-week average", ref: "/fees" }, { label: "Failed payment cluster", detail: "47 failures \xB7 41 share Route 7 \xB7 avg ticket \u20B957,457", ref: "/fees" }], actions: [{ label: "Send payment assistance message (draft ready)", type: "message", audience: "Guardians with failed Term-2 payments", audienceCount: 41, channel: "WhatsApp", posture: "APPROVAL", draft: "Dear Parents, some Term 2 online payments did not go through this week (we noticed the Bus 14 disruption may have affected routines). You can safely retry via the link below, or reply here and our accounts team will call you. No late fee will apply for retry by Friday. \u2014 Meridian Accounts" }, { label: "Retry all failed UPI mandates", type: "workflow", detail: "Batch retry via gateway; failed ones open reconciliation cases." }], status: "open", on: daysAgo(0, 10, 12), aiInvolved: true },
    { id: "act_5", kind: "recommendation", title: "Timetable clash \u2014 Chemistry lab double-booked (Grade 10)", detail: "Tuesdays: 10-A and 10-B both scheduled in Lab 2, periods 5\u20136. Six clashes detected by the timetable engine.", why: "Six periods of instruction at risk weekly; also flagged in inspection checklist.", priority: "normal", owner: "Academic Coordinator", deadline: daysAhead(4, 17, 0), evidence: [{ label: "Clash list", detail: "10-A P5,P6 \xB7 10-B P5,P6 \xB7 Lab 2 \xB7 Tuesdays", ref: "/timetable" }], actions: [{ label: "Move 10-B lab to Thursday P5\u20136", type: "workflow", detail: "Timetable engine validated: no new conflicts." }, { label: "Assign to coordinator", type: "task" }], status: "open", on: daysAgo(1, 14, 0), aiInvolved: true },
    { id: "act_6", kind: "case", title: "Parent complaint \u2014 Bus 14 repeated delays", detail: "Kavita Sharma (guardian, 8-B) on WhatsApp. Third delay this week; wants a firm answer before Friday.", why: "24h SLA; linked to the transport incident; high visibility on the parent WhatsApp thread.", priority: "high", owner: "Transport Supervisor", deadline: daysAhead(0, 18, 0), evidence: [{ label: "WhatsApp thread", detail: "Opened 08:15 \xB7 1 reply sent (acknowledgement)" }], actions: [{ label: "Draft honest status reply (with repair plan)", type: "message", audience: "Kavita Sharma", channel: "WhatsApp", posture: "APPROVAL", draft: "Dear Kavita ji, you are right \u2014 three delays in one week is not acceptable. Bus 14 had a coolant leak on Tuesday (repaired Saturday, workshop confirmed). From Monday the vehicle gets a pre-route inspection, and I will personally share the daily status until it stabilises. \u2014 Rajeev, Transport" }, { label: "Escalate to principal", type: "task" }], status: "open", on: daysAgo(0, 8, 16), aiInvolved: true }
  ];
  var decisions = [
    { id: "dec_1", title: "Move Class 8 assembly to Friday to protect first period", decidedOn: daysAgo(212), approver: "Principal", context: "Monday assembly consumed first period; 8-B mathematics repeatedly disrupted before weekly assessments.", alternatives: ["Shorten assembly", "Move assembly to Wednesday", "Keep as-is"], evidence: ["Term 1 assessment scores dipped 3% on weeks with Monday assembly", "Timetable clash report Nov"], policy: "Academic Time Protection \xA71.4", expectedOutcome: "First period protected \u226590% of Mondays", actualOutcome: "94% protected this term; math scores recovered", reviewOn: daysAhead(30), status: "validated" },
    { id: "dec_2", title: "Adopt WhatsApp-first parent communication", decidedOn: daysAgo(320), approver: "Board", context: "Email open rates 12%; parent survey showed 87% prefer WhatsApp.", alternatives: ["Parent portal app", "SMS only", "WhatsApp + portal deep-links"], evidence: ["Parent survey 2025 (n=612)", "Comms audit"], policy: "Communication \xA71.1", expectedOutcome: "Reply rate > 60% within 1h", actualOutcome: "74% average reply rate", reviewOn: daysAhead(12), status: "review-due" },
    { id: "dec_3", title: "Cap sibling fee waiver at 10%", decidedOn: daysAgo(140), approver: "Finance Committee", context: "Waiver requests averaging 13% were eroding Term 1 collections.", alternatives: ["12% cap", "10% cap", "Case-by-case"], evidence: ["Fee concession report 2024-25"], policy: "Fees \xA74.2", expectedOutcome: "Concession spend \u2264 3% of tuition revenue", actualOutcome: "2.6% this year", status: "validated" },
    { id: "dec_4", title: "Bus 14 to undergo pre-route inspection after breakdown cluster", decidedOn: daysAgo(1), approver: "Principal", context: "Coolant leak caused 22-min delay affecting 38 students and 8-B attendance (23%).", alternatives: ["Replace vehicle", "Daily inspection + spare on standby"], evidence: ["Transport incident inc_1", "8-B attendance 23% vs 94% avg"], policy: "Transport \xA73.1", expectedOutcome: "Zero route delays for 4 weeks", reviewOn: daysAhead(27), status: "open" },
    { id: "dec_5", title: "Hire second counsellor for East Campus", decidedOn: daysAgo(55), approver: "Board", context: "Counsellor load 1:410 students vs recommended 1:300.", alternatives: ["Part-time counsellor", "Contract helpline"], evidence: ["Wellbeing survey Term 2", "Counsellor hours log"], policy: "Student Wellbeing \xA72.2", expectedOutcome: "Counsellor wait < 3 days", reviewOn: daysAhead(5), status: "review-due" }
  ];
  var meetings = [
    { id: "meet_1", title: "Leadership weekly \u2014 transport & attendance", on: daysAgo(1, 15, 30), attendees: ["Principal", "Academic Coordinator", "Transport Supervisor", "Finance"], summary: "Reviewed Bus 14 breakdown impact: 8-B attendance 23%, 38 students delayed, 2 complaints. Agreed on pre-route inspections and spare-bus standby for 4 weeks.", decisions: ["Bus 14 pre-route inspection daily (4 weeks)", "Attendance leniency till 9:30 for delayed routes", "Weekly transport report to principal"], actionItems: ["Transport: workshop quote by Friday", "Coordinator: 8-B attendance follow-up"] },
    { id: "meet_2", title: "Fee review \u2014 Term 2 mid-collection", on: daysAgo(4, 11, 0), attendees: ["Principal", "Finance", "Accounts Executive"], summary: "Collection 82.3% vs 88% 4-week average. Cluster on Route 7 households; gateway timeouts contributed 23 pending retries.", decisions: ["No late fee for retries by Friday", "Send assistance message (draft approved)"], actionItems: ["Accounts: import settlement file", "Finance: monitor daily collection"] },
    { id: "meet_3", title: "Academic council \u2014 timetable integrity", on: daysAgo(7, 14, 0), attendees: ["Principal", "Academic Coordinator", "HODs"], summary: "Chemistry lab double-booking flagged; agreed to rebalance Tuesday labs and adopt clash-check rule.", decisions: ["Weekly clash-check mandatory"], actionItems: ["Coordinator: resolve Lab 2 clashes by Friday"] }
  ];
  var memoryDocs = [
    { id: "mdoc_1", title: "Parent Communication Policy 2026", type: "policy", updatedOn: daysAgo(30), owner: "Principal", excerpt: "All parent-facing messages originate from SchoolOS. Tone: respectful, factual, no blame. Hindi + English templates mandatory. Quiet hours 20:30\u201307:30." },
    { id: "mdoc_2", title: "Transport Operations SOP", type: "sop", updatedOn: daysAgo(60), owner: "Transport Supervisor", excerpt: "Daily pre-route inspection checklist. Delay > 10 min triggers guardian notification within 15 min. Spare bus standby rules during monsoon." },
    { id: "mdoc_3", title: "Fee Concession Guidelines", type: "policy", updatedOn: daysAgo(140), owner: "Finance Committee", excerpt: "Sibling waiver cap 10%. Merit scholarships up to 25% with committee approval. Hardship cases escalate to Principal." },
    { id: "mdoc_4", title: "Safeguarding Protocol", type: "policy", updatedOn: daysAgo(90), owner: "Safeguarding Lead", excerpt: "Any incident involving a child\u2019s safety is HUMAN-ONLY for decisions. SchoolOS may assemble evidence; decisions rest with the Safeguarding Lead." }
  ];
  var policies = [
    { id: "pol_1", category: "Attendance", title: "Guardian absence notification", statement: "When a student is marked absent in the first period, notify the primary guardian within 15 minutes on WhatsApp.", posture: "AUTO", version: "v3.2", effectiveFrom: daysAgo(120), owner: "Principal", status: "active", details: ["Excused absences (pre-approved leave) skip the notification", "If the guardian does not read within 30 min, the class teacher gets a task"] },
    { id: "pol_2", category: "Attendance", title: "Attendance leniency for delayed transport", statement: "Students on routes with verified delay > 10 min are marked present until 09:30.", posture: "AUTO", version: "v1.4", effectiveFrom: daysAgo(1), owner: "Principal", status: "active", details: ["Applies only to routes with an active transport incident", "Guardians informed automatically"] },
    { id: "pol_3", category: "Fees", title: "Payment retry window without late fee", statement: "Failed online payments can be retried for 5 days without late fee; a gentle assistance message is sent once.", posture: "AUTO", version: "v2.0", effectiveFrom: daysAgo(45), owner: "Finance", status: "active" },
    { id: "pol_4", category: "Fees", title: "Sibling waiver cap", statement: "Sibling discount is capped at 10% of tuition. Anything above requires the Principal and is recorded as an exception.", posture: "APPROVAL REQUIRED", version: "v2.1", effectiveFrom: daysAgo(140), owner: "Finance Committee", status: "active", details: ["Exceptions are logged with approver and reason", "Annual review of concession spend"] },
    { id: "pol_5", category: "Fees", title: "No student blocked from exams for fees", statement: "Fee status may inform reminders but never blocks exam eligibility. Any eligibility decision is human.", posture: "HUMAN-ONLY", version: "v1.0", effectiveFrom: daysAgo(300), owner: "Board", status: "active", details: ["Platform-invariant: no automation may alter a child\u2019s access to education"] },
    { id: "pol_6", category: "Communication", title: "Quiet hours", statement: "No non-emergency parent messages between 20:30 and 07:30. Emergency = safety incidents only.", posture: "AUTO", version: "v2.3", effectiveFrom: daysAgo(200), owner: "Principal", status: "active" },
    { id: "pol_7", category: "Communication", title: "Bulk parent messaging", statement: "Messages to more than one class require approval; AI may draft, staff must send.", posture: "APPROVAL REQUIRED", version: "v1.6", effectiveFrom: daysAgo(90), owner: "Principal", status: "active" },
    { id: "pol_8", category: "Approvals", title: "Timetable changes", statement: "Any timetable change affecting more than one section requires the Academic Coordinator\u2019s approval; the engine must show zero new clashes.", posture: "APPROVAL REQUIRED", version: "v1.2", effectiveFrom: daysAgo(160), owner: "Academic Coordinator", status: "active" },
    { id: "pol_9", category: "Approvals", title: "Fee concession exceptions", statement: "Concessions above policy caps require the Principal. Every exception records approver, reason, and amount.", posture: "APPROVAL REQUIRED", version: "v1.1", effectiveFrom: daysAgo(140), owner: "Principal", status: "active" },
    { id: "pol_10", category: "Safeguarding", title: "Child safety decisions", statement: "SchoolOS may assemble evidence and timelines for safeguarding matters. All decisions and communications rest with the Safeguarding Lead.", posture: "HUMAN-ONLY", version: "v2.0", effectiveFrom: daysAgo(300), owner: "Safeguarding Lead", status: "active", details: ["Platform-invariant: never automated, never AI-decided"] },
    { id: "pol_11", category: "Transport", title: "Delay notification", statement: "When a route is delayed more than 10 minutes, guardians of affected students are notified within 15 minutes with the reason and revised ETA.", posture: "AUTO", version: "v1.4", effectiveFrom: daysAgo(1), owner: "Transport Supervisor", status: "active" },
    { id: "pol_12", category: "Privacy", title: "AI access to student data", statement: "AI may read only records the requesting role can access. Every AI read is logged. Student-sensitive queries trigger the shield.", posture: "HUMAN-ONLY", version: "v1.3", effectiveFrom: daysAgo(60), owner: "IT Admin", status: "active" },
    { id: "pol_13", category: "AI Governance", title: "Grading posture", statement: "AI may draft feedback and rubric suggestions. Final marks are entered or approved by the teacher.", posture: "APPROVAL REQUIRED", version: "v1.0", effectiveFrom: daysAgo(30), owner: "Academic Coordinator", status: "active" },
    { id: "pol_14", category: "AI Governance", title: "Admissions decisions", statement: "AI may summarise and rank logistics (documents, scheduling). Offers, rejections and waitlists are decided by the Admissions Head only.", posture: "HUMAN-ONLY", version: "v1.0", effectiveFrom: daysAgo(30), owner: "Admissions Head", status: "active" }
  ];
  var workflows = [
    { id: "wf_1", name: "Absence \u2192 Guardian notified \u2192 Reply \u2192 Task", description: "First-period absence auto-notifies the guardian; replies create a follow-up task for the class teacher.", trigger: { event: "attendance.marked.absent", label: "Student marked absent (first period)", condition: "Guardian has WhatsApp enabled" }, steps: [{ id: "s1", type: "condition", label: "Is guardian verified?", detail: "WhatsApp verified contact" }, { id: "s2", type: "notify", label: "Notify guardian (WhatsApp)", detail: "Template: absence + reply-to-explain" }, { id: "s3", type: "wait", label: "Wait 2h for reply", detail: "Reply classification: reason / no-reply / urgent" }, { id: "s4", type: "task", label: "Create teacher follow-up task", detail: "If reason = sick: wellness note template" }], enabled: true, runsThisMonth: 142, lastRun: daysAgo(0, 8, 2), source: "library", posture: "AUTO" },
    { id: "wf_2", name: "Bus delay > 10 min \u2192 Guardian ETA update", description: "GPS deviation triggers guardian notification with revised ETA within 15 min (Transport \xA73.1).", trigger: { event: "transport.delay.detected", label: "Route delay > 10 min", condition: "Delay verified by GPS + driver" }, steps: [{ id: "s1", type: "condition", label: "Delay \u2265 10 min?", detail: "From GPS + driver confirmation" }, { id: "s2", type: "notify", label: "Notify affected guardians", detail: "Revised ETA + reason; groups by stop" }, { id: "s3", type: "update", label: "Flag affected attendance leniency", detail: "Marks route as delayed for attendance policy" }], enabled: true, runsThisMonth: 9, lastRun: daysAgo(2, 7, 51), source: "library", posture: "AUTO" },
    { id: "wf_3", name: "3 absences in 2 weeks \u2192 Teacher follow-up", description: "Chronic-absence early warning; creates a structured follow-up task with the student\u2019s pattern.", trigger: { event: "attendance.pattern.detected", label: "3 absences within 2 weeks", condition: "Not pre-approved leave" }, steps: [{ id: "s1", type: "task", label: "Class teacher follow-up task", detail: "Includes absence pattern + guardian contact status" }, { id: "s2", type: "approval", label: "Counsellor review if pattern repeats", detail: "Second occurrence escalates to counsellor" }], enabled: true, runsThisMonth: 11, lastRun: daysAgo(3), source: "library", posture: "AUTO" },
    { id: "wf_4", name: "Failed payment \u2192 Assistance message", description: "Failed online payment triggers one gentle assistance message; retries within window carry no late fee (Fees \xA74.3).", trigger: { event: "payment.failed", label: "Online payment failed", condition: "First failure this term" }, steps: [{ id: "s1", type: "notify", label: "Send assistance message + retry link", detail: "Template: payment assistance, no-shaming tone" }, { id: "s2", type: "condition", label: "Paid within 5 days?", detail: "Else: reconciliation case + finance task" }, { id: "s3", type: "task", label: "Finance call task", detail: "Second failure creates a call task" }], enabled: true, runsThisMonth: 47, lastRun: daysAgo(0, 10, 40), source: "library", posture: "AUTO" },
    { id: "wf_5", name: "Document expiring \u2192 Owner task", description: "Any certificate/document within 30 days of expiry creates a renewal task for its owner.", trigger: { event: "document.expiring", label: "Document expires within 30 days", condition: "No renewal in progress" }, steps: [{ id: "s1", type: "task", label: "Renewal task to document owner", detail: "Includes vendor + last renewal details" }, { id: "s2", type: "notify", label: "Reminder at 14 days if not renewed", detail: "Escalates to admin officer at 7 days" }], enabled: true, runsThisMonth: 6, lastRun: daysAgo(1), source: "library", posture: "AUTO" },
    { id: "wf_6", name: "Fee concession above cap \u2192 Principal approval", description: "Any concession above 10% requires the Principal (Fees \xA74.2) and records the exception.", trigger: { event: "fee.concession.requested", label: "Concession > policy cap", condition: "Amount > 10% of tuition" }, steps: [{ id: "s1", type: "approval", label: "Principal approval", detail: "Shows policy, precedent, amount delta" }, { id: "s2", type: "update", label: "Record exception + audit entry", detail: "Approved reason is mandatory" }], enabled: true, runsThisMonth: 3, lastRun: daysAgo(0, 8, 28), source: "library", posture: "APPROVAL" }
  ];
  var workflowRuns = Array.from({ length: 14 }, (_, i) => ({
    id: `run_${i + 1}`,
    workflowId: workflows[i % workflows.length].id,
    on: daysAgo(Math.floor(i / 2), rng.int(8, 15), rng.int(0, 59)),
    triggerRecord: rng.pick(["Aarav Sharma (8-B)", "Diya Patel (5-A)", "Kabir Singh (9-B)", "Route 7", "Payment MER482911", "Fire safety certificate"]),
    status: rng.chance(0.85) ? "completed" : "awaiting-approval",
    stepsCompleted: rng.int(2, 4),
    totalSteps: 4
  }));
  var obligations = [
    { id: "obl_1", title: "Fire Safety Certificate renewal \u2014 North Campus", category: "renewal", dueOn: daysAhead(21), leadTimeDays: 30, owner: "Admin Officer", ownerRole: "coordinator", status: "due-soon", evidence: "Certificate doc_school_1 \xB7 vendor quote pending", campus: "north" },
    { id: "obl_2", title: "CBSE OASIS data submission (Term 2)", category: "compliance", dueOn: daysAhead(9), leadTimeDays: 21, owner: "Principal", ownerRole: "principal", status: "on-track", evidence: "Last year submitted 12 days early", campus: "all" },
    { id: "obl_3", title: "Bus fitness certificates \u2014 3 vehicles", category: "renewal", dueOn: daysAhead(14), leadTimeDays: 30, owner: "Transport Supervisor", ownerRole: "transport", status: "on-track", campus: "all" },
    { id: "obl_4", title: "Term 2 fee milestone \u2014 second installment reminders", category: "fee", dueOn: daysAhead(12), leadTimeDays: 7, owner: "Finance", ownerRole: "finance", status: "on-track", campus: "all" },
    { id: "obl_5", title: "Decision review \u2014 WhatsApp-first communication", category: "review", dueOn: daysAhead(12), leadTimeDays: 14, owner: "Principal", ownerRole: "principal", status: "due-soon", evidence: "Decision dec_2 \xB7 review due", campus: "all" },
    { id: "obl_6", title: "Term 1 staff appraisal cycle", category: "report", dueOn: daysAhead(28), leadTimeDays: 30, owner: "HR Executive", ownerRole: "coordinator", status: "on-track", campus: "all" },
    { id: "obl_7", title: "Playground equipment inspection \u2014 East", category: "renewal", dueOn: daysAhead(4), leadTimeDays: 14, owner: "Admin Officer", ownerRole: "coordinator", status: "due-soon", campus: "east" },
    { id: "obl_8", title: "Parent-Teacher Meeting \u2014 Grades 6-8 logistics", category: "report", dueOn: daysAhead(6), leadTimeDays: 10, owner: "Academic Coordinator", ownerRole: "coordinator", status: "on-track", campus: "north" },
    { id: "obl_9", title: "Counsellor decision review \u2014 second hire", category: "review", dueOn: daysAhead(5), leadTimeDays: 14, owner: "Principal", ownerRole: "principal", status: "due-soon", evidence: "Decision dec_5 \xB7 wait-time target unmet", campus: "east" }
  ];
  var calendarEvents = [
    { id: "cal_1", title: "Unit Test \u2014 Mathematics (6-8)", type: "exam", on: daysAhead(3, 9, 0), durationMins: 90, campus: "north", owner: "Examination Cell" },
    { id: "cal_2", title: "Parent-Teacher Meeting (6-8)", type: "ptm", on: daysAhead(6, 9, 30), durationMins: 240, campus: "north", owner: "Academic Coordinator", location: "Main Hall" },
    { id: "cal_3", title: "Admission campus tour \u2014 14 families", type: "admission", on: daysAhead(2, 10, 0), durationMins: 90, campus: "city", owner: "Admissions" },
    { id: "cal_4", title: "Science exhibition setup", type: "event", on: daysAhead(8, 14, 0), durationMins: 240, campus: "north", owner: "HOD Science" },
    { id: "cal_5", title: "Fire drill \u2014 all campuses", type: "inspection", on: daysAhead(5, 11, 0), durationMins: 45, campus: "all", owner: "Admin Officer" },
    { id: "cal_6", title: "Grade 10 IGCSE orientation", type: "event", on: daysAhead(9, 9, 0), durationMins: 120, campus: "city", owner: "Counsellor" },
    { id: "cal_7", title: "Term 2 fee milestone", type: "deadline", on: daysAhead(12, 17, 0), durationMins: 0, campus: "all", owner: "Finance" },
    { id: "cal_8", title: "Inter-school football \u2014 City zone", type: "event", on: daysAhead(11, 8, 0), durationMins: 300, campus: "city", owner: "Sports Coach" },
    { id: "cal_9", title: "Staff development workshop \u2014 AI in classrooms", type: "staff", on: daysAhead(7, 15, 0), durationMins: 90, campus: "all", owner: "Principal" },
    { id: "cal_10", title: "Grade 5 field trip \u2014 Science Museum", type: "trip", on: daysAhead(10, 8, 30), durationMins: 360, campus: "north", owner: "Class Teacher 5-A" },
    { id: "cal_11", title: "Unit Test \u2014 Science (9-10)", type: "exam", on: daysAhead(3, 10, 45), durationMins: 90, campus: "city", owner: "Examination Cell" },
    { id: "cal_12", title: "Transport safety committee", type: "staff", on: daysAhead(4, 16, 0), durationMins: 60, campus: "all", owner: "Transport Supervisor" }
  ];
  var healthIssues = [
    { id: "hl_1", category: "guardian", severity: "medium", title: "Probable duplicate guardian records", count: 17, detail: "Same phone number with name variants (e.g., \u201CR. Gupta\u201D / \u201CRajesh Gupta\u201D).", suggestedFix: "Merge with review \u2014 preserves both roles, keeps the stronger contact trail.", status: "open" },
    { id: "hl_2", category: "guardian", severity: "high", title: "Missing emergency contact", count: 4, detail: "Students with no second reachable guardian.", suggestedFix: "Task class teacher to collect during PTM (6 days away).", status: "open" },
    { id: "hl_3", category: "fees", severity: "medium", title: "Fee ledger vs gateway mismatches", count: 3, detail: "Settlement file entries without fee-ledger matches (includes the 23-timeout batch).", suggestedFix: "Import settlement file and re-match automatically.", status: "open" },
    { id: "hl_4", category: "documents", severity: "low", title: "Expired documents on record", count: 7, detail: "Mostly medical forms past validity; 2 transport agreements.", suggestedFix: "Renewal tasks to class teachers (bulk).", status: "open" },
    { id: "hl_5", category: "enrollment", severity: "low", title: "Roll-number gaps", count: 9, detail: "Sections with roll-number gaps from mid-year exits.", suggestedFix: "Auto-renumber with effective-dating on confirmation.", status: "open" },
    { id: "hl_6", category: "attendance", severity: "medium", title: "Unverified guardian numbers affecting absence alerts", count: 12, detail: "Guardians whose WhatsApp delivery failed \u2265 3 times.", suggestedFix: "One-tap fallback to SMS + verification request.", status: "open" }
  ];
  var healthScore = (issues) => {
    const penalty = issues.filter((i) => i.status === "open").reduce((a, i) => a + (i.severity === "high" ? 2.4 : i.severity === "medium" ? 1.1 : 0.4), 0);
    return Math.max(60, Math.round(100 - penalty));
  };
  var notifications = [
    { id: "ntf_1", group: "needs-you", title: "Grade 8-B attendance at 23% \u2014 action recommended", body: "Cluster matches Bus 14 disruption. Review the evidence and approve a parent message.", on: daysAgo(0, 7, 55), read: false, ref: "/action-center" },
    { id: "ntf_2", group: "approvals", title: "Concession 12.5% exceeds 10% policy cap", body: "Admissions request for Dhruv Khanna (2-A) needs your decision.", on: daysAgo(0, 8, 30), read: false, ref: "/action-center" },
    { id: "ntf_3", group: "needs-you", title: "Case: Bus 14 complaint \u2014 SLA 24h", body: "Kavita Sharma (guardian, 8-B) via WhatsApp. Draft reply ready.", on: daysAgo(0, 8, 16), read: false, ref: "/cases" },
    { id: "ntf_4", group: "updates", title: "Bus 14 status changed to Delayed +13 min", body: "38 students affected \xB7 guardian notifications queued.", on: daysAgo(0, 7, 42), read: false, ref: "/transport" },
    { id: "ntf_5", group: "system", title: "Reconciliation: 23 gateway payments unmatched", body: "UPI timeouts 11:00\u201311:40. Settlement file import suggested.", on: daysAgo(1, 11, 25), read: true, ref: "/fees" },
    { id: "ntf_6", group: "updates", title: "Workflow run: absence \u2192 guardian notified", body: "Ira Menon (3-A) \u2014 guardian acknowledged in 4 minutes.", on: daysAgo(0, 8, 6), read: true, ref: "/automation" },
    { id: "ntf_7", group: "system", title: "Document expiring: Fire Safety Certificate", body: "North Campus \xB7 expires in 21 days \xB7 renewal task created.", on: daysAgo(1, 9, 0), read: true, ref: "/data-health" }
  ];
  var auditEntries = [
    { id: "aud_1", on: daysAgo(0, 10, 42), actor: "Priya Iyer", actorRole: "teacher", action: "Approved parent message", recordType: "Message", recordRef: "8-B guardians \xD7 24", reason: "Bus delay reassurance", policyRef: "Communication \xA72.1", aiInvolved: true, risk: "low", outcome: "Sent via WhatsApp \xB7 23 delivered, 1 retry" },
    { id: "aud_2", on: daysAgo(0, 10, 12), actor: "SchoolOS AI", actorRole: "principal", action: "Recommended bulk payment-assistance message", recordType: "Fee cluster", recordRef: "47 failed payments \xB7 Route 7", policyRef: "Communication \xA72.1 (bulk = approval)", aiInvolved: true, risk: "medium", outcome: "Awaiting approval" },
    { id: "aud_3", on: daysAgo(0, 9, 30), actor: "Rajeev Kaul", actorRole: "transport", action: "Updated bus status", recordType: "Route 7 / Bus 14", recordRef: "Delayed +13 min", reason: "Driver radio confirmation", aiInvolved: false, risk: "low", outcome: "Guardians auto-notified per Transport \xA73.1" },
    { id: "aud_4", on: daysAgo(0, 9, 5), actor: "SchoolOS AI", actorRole: "coordinator", action: "Ranked substitute candidates", recordType: "Substitution", recordRef: "Ms. Sarita Mishra (7-A) leave", policyRef: "Approvals \xA71.2", aiInvolved: true, risk: "low", outcome: "Awaiting coordinator approval" },
    { id: "aud_5", on: daysAgo(0, 8, 55), actor: "SchoolOS AI", actorRole: "principal", action: "Detected attendance anomaly", recordType: "Attendance", recordRef: "8-B \xB7 23% vs 94% avg", policyRef: "Attendance \xA71.1", aiInvolved: true, risk: "medium", outcome: "Attention item created with evidence chain" },
    { id: "aud_6", on: daysAgo(0, 8, 41), actor: "Anita Deshpande", actorRole: "admissions", action: "Requested fee concession", recordType: "Fee concession", recordRef: "Dhruv Khanna (2-A) \xB7 12.5%", policyRef: "Fees \xA74.2 (cap 10%)", aiInvolved: false, risk: "medium", outcome: "Blocked to principal approval \u2014 exceeds cap" },
    { id: "aud_7", on: daysAgo(0, 8, 6), actor: "SchoolOS (workflow wf_1)", actorRole: "teacher", action: "Notified guardian of absence", recordType: "Attendance", recordRef: "Ira Menon (3-A)", policyRef: "Attendance \xA71.1", aiInvolved: true, risk: "low", outcome: "WhatsApp delivered \xB7 read 4m later" },
    { id: "aud_8", on: daysAgo(1, 17, 10), actor: "Principal", actorRole: "principal", action: "Closed transport incident", recordType: "Incident", recordRef: "inc_1 \u2014 Bus 14 breakdown", reason: "Students safe, root cause repaired", aiInvolved: false, risk: "high", outcome: "Reviewed \xB7 pre-route inspection decision recorded (dec_4)" },
    { id: "aud_9", on: daysAgo(1, 15, 32), actor: "Meeting Intelligence", actorRole: "principal", action: "Extracted decisions from meeting notes", recordType: "Decision records", recordRef: "meet_1 \u2014 3 decisions", aiInvolved: true, risk: "low", outcome: "Decisions + tasks created, linked to evidence" },
    { id: "aud_10", on: daysAgo(1, 11, 25), actor: "Reconciliation worker", actorRole: "finance", action: "Detected ledger mismatch", recordType: "Reconciliation", recordRef: "23 gateway payments", policyRef: "Fees \xA75.1", aiInvolved: true, risk: "medium", outcome: "Case case_3 opened \xB7 SLA 12h" }
  ];
  var insights = [
    { id: "ins_1", question: "Why did fee realization fall this week?", metric: "Collection rate", delta: "82.3% vs 88% avg", dir: "down", explanation: "47 online payments failed Tue\u2013Wed. 41 of 47 belong to Route 7 households, whose week was disrupted by the Bus 14 breakdown \u2014 consistent with disrupted routines, not affordability. A further 23 payments are pending settlement-file import after gateway timeouts.", chart: { labels: TERM_DAYS.slice(-14).map((d) => fmtDay(d)), values: [88, 87, 89, 90, 91, 88, 86, 85, 84, 83, 85, 84, 83, 82.3] }, clusters: [{ label: "Route 7 households", value: 41 }, { label: "UPI timeouts (pending import)", value: 23 }, { label: "Other", value: 6 }], actions: [{ label: "Review the payment-assistance draft", ref: "/action-center" }, { label: "Import settlement file", ref: "/fees" }], confidence: "high", ownerRole: "finance" },
    { id: "ins_2", question: "Why are Grade 8-B absences rising?", metric: "8-B presence", delta: "23% vs 93% avg", dir: "down", explanation: "15 of the 20 absentees are Bus 14 riders; the rest include one reported fever. Absence tracks the route disruption almost exactly \u2014 the class is effectively present-but-delayed.", chart: { labels: TERM_DAYS.slice(-10).map((d) => fmtDay(d)), values: [81, 85, 92, 100, 92, 92, 96, 96, 100, 23] }, actions: [{ label: "Open the attendance evidence", ref: "/attendance" }, { label: "Approve the 8-B parent message", ref: "/action-center" }], confidence: "high", ownerRole: "principal" },
    { id: "ins_3", question: "Which routes generate the most complaints?", metric: "Cases per route (30d)", delta: "Route 7 leads", dir: "flat", explanation: "Route 7 accounts for 7 of 11 transport cases in 30 days, all involving Bus 14. Since the pre-route inspection decision, complaint rate has dropped to zero for two days.", chart: { labels: ["R7", "R4", "R2", "R9", "R1", "R5", "R3"], values: [7, 2, 1, 1, 0, 0, 0] }, actions: [{ label: "Open transport incidents", ref: "/incidents" }], confidence: "high", ownerRole: "transport" },
    { id: "ins_4", question: "Where is teacher workload increasing?", metric: "Avg periods/teacher/week", delta: "+2.1 vs last term", dir: "up", explanation: "Two long-leave substitutes increased average load. Mathematics teachers carry the highest peaks (Naveen Kaul: 31 periods). Substitution rebalancing is available.", chart: { labels: ["Kaul N", "Rao S", "Bhat A", "Iyer P", "Menon D"], values: [31, 29, 27, 26, 24] }, actions: [{ label: "Open substitution planner", ref: "/operations/hr" }], confidence: "medium", ownerRole: "principal" }
  ];
  function fmtDay(d) {
    return d.toLocaleDateString("en-IN", { day: "numeric" }) + "";
  }
  var aiUsage = {
    days: TERM_DAYS.slice(-14).map((d, i) => ({ label: fmtDay(d), cost: 380 + i * 47 % 140, requests: 1200 + i * 131 % 500 })),
    byFeature: [{ label: "Digest assembly", cost: 3100, requests: 5400 }, { label: "Ask / briefings", cost: 2400, requests: 310 }, { label: "Document classification", cost: 900, requests: 820 }, { label: "Drafts (teacher)", cost: 1500, requests: 480 }, { label: "Reply classification", cost: 700, requests: 1900 }],
    latency: { p50: 480, p95: 1400 },
    failureRate: 0.4,
    monthSpend: 52400,
    budget: 75e3
  };
  var models = [
    { name: "Frontier (reasoning)", provider: "Hosted", region: "ap-south-1", usedFor: "Briefing narrative \xB7 Ask investigations", posture: "Read-only tools; approval-gated actions", cost: "\u20B92.4k this month" },
    { name: "Fast (classification)", provider: "Hosted", region: "ap-south-1", usedFor: "Reply & document classification, digests", posture: "AUTO within policy whitelist", cost: "\u20B93.1k this month" },
    { name: "Batch (bulk nightly)", provider: "Hosted", region: "ap-south-1", usedFor: "Document OCR, transcripts, embeddings", posture: "Headless workers; logged", cost: "\u20B90.9k this month" }
  ];
  var guardianChat = [
    { id: "gcm1", from: "school", text: "Good morning! Bus 14 is running about 13 minutes late today \u2014 Aarav is marked present under the transport leniency policy (Attendance \xA71.4). Have a good day.", on: daysAgo(0, 8, 3), status: "read", template: true },
    { id: "gcm2", from: "guardian", text: "Thank you! He mentioned the maths test on Thursday \u2014 is the syllabus chapter 4 only?", on: daysAgo(0, 8, 12) },
    { id: "gcm3", from: "school", text: "Yes \u2014 Unit Test 2 covers Chapter 4 and the class notes from Mon\u2013Wed. The practice sheet is in the app under Learning \u2192 Assignments.", on: daysAgo(0, 8, 14), status: "read", template: true },
    { id: "gcm4", from: "school", text: "Reminder: Term 2 fee \u20B955,500 is due on the 12th. You can pay in one tap below.", on: daysAgo(0, 8, 15), status: "read", template: true }
  ];
  var peopleAll = () => [...students, ...teachers, ...staff, ...guardians];
  function findPerson(id) {
    return peopleAll().find((p) => p.id === id);
  }
  function studentsOfSection(sectionId) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return [];
    return students.filter((st) => st.campus === sec.campus && st.grade === sec.grade && st.section === sec.name);
  }
  function sectionOfStudent(st) {
    return sections.find((s) => s.campus === st.campus && s.grade === st.grade && s.name === st.section);
  }
  function guardiansOfStudent(studentId) {
    return guardianLinks.filter((l) => l.studentId === studentId).map((l) => ({ link: l, guardian: guardians.find((g) => g.id === l.guardianId) }));
  }
  return __toCommonJS(seed_exports);
})();
