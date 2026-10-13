/* 작심삼일 화면 동작과 저장. 계산은 scheduler.js를 부른다. (spec 3번, 6번) */
(function () {
  "use strict";
  var S = window.Scheduler;

  var KEY = "jaksim.v1";
  var VERSION = 1;
  var MAX_TASKS = 50;
  var DEFAULT_DEADLINE_DAYS = 7;
  var DEFAULT_WEEKDAY = 60;
  var DEFAULT_WEEKEND = 120;
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  var METHODS = {
    catchup: { name: "전부 따라잡기", desc: "마감까지 모든 일을 끝내도록 매일 나눠 해요" },
    fit: { name: "가능한 시간에 맞추기", desc: "매일 쓸 수 있는 시간만큼만 하고, 마감을 넘기면 알려줘요" }
  };

  var state = emptyState();
  var storageOk = true;
  var compareResult = null;
  var compareSource = "input";
  var idCounter = 0;

  function $(id) { return document.getElementById(id); }

  function emptyState() {
    return { version: VERSION, tasks: [], settings: null, plan: null, createdAt: null, updatedAt: null };
  }

  // ---------- 날짜와 글자 ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDate(str) {
    var p = str.split("-");
    var w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return +p[1] + "월 " + +p[2] + "일(" + WEEK[w] + ")";
  }
  function fmtMin(m) {
    if (!m || m <= 0) return "0분";
    var h = Math.floor(m / 60), r = m % 60;
    if (h === 0) return r + "분";
    if (r === 0) return h + "시간";
    return h + "시간 " + r + "분";
  }
  function roundStep(n) {
    var v = parseInt(n, 10);
    if (!(v > 0)) return 0;
    return Math.ceil(v / S.STEP) * S.STEP;
  }
  function newId() {
    state.tasks.forEach(function (t) {
      var n = parseInt(String(t.id).slice(1), 10);
      if (n > idCounter) idCounter = n;
    });
    idCounter += 1;
    return "t" + idCounter;
  }

  // ---------- 요소 만들기 (글자는 textContent로만 넣는다) ----------
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // ---------- 알림과 확인 창 ----------
  function showNotice(text) {
    var n = $("notice");
    n.textContent = text;
    n.hidden = !text;
  }
  function confirmDialog(message, okLabel) {
    var dlg = $("dlg");
    if (!dlg || typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(message));
    $("dlgMsg").textContent = message;
    $("dlgOk").textContent = okLabel;
    return new Promise(function (resolve) {
      function onClose() {
        dlg.removeEventListener("close", onClose);
        resolve(dlg.returnValue === "ok");
      }
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }

  // ---------- 저장 (spec 4-3) ----------
  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      storageOk = false;
      return null;
    }
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (!o || o.version !== VERSION || !Array.isArray(o.tasks)) throw new Error("bad");
      return o;
    } catch (e) {
      showNotice("저장된 내용을 읽지 못해서 새로 시작해요");
      return null;
    }
  }
  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (storageOk) showNotice("저장되지 않았어요. 이 브라우저에서는 새로고침하면 내용이 사라질 수 있어요");
      storageOk = false;
    }
  }
  function wipe() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* 저장소를 못 써도 화면은 계속 동작한다 */ }
  }

  // ---------- 화면 전환 ----------
  function show(name) {
    ["input", "compare", "plan"].forEach(function (n) { $("screen-" + n).hidden = n !== name; });
    var head = $("h-" + name);
    window.scrollTo(0, 0);
    if (head) head.focus();
  }

  // ---------- 입력 화면 ----------
  function ensureSettings() {
    if (!state.settings) {
      var t = todayStr();
      state.settings = {
        today: t,
        finalDeadline: S.addDays(t, DEFAULT_DEADLINE_DAYS),
        weekdayMinutes: DEFAULT_WEEKDAY,
        weekendMinutes: DEFAULT_WEEKEND,
        overrides: {}
      };
    }
  }

  function renderInput() {
    ensureSettings();
    $("finalDeadline").min = todayStr();
    $("finalDeadline").value = state.settings.finalDeadline;
    $("weekdayMin").value = state.settings.weekdayMinutes;
    $("weekendMin").value = state.settings.weekendMinutes;
    renderTaskList();
    updateSubmit();
  }

  function renderTaskList() {
    var ul = $("taskList");
    clear(ul);
    $("emptyMsg").hidden = state.tasks.length > 0;
    state.tasks.forEach(function (task, idx) {
      var title = h("input", { type: "text", value: task.title, "aria-label": "일 제목" });
      title.addEventListener("input", function () { task.title = title.value; saveDraft(); updateSubmit(); });
      var mins = h("input", { type: "number", min: "0", step: "5", value: String(task.minutes), "aria-label": "걸리는 시간(분)", inputmode: "numeric" });
      mins.addEventListener("change", function () {
        task.minutes = roundStep(mins.value);
        mins.value = String(task.minutes);
        li.classList.toggle("zero", task.minutes === 0);
        saveDraft(); updateSubmit();
      });
      var del = h("button", { type: "button", class: "del", text: "지우기", "aria-label": (task.title || "이 일") + " 지우기" });
      del.addEventListener("click", function () {
        state.tasks.splice(idx, 1);
        saveDraft(); renderTaskList(); updateSubmit();
      });
      var dl = h("input", { type: "date", min: todayStr(), "aria-label": "이 일만의 마감일", value: task.deadline || "" });
      dl.addEventListener("change", function () { task.deadline = dl.value || null; saveDraft(); });
      var pr = h("select", { "aria-label": "중요도" }, [
        h("option", { value: "1", text: "낮음" }),
        h("option", { value: "2", text: "보통" }),
        h("option", { value: "3", text: "높음" })
      ]);
      pr.value = String(task.priority || 2);
      pr.addEventListener("change", function () { task.priority = parseInt(pr.value, 10); saveDraft(); });
      var li = h("li", { class: task.minutes === 0 ? "zero" : "" }, [
        h("div", { class: "task-row" }, [title, mins, del]),
        h("details", { class: "more" }, [
          h("summary", { text: "마감·중요도" }),
          h("div", { class: "more-body" }, [
            h("div", {}, [h("label", { class: "small-label", text: "이 일만의 마감일" }), dl]),
            h("div", {}, [h("label", { class: "small-label", text: "중요도" }), pr])
          ])
        ])
      ]);
      if (task.minutes === 0) li.appendChild(h("p", { class: "hint", text: "0분이라 일정에 넣지 않아요" }));
      ul.appendChild(li);
    });
  }

  function saveDraft() {
    readSettings();
    save();
  }

  function readSettings() {
    ensureSettings();
    var fd = $("finalDeadline").value;
    if (fd) state.settings.finalDeadline = fd;
    var wd = parseInt($("weekdayMin").value, 10);
    var we = parseInt($("weekendMin").value, 10);
    state.settings.weekdayMinutes = wd >= 0 ? wd : 0;
    state.settings.weekendMinutes = we >= 0 ? we : 0;
  }

  function parsedFromText() {
    return S.parseTaskLines($("taskText").value).filter(function (t) { return t.title.trim(); });
  }

  function addFromText() {
    var parsed = parsedFromText();
    if (!parsed.length) return;
    var room = MAX_TASKS - state.tasks.length;
    if (parsed.length > room) {
      showNotice("일은 최대 " + MAX_TASKS + "개까지만 담을 수 있어요. 앞의 " + MAX_TASKS + "개만 넣었어요");
      parsed = parsed.slice(0, Math.max(0, room));
    }
    parsed.forEach(function (t) {
      t.id = newId();
      state.tasks.push(t);
    });
    $("taskText").value = "";
    saveDraft();
    renderTaskList();
    updateSubmit();
  }

  function deadlineProblem() {
    var v = $("finalDeadline").value;
    return !v || v < todayStr();
  }

  function updateSubmit() {
    var hasTasks = state.tasks.length > 0 || parsedFromText().length > 0;
    var bad = deadlineProblem();
    $("deadlineError").hidden = !bad;
    $("submitBtn").disabled = !hasTasks || bad;
  }

  function onSubmit() {
    addFromText();
    readSettings();
    var usable = state.tasks.filter(function (t) { return t.title.trim() && t.minutes > 0; });
    var err = $("inputError");
    if (!usable.length) {
      err.textContent = "걸리는 시간이 0분보다 큰 일을 하나 이상 적어 주세요";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    state.tasks = state.tasks.filter(function (t) { return t.title.trim(); });
    showNotice("");
    try {
      state.settings.today = todayStr();
      compareResult = S.compare(state.tasks, state.settings);
    } catch (e) {
      err.textContent = "일정을 만들지 못했어요. 입력을 확인해 주세요";
      err.hidden = false;
      return;
    }
    compareSource = "input";
    state.plan = null;
    save();
    renderCompare();
    show("compare");
  }

  // ---------- 비교 화면 ----------
  function renderCompare() {
    var box = $("cards");
    clear(box);
    ["catchup", "fit"].forEach(function (m) {
      var plan = compareResult[m];
      var sum = plan.summary;
      var rows = [
        ["하루 평균", fmtMin(sum.avgPerDay)],
        ["가능 시간을 넘는 날", sum.overDays ? sum.overDays + "일 (총 " + fmtMin(sum.overMinutes) + ")" : "없음"],
        ["마감을 넘기는 일", sum.lateCount ? sum.lateCount + "개" : "없음"],
        ["끝나는 날", sum.endDate ? fmtDate(sum.endDate) : "-"]
      ];
      if (sum.unplacedMinutes > 0) rows.push(["60일 안에 못 끝내는 시간", fmtMin(sum.unplacedMinutes)]);
      var dl = h("dl", {});
      rows.forEach(function (r) { dl.appendChild(h("dt", { text: r[0] })); dl.appendChild(h("dd", { text: r[1] })); });
      var warns = [];
      if (sum.overDays > 0) warns.push("하루 필요 시간이 가능 시간보다 길어요 (" + sum.overDays + "일, 총 " + fmtMin(sum.overMinutes) + ")");
      if (sum.lateCount > 0) {
        var most = Math.max.apply(null, sum.lateTasks.map(function (x) { return x.lateDays; }));
        warns.push("마감을 최대 " + most + "일 넘기는 일이 " + sum.lateCount + "개 있어요");
      }
      if (sum.unplacedMinutes > 0) warns.push("60일 안에 끝나지 않는 " + fmtMin(sum.unplacedMinutes) + "이 남아요");
      var warnList = warns.length ? h("ul", { class: "warns" }, warns.map(function (w) { return h("li", { text: w }); })) : null;
      var pick = h("button", { type: "button", class: "btn", text: "이 방식으로 시작" });
      pick.addEventListener("click", function () { choose(m); });
      box.appendChild(h("article", { class: "card" }, [
        h("h3", { text: METHODS[m].name }),
        h("p", { class: "desc", text: METHODS[m].desc }),
        dl, warnList, pick
      ]));
    });
    $("compareBack").textContent = compareSource === "plan" ? "일정표로 돌아가기" : "입력 고치기";
  }

  function choose(method) {
    state.plan = compareResult[method];
    if (!state.createdAt) state.createdAt = new Date().toISOString();
    save();
    renderPlan();
    show("plan");
  }

  // ---------- 일정표 화면 ----------
  function renderPlan() {
    var plan = state.plan;
    var today = todayStr();
    var blocks = plan.blocks.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var late = {};
    S.lateTasksOf(blocks, state.tasks, state.settings).forEach(function (x) { late[x.taskId] = x.lateDays; });
    var titleOf = {};
    state.tasks.forEach(function (t) { titleOf[t.id] = t.title; });

    var undone = blocks.filter(function (b) { return !b.done; });
    var lastDate = blocks.length ? blocks[blocks.length - 1].date : null;
    $("planMeta").textContent = METHODS[plan.method].name + (undone.length && lastDate ? " · 끝나는 날 " + fmtDate(lastDate) : "");

    var todayBlocks = blocks.filter(function (b) { return b.date === today; });
    var allDone = blocks.length > 0 && undone.length === 0;
    var msg = $("doneMsg");
    if (allDone) { msg.textContent = "모든 일을 마쳤어요"; msg.hidden = false; }
    else if (todayBlocks.length && todayBlocks.every(function (b) { return b.done; })) { msg.textContent = "오늘 몫을 마쳤어요"; msg.hidden = false; }
    else msg.hidden = true;
    $("missBtn").disabled = allDone;

    var box = $("days");
    clear(box);
    var groups = [];
    blocks.forEach(function (b) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== b.date) { g = { date: b.date, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    var past = groups.filter(function (g) { return g.date < today; });
    var rest = groups.filter(function (g) { return g.date >= today; });

    if (past.length) {
      var pd = h("details", { class: "past" }, [h("summary", { text: "지난 날짜 (" + past.length + "일)" })]);
      past.forEach(function (g) { pd.appendChild(dayEl(g, today, late, titleOf)); });
      box.appendChild(pd);
    }
    if (!todayBlocks.length && rest.length) {
      box.appendChild(h("p", { class: "hint", text: "오늘 할 일은 없어요" }));
    }
    rest.forEach(function (g) { box.appendChild(dayEl(g, today, late, titleOf)); });
  }

  function dayEl(g, today, late, titleOf) {
    var total = g.items.reduce(function (s, b) { return s + b.minutes; }, 0);
    var head = h("h3", {}, [
      fmtDate(g.date),
      g.date === today ? h("span", { class: "tag", text: "오늘" }) : null,
      h("span", { class: "total", text: fmtMin(total) })
    ]);
    var ul = h("ul", { class: "blocks" });
    g.items.forEach(function (b) { ul.appendChild(blockEl(b, late, titleOf)); });
    return h("section", { class: "day" + (g.date === today ? " today" : "") }, [head, ul]);
  }

  function blockEl(b, late, titleOf) {
    var title = titleOf[b.taskId] || "(이름 없는 일)";
    var cb = h("input", { type: "checkbox", "aria-label": title + " " + fmtDate(b.date) + " " + fmtMin(b.minutes) });
    cb.checked = !!b.done;
    cb.addEventListener("change", function () { b.done = cb.checked; save(); renderPlan(); });
    var editBtn = h("button", { type: "button", class: "link", text: "고치기", "aria-label": title + " 고치기" });
    var row = h("div", { class: "block-row" }, [
      h("label", { class: "check" }, [cb, h("span", { class: "title", text: title })]),
      h("span", { class: "mins", text: fmtMin(b.minutes) }),
      late[b.taskId] ? h("span", { class: "late", text: "마감 " + late[b.taskId] + "일 초과" }) : null,
      editBtn
    ]);
    var li = h("li", { class: "block" + (b.done ? " done" : "") }, [row]);

    editBtn.addEventListener("click", function () {
      if (li.querySelector(".edit-row")) return;
      var d = h("input", { type: "date", value: b.date, "aria-label": "옮길 날짜" });
      var m = h("input", { type: "number", min: "5", step: "5", value: String(b.minutes), "aria-label": "시간(분)", inputmode: "numeric" });
      var ok = h("button", { type: "button", class: "btn", text: "저장" });
      var no = h("button", { type: "button", class: "btn secondary", text: "취소" });
      var edit = h("div", { class: "edit-row" }, [
        h("div", {}, [h("label", { class: "small-label", text: "날짜" }), d]),
        h("div", {}, [h("label", { class: "small-label", text: "시간(분)" }), m]),
        h("div", { class: "btns" }, [ok, no])
      ]);
      no.addEventListener("click", function () { renderPlan(); });
      ok.addEventListener("click", function () {
        var nm = roundStep(m.value);
        if (!d.value || nm < S.STEP) return;
        var task = state.tasks.filter(function (t) { return t.id === b.taskId; })[0];
        if (task) task.minutes = Math.max(S.STEP, task.minutes + (nm - b.minutes));
        b.date = d.value;
        b.minutes = nm;
        save();
        renderPlan();
      });
      li.appendChild(edit);
      d.focus();
    });
    return li;
  }

  // ---------- 일정표의 버튼 ----------
  function onMiss() {
    confirmDialog("오늘 못 한 일을 내일부터 다시 배치할까요?", "다시 배치").then(function (ok) {
      if (!ok) return;
      try {
        state.plan = S.reschedule(state.plan, state.tasks, state.settings, S.addDays(todayStr(), 1));
      } catch (e) {
        showNotice("일정을 만들지 못했어요. 입력을 확인해 주세요");
        return;
      }
      showNotice("");
      save();
      renderPlan();
    });
  }

  function onSwitch() {
    confirmDialog("완료한 일은 그대로 두고 남은 일을 새 방식으로 다시 배치해요", "비교 화면으로").then(function (ok) {
      if (!ok) return;
      try {
        state.settings.today = todayStr();
        compareResult = {
          catchup: S.reschedule({ method: "catchup", blocks: state.plan.blocks }, state.tasks, state.settings, state.settings.today),
          fit: S.reschedule({ method: "fit", blocks: state.plan.blocks }, state.tasks, state.settings, state.settings.today)
        };
      } catch (e) {
        showNotice("일정을 만들지 못했어요. 입력을 확인해 주세요");
        return;
      }
      if (compareResult.catchup.summary.totalMinutes === 0) {
        showNotice("남은 일이 없어요");
        return;
      }
      showNotice("");
      compareSource = "plan";
      renderCompare();
      show("compare");
    });
  }

  function onReset() {
    confirmDialog("저장된 일정표가 지워져요. 새로 시작할까요?", "지우고 시작").then(function (ok) {
      if (!ok) return;
      wipe();
      state = emptyState();
      storageOk = true;
      showNotice("");
      $("taskText").value = "";
      renderInput();
      show("input");
    });
  }

  function onCompareBack() {
    if (compareSource === "plan") { renderPlan(); show("plan"); }
    else { renderInput(); show("input"); }
  }

  // ---------- 시작 ----------
  function init() {
    var saved = load();
    if (saved) state = saved;
    if (!storageOk) showNotice("이 브라우저에서는 저장되지 않아요");

    $("addBtn").addEventListener("click", addFromText);
    $("taskText").addEventListener("input", updateSubmit);
    $("finalDeadline").addEventListener("input", function () { readSettings(); updateSubmit(); save(); });
    $("weekdayMin").addEventListener("change", saveDraft);
    $("weekendMin").addEventListener("change", saveDraft);
    $("submitBtn").addEventListener("click", onSubmit);
    $("compareBack").addEventListener("click", onCompareBack);
    $("missBtn").addEventListener("click", onMiss);
    $("switchBtn").addEventListener("click", onSwitch);
    $("resetBtn").addEventListener("click", onReset);

    if (state.plan && state.settings) {
      renderPlan();
      show("plan");
    } else {
      renderInput();
      show("input");
    }
  }

  init();
})();
