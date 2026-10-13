/* 작심삼일 화면 동작과 저장. 계산은 scheduler.js를 부른다. (spec 3번, 6번) */
(function () {
  "use strict";
  var S = window.Scheduler;

  var KEY = "jaksim.v2";
  var OLD_KEY = "jaksim.v1";
  var VERSION = 2;
  var MAX_TASKS = 50;
  var DEFAULT_DEADLINE_DAYS = 7;
  var MAX_DEADLINE_DAYS = 365;
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  var FULLDAY = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  var state = emptyState();
  var storageOk = true;
  var idCounter = 0;
  var cals = { pv: { month: null, sel: null }, pl: { month: null, sel: null } };
  var openPanel = null; // { id, kind: "move" | "split" }
  var splitDraft = null; // { id, pieces: [{date, amount}] }

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
  function taskOf(id) {
    return state.tasks.filter(function (t) { return t.id === id; })[0];
  }
  function fmtAmt(b) {
    var t = taskOf(b.taskId);
    return b.amount + (t ? t.unit : "");
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

  // ---------- 저장 (spec 4-4) ----------
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
    try { window.localStorage.removeItem(KEY); window.localStorage.removeItem(OLD_KEY); } catch (e) { /* 저장소를 못 써도 화면은 계속 동작한다 */ }
  }

  // ---------- 화면 전환 ----------
  function show(name) {
    ["input", "preview", "plan"].forEach(function (n) { $("screen-" + n).hidden = n !== name; });
    var head = $("h-" + name);
    window.scrollTo(0, 0);
    if (head) head.focus();
  }

  // ---------- 입력 화면 ----------
  function ensureSettings() {
    if (!state.settings) {
      state.settings = { finalDeadline: S.addDays(todayStr(), DEFAULT_DEADLINE_DAYS) };
    }
  }

  function renderInput() {
    ensureSettings();
    $("finalDeadline").min = todayStr();
    $("finalDeadline").max = S.addDays(todayStr(), MAX_DEADLINE_DAYS);
    $("finalDeadline").value = state.settings.finalDeadline;
    renderTaskList();
    updateSubmit();
  }

  function renderTaskList() {
    var ul = $("taskList");
    clear(ul);
    $("emptyMsg").hidden = state.tasks.length > 0;
    state.tasks.forEach(function (task, idx) {
      var li;
      var title = h("input", { type: "text", value: task.title, "aria-label": "일 제목" });
      title.addEventListener("input", function () { task.title = title.value; saveDraft(); updateSubmit(); });
      var amt = h("input", { type: "number", min: "0", step: "1", value: String(task.amount), "aria-label": "분량", inputmode: "numeric" });
      amt.addEventListener("change", function () {
        var v = parseInt(amt.value, 10);
        task.amount = v > 0 ? v : 0;
        amt.value = String(task.amount);
        li.classList.toggle("zero", task.amount === 0);
        saveDraft(); updateSubmit();
      });
      var unit = h("input", { type: "text", value: task.unit, maxlength: "6", "aria-label": "분량 단위(쪽, 회 등)" });
      unit.addEventListener("input", function () { task.unit = unit.value.trim(); saveDraft(); });
      var del = h("button", { type: "button", class: "del", text: "지우기", "aria-label": (task.title || "이 일") + " 지우기" });
      del.addEventListener("click", function () {
        state.tasks.splice(idx, 1);
        saveDraft(); renderTaskList(); updateSubmit();
      });
      var dl = h("input", { type: "date", min: todayStr(), "aria-label": "이 일만의 마감일", value: task.deadline || "" });
      dl.addEventListener("change", function () { task.deadline = dl.value || null; saveDraft(); });
      li = h("li", { class: task.amount === 0 ? "zero" : "" }, [
        h("div", { class: "task-row" }, [title, amt, unit, del]),
        h("details", { class: "more" }, [
          h("summary", { text: "이 일만의 마감일" }),
          h("div", { class: "more-body" }, [
            h("div", {}, [h("label", { class: "small-label", text: "마감일(비우면 전체 마감일)" }), dl])
          ])
        ])
      ]);
      if (task.amount === 0) li.appendChild(h("p", { class: "hint", text: "분량이 0이라 일정에 넣지 않아요" }));
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
    var t = todayStr();
    if (!v || v < t) return "마감일은 오늘 이후로 정해 주세요";
    if (v > S.addDays(t, MAX_DEADLINE_DAYS)) return "마감일은 오늘부터 " + MAX_DEADLINE_DAYS + "일 안으로 정해 주세요";
    return "";
  }

  function updateSubmit() {
    var hasTasks = state.tasks.length > 0 || parsedFromText().length > 0;
    var bad = deadlineProblem();
    $("deadlineError").textContent = bad;
    $("deadlineError").hidden = !bad;
    $("submitBtn").disabled = !hasTasks || !!bad;
  }

  function onSubmit() {
    addFromText();
    readSettings();
    var usable = state.tasks.filter(function (t) { return t.title.trim() && t.amount > 0; });
    var err = $("inputError");
    if (!usable.length) {
      err.textContent = "분량이 1 이상인 일을 하나 이상 적어 주세요";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    state.tasks = state.tasks.filter(function (t) { return t.title.trim(); });
    state.tasks.forEach(function (t) { if (!t.unit) t.unit = "개"; });
    showNotice("");
    try {
      state.plan = S.buildPlan(state.tasks, state.settings, todayStr());
    } catch (e) {
      err.textContent = "일정을 만들지 못했어요. 입력을 확인해 주세요";
      err.hidden = false;
      return;
    }
    cals.pv.month = null; cals.pv.sel = null;
    save();
    renderPreview();
    show("preview");
  }

  // ---------- 달력 (spec 6-5) ----------
  function mountCalendar(prefix, box) {
    box.appendChild(h("div", { class: "calendar" }, [
      h("div", { class: "cal-nav" }, [
        h("button", { type: "button", id: prefix + "Prev", class: "btn secondary", "aria-label": "이전 달", text: "‹" }),
        h("span", { id: prefix + "Title", class: "cal-title", "aria-live": "polite" }),
        h("button", { type: "button", id: prefix + "Next", class: "btn secondary", "aria-label": "다음 달", text: "›" })
      ]),
      h("div", { id: prefix + "Grid", class: "cal-grid" }),
      h("div", { class: "cal-legend", "aria-hidden": "true" }, [
        h("span", { class: "lg open", text: "할 일" }),
        h("span", { class: "lg all-done", text: "한 일" }),
        h("span", { class: "lg today", text: "오늘" }),
        h("span", { class: "lg edited", text: "수정됨" })
      ]),
      h("p", { id: prefix + "Hint", class: "hint", role: "status", hidden: true })
    ]));
    $(prefix + "Prev").addEventListener("click", function () { moveMonth(prefix, -1); });
    $(prefix + "Next").addEventListener("click", function () { moveMonth(prefix, 1); });
  }

  function moveMonth(prefix, delta) {
    var c = cals[prefix];
    var p = c.month.split("-");
    var n = (+p[0]) * 12 + (+p[1] - 1) + delta;
    c.month = Math.floor(n / 12) + "-" + pad((n % 12) + 1);
    rerender();
    $(prefix + (delta < 0 ? "Prev" : "Next")).focus();
  }

  function rerender() {
    if (state.plan && state.plan.status === "draft") renderPreview(); else renderPlan();
  }

  function renderCalendar(prefix, blocks, today) {
    var c = cals[prefix];
    if (!c.month) c.month = (c.sel || today).slice(0, 7);
    var by = {};
    blocks.forEach(function (b) { (by[b.date] = by[b.date] || []).push(b); });
    var p = c.month.split("-");
    var y = +p[0], m = +p[1];
    $(prefix + "Title").textContent = y + "년 " + m + "월";
    var firstW = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();

    var grid = $(prefix + "Grid");
    clear(grid);
    WEEK.forEach(function (w, i) {
      grid.appendChild(h("span", { class: "cal-wd" + (i === 0 ? " sun" : ""), text: w, "aria-hidden": "true" }));
    });
    for (var i = 0; i < firstW; i++) grid.appendChild(h("span", { class: "cal-empty", "aria-hidden": "true" }));
    for (var d = 1; d <= dim; d++) {
      (function (day) {
        var date = y + "-" + pad(m) + "-" + pad(day);
        var items = by[date] || [];
        var undone = items.filter(function (b) { return !b.done; }).length;
        var edited = items.some(function (b) { return b.edited; });
        var cls = "cal-cell" + (items.length ? (undone ? " open" : " all-done") : "") +
          (date === today ? " today" : "") + (date === c.sel ? " sel" : "") + (edited ? " has-edit" : "");
        var label = m + "월 " + day + "일 " + FULLDAY[(firstW + day - 1) % 7];
        if (date === today) label += ", 오늘";
        label += items.length
          ? ", " + (undone ? "할 일 " + undone + "건" : "완료") + (edited ? ", 수정됨 포함" : "")
          : ", 일정 없음";
        var btn = h("button", { type: "button", class: cls, id: prefix + "-cal-" + date, "aria-pressed": date === c.sel ? "true" : "false", "aria-label": label }, [
          h("span", { class: "num", text: String(day) }),
          items.length ? h("span", { class: "chip", text: items.length + "건" }) : null,
          edited ? h("span", { class: "dot", "aria-hidden": "true" }) : null
        ]);
        btn.addEventListener("click", function () { pickDate(prefix, date, items, today); });
        grid.appendChild(btn);
      })(d);
    }
  }

  // 달력의 날짜를 누르면 아래 목록의 그날 묶음으로 옮겨 간다
  function pickDate(prefix, date, items, today) {
    cals[prefix].sel = date;
    rerender();
    var hint = $(prefix + "Hint");
    if (!items.length) {
      hint.textContent = fmtDate(date) + "은 일정이 없어요";
      hint.hidden = false;
      var cell = $(prefix + "-cal-" + date);
      if (cell) cell.focus();
      return;
    }
    hint.hidden = true;
    var undone = items.some(function (b) { return !b.done; });
    var group = $(prefix + "-day-" + date);
    if (!group && date < today && undone) group = $("pl-overdue");
    if (!group) return;
    var past = group.closest("details.past");
    if (past) past.open = true;
    var head = group.querySelector("h3");
    if (head) { head.setAttribute("tabindex", "-1"); head.focus(); }
    group.scrollIntoView({ block: "start" });
  }

  // ---------- 일 줄 (spec 6-3, 6-4) ----------
  function groupByDate(blocks) {
    var sorted = blocks.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); });
    var groups = [];
    sorted.forEach(function (b) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== b.date) { g = { date: b.date, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    return groups;
  }

  function dayEl(g, ctx) {
    var head = h("h3", {}, [
      fmtDate(g.date),
      g.date === ctx.today ? h("span", { class: "tag", text: "오늘" }) : null
    ]);
    var ul = h("ul", { class: "blocks" });
    g.items.forEach(function (b) { ul.appendChild(blockEl(b, ctx)); });
    var cal = cals[ctx.prefix];
    return h("section", { id: ctx.prefix + "-day-" + g.date, class: "day" + (g.date === ctx.today ? " today" : "") + (g.date === cal.sel ? " sel" : "") }, [head, ul]);
  }

  function blockEl(b, ctx) {
    var task = taskOf(b.taskId);
    var title = task ? task.title : "(이름 없는 일)";
    var late = S.lateDays(b, task, state.settings.finalDeadline, state.plan.startDate);
    var lead;
    if (ctx.draft) {
      lead = h("span", { class: "check" }, [h("span", { class: "title", text: title })]);
    } else {
      var cb = h("input", { type: "checkbox", "aria-label": title + " " + fmtDate(b.date) + " " + fmtAmt(b) });
      cb.checked = !!b.done;
      cb.addEventListener("change", function () { b.done = cb.checked; save(); renderPlan(); });
      lead = h("label", { class: "check" }, [cb, h("span", { class: "title", text: title })]);
    }
    var editBtn = h("button", { type: "button", class: "link", text: "고치기", "aria-label": title + " 고치기" });
    var row = h("div", { class: "block-row" }, [
      lead,
      h("span", { class: "mins", text: fmtAmt(b) }),
      b.edited ? h("span", { class: "edited-tag", text: "수정됨" }) : null,
      late ? h("span", { class: "late", text: "마감 " + late + "일 초과" }) : null,
      ctx.overdue ? null : editBtn
    ]);
    var li = h("li", { class: "block" + (b.done ? " done" : "") }, [row]);
    if (ctx.overdue) return li;

    editBtn.addEventListener("click", function () {
      if (li.querySelector(".edit-row")) return;
      var d = h("input", { type: "date", value: b.date, min: ctx.today, "aria-label": "옮길 날짜" });
      var m = h("input", { type: "number", min: "1", step: "1", value: String(b.amount), "aria-label": "분량", inputmode: "numeric" });
      var ok = h("button", { type: "button", class: "btn", text: "저장" });
      var no = h("button", { type: "button", class: "btn secondary", text: "취소" });
      var edit = h("div", { class: "edit-row" }, [
        h("div", {}, [h("label", { class: "small-label", text: "날짜" }), d]),
        h("div", {}, [h("label", { class: "small-label", text: "분량" + (task && task.unit ? "(" + task.unit + ")" : "") }), m]),
        h("div", { class: "btns" }, [ok, no])
      ]);
      no.addEventListener("click", function () { ctx.rerender(); });
      ok.addEventListener("click", function () {
        var nm = parseInt(m.value, 10);
        if (!d.value || !(nm >= 1)) return;
        if (d.value < ctx.today && d.value !== b.date) return;
        var changed = d.value !== b.date || nm !== b.amount;
        if (task) task.amount = Math.max(1, task.amount + (nm - b.amount));
        b.amount = nm;
        if (changed && !ctx.draft) b.edited = true;
        state.plan.blocks = S.moveBlock(state.plan.blocks, b.id, d.value, !ctx.draft && changed);
        if (ctx.draft && changed) state.plan.dirty = true;
        save();
        ctx.rerender();
      });
      li.appendChild(edit);
      d.focus();
    });
    return li;
  }

  // ---------- 미리보기 화면 (spec 6-3) ----------
  function renderPreview() {
    var plan = state.plan;
    var today = todayStr();
    var blocks = plan.blocks;
    var last = blocks.reduce(function (mx, b) { return b.date > mx ? b.date : mx; }, plan.startDate);
    $("pvMeta").textContent = fmtDate(plan.startDate) + "부터 " + fmtDate(last) + "까지 나눈 일정이에요. 고칠 곳이 있으면 고친 뒤 확정해 주세요.";
    renderCalendar("pv", blocks, today);
    var ctx = { draft: true, prefix: "pv", today: today, rerender: renderPreview };
    var box = $("pvDays");
    clear(box);
    groupByDate(blocks).forEach(function (g) { box.appendChild(dayEl(g, ctx)); });
  }

  function onConfirm() {
    state.plan.status = "confirmed";
    delete state.plan.dirty;
    if (!state.createdAt) state.createdAt = new Date().toISOString();
    cals.pl.month = null; cals.pl.sel = null;
    openPanel = null; splitDraft = null;
    save();
    renderPlan();
    show("plan");
  }

  function onPreviewBack() {
    function go() {
      state.plan = null;
      save();
      renderInput();
      show("input");
    }
    if (state.plan && state.plan.dirty) {
      confirmDialog("고친 내용이 사라져요. 입력 화면으로 갈까요?", "입력 화면으로").then(function (ok) { if (ok) go(); });
    } else go();
  }

  // ---------- 일정표 화면 (spec 6-4) ----------
  function renderPlan() {
    var plan = state.plan;
    var today = todayStr();
    var blocks = plan.blocks;
    var st = S.todayStatus(blocks, today);
    var undone = blocks.filter(function (b) { return !b.done; });
    var lastUndone = undone.reduce(function (mx, b) { return b.date > mx ? b.date : mx; }, "");
    $("planMeta").textContent = lastUndone ? "끝나는 날 " + fmtDate(lastUndone) : "";

    var msg = $("doneMsg");
    if (st.allDone) { $("doneText").textContent = "모든 일을 마쳤어요"; msg.hidden = false; }
    else if (st.todayDone) { $("doneText").textContent = "오늘 몫을 마쳤어요"; msg.hidden = false; }
    else msg.hidden = true;

    var ctx = { draft: false, prefix: "pl", today: today, rerender: renderPlan };

    // 오늘 할 일
    var tbox = $("todayBox");
    clear(tbox);
    var todayItems = blocks.filter(function (b) { return b.date === today; });
    var thead = h("h3", {}, [
      "오늘 · " + fmtDate(today),
      h("span", { class: "total", text: st.total ? st.done + " / " + st.total + " 완료" : "" })
    ]);
    var tsec = h("section", { id: "pl-day-" + today, class: "day today" + (cals.pl.sel === today ? " sel" : "") }, [thead]);
    if (todayItems.length) {
      var ul = h("ul", { class: "blocks" });
      todayItems.forEach(function (b) { ul.appendChild(blockEl(b, ctx)); });
      tsec.appendChild(ul);
    } else {
      tsec.appendChild(h("p", { class: "hint", text: "오늘 할 일은 없어요" }));
    }
    tbox.appendChild(tsec);

    // 밀린 일
    renderOverdue(blocks, today);

    renderCalendar("pl", blocks, today);

    // 앞으로 일정과 지난 날짜
    var up = $("upcoming");
    clear(up);
    var groups = groupByDate(blocks);
    var future = groups.filter(function (g) { return g.date > today; });
    var pastDone = groupByDate(blocks.filter(function (b) { return b.date < today && b.done; }));
    if (future.length) {
      up.appendChild(h("h3", { class: "sec", text: "앞으로 일정" }));
      future.forEach(function (g) { up.appendChild(dayEl(g, ctx)); });
    }
    if (pastDone.length) {
      var pd = h("details", { class: "past" }, [h("summary", { text: "지난 날짜에 끝낸 일 (" + pastDone.length + "일)" })]);
      pastDone.forEach(function (g) { pd.appendChild(dayEl(g, ctx)); });
      up.appendChild(pd);
    }
  }

  function renderOverdue(blocks, today) {
    var box = $("overdueBox");
    clear(box);
    var list = S.overdueBlocks(blocks, today);
    if (!list.length) { openPanel = null; splitDraft = null; return; }
    var sec = h("section", { id: "pl-overdue", class: "overdue" }, [
      h("h3", { text: "밀린 일 (" + list.length + ")" }),
      h("p", { class: "hint", text: "오늘 전에 끝내지 못한 일이에요. 어떻게 할지 골라 주세요." })
    ]);
    var ul = h("ul", { class: "blocks" });
    list.forEach(function (b) {
      var task = taskOf(b.taskId);
      var li = blockEl(b, { draft: false, prefix: "pl", today: today, overdue: true, rerender: renderPlan });
      li.querySelector(".block-row").appendChild(h("span", { class: "from", text: fmtDate(b.date) + " 몫" }));
      var proposal = S.splitProposal(b, task, state.settings.finalDeadline, today, state.plan.startDate);
      var moveBtn = h("button", { type: "button", class: "btn secondary", text: "다른 날로 옮기기", "aria-label": (task ? task.title : "이 일") + " 다른 날로 옮기기" });
      var splitBtn = h("button", { type: "button", class: "btn secondary", text: "쪼개서 나누기", "aria-label": (task ? task.title : "이 일") + " 쪼개서 나누기" });
      if (!proposal.ok) splitBtn.disabled = true;
      var acts = h("div", { class: "overdue-actions" }, [moveBtn, splitBtn]);
      li.appendChild(acts);
      if (!proposal.ok) {
        var why = proposal.reason === "tooSmall" ? "분량이 1이라 더 나눌 수 없어요. 다른 날로 옮겨 주세요."
          : proposal.reason === "noDays" ? "마감일이 지나서 나눌 날이 없어요. 다른 날로 옮겨 주세요."
          : "나눌 수 있는 날이 하루뿐이에요. 다른 날로 옮겨 주세요.";
        li.appendChild(h("p", { class: "hint", text: why }));
      }
      moveBtn.addEventListener("click", function () { openPanel = { id: b.id, kind: "move" }; splitDraft = null; renderPlan(); var d = $("moveDate"); if (d) d.focus(); });
      splitBtn.addEventListener("click", function () {
        openPanel = { id: b.id, kind: "split" };
        splitDraft = { id: b.id, pieces: proposal.pieces.map(function (p) { return { date: p.date, amount: p.amount }; }) };
        renderPlan();
        var first = $("splitAmt0"); if (first) first.focus();
      });
      if (openPanel && openPanel.id === b.id) {
        li.appendChild(openPanel.kind === "move" ? movePanel(b, today) : splitPanel(b, today));
      }
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    box.appendChild(sec);
  }

  function movePanel(b, today) {
    var d = h("input", { type: "date", id: "moveDate", min: today, value: today, "aria-label": "옮길 날짜" });
    var ok = h("button", { type: "button", class: "btn", text: "옮기기" });
    var no = h("button", { type: "button", class: "btn secondary", text: "취소" });
    ok.addEventListener("click", function () {
      if (!d.value || d.value < today) return;
      state.plan.blocks = S.moveBlock(state.plan.blocks, b.id, d.value, true);
      openPanel = null;
      save();
      renderPlan();
    });
    no.addEventListener("click", function () { openPanel = null; renderPlan(); });
    return h("div", { class: "panel" }, [
      h("label", { class: "small-label", for: "moveDate", text: "옮길 날짜" }), d,
      h("div", { class: "btns" }, [ok, no])
    ]);
  }

  function splitPanel(b, today) {
    var task = taskOf(b.taskId);
    var unit = task ? task.unit : "";
    var rows = h("div", { class: "split-rows" });
    var sumEl = h("p", { class: "sum", role: "status" });
    var ok = h("button", { type: "button", class: "btn", text: "이대로 나누기" });
    var no = h("button", { type: "button", class: "btn secondary", text: "취소" });
    function refresh() {
      var sum = splitDraft.pieces.reduce(function (s2, p) { return s2 + p.amount; }, 0);
      sumEl.textContent = "합계 " + sum + " / " + b.amount + unit + (sum === b.amount ? "" : " (합이 같아야 나눌 수 있어요)");
      ok.disabled = sum !== b.amount;
    }
    splitDraft.pieces.forEach(function (p, i) {
      var inp = h("input", { type: "number", id: "splitAmt" + i, min: "0", step: "1", value: String(p.amount), inputmode: "numeric", "aria-label": fmtDate(p.date) + " 분량" });
      inp.addEventListener("input", function () {
        var v = parseInt(inp.value, 10);
        p.amount = v > 0 ? v : 0;
        refresh();
      });
      rows.appendChild(h("div", { class: "split-row" }, [h("span", { text: fmtDate(p.date) }), inp, h("span", { class: "u", text: unit })]));
    });
    ok.addEventListener("click", function () {
      var r = S.applySplit(state.plan.blocks, b.id, splitDraft.pieces);
      if (!r.ok) return;
      state.plan.blocks = r.blocks;
      openPanel = null; splitDraft = null;
      save();
      renderPlan();
    });
    no.addEventListener("click", function () { openPanel = null; splitDraft = null; renderPlan(); });
    refresh();
    return h("div", { class: "panel" }, [
      h("p", { class: "small-label", text: "남은 날짜에 이렇게 나눠요. 고칠 수 있어요." }),
      rows, sumEl, h("div", { class: "btns" }, [ok, no])
    ]);
  }

  function onReset() {
    confirmDialog("저장된 일정표가 지워져요. 새로 시작할까요?", "지우고 시작").then(function (ok) {
      if (!ok) return;
      wipe();
      state = emptyState();
      storageOk = true;
      openPanel = null; splitDraft = null;
      cals.pv.month = cals.pl.month = null; cals.pv.sel = cals.pl.sel = null;
      showNotice("");
      $("taskText").value = "";
      renderInput();
      show("input");
    });
  }

  // ---------- 시작 ----------
  function init() {
    var saved = load();
    if (saved) state = saved;
    if (!storageOk) showNotice("이 브라우저에서는 저장되지 않아요");

    mountCalendar("pv", $("pvCal"));
    mountCalendar("pl", $("plCal"));

    $("addBtn").addEventListener("click", addFromText);
    $("taskText").addEventListener("input", updateSubmit);
    $("finalDeadline").addEventListener("input", function () { readSettings(); updateSubmit(); save(); });
    $("submitBtn").addEventListener("click", onSubmit);
    $("confirmBtn").addEventListener("click", onConfirm);
    $("pvBack").addEventListener("click", onPreviewBack);
    $("resetBtn").addEventListener("click", onReset);

    var plan = state.plan;
    if (plan && state.settings && plan.status === "confirmed") {
      renderPlan();
      show("plan");
    } else if (plan && state.settings && plan.status === "draft") {
      var today = todayStr();
      if (plan.blocks.some(function (b) { return b.date < today; })) {
        state.plan = S.buildPlan(state.tasks, state.settings, today);
        save();
        showNotice("날짜가 바뀌어서 일정을 다시 나눴어요");
      }
      renderPreview();
      show("preview");
    } else {
      renderInput();
      show("input");
    }
  }

  init();
})();
