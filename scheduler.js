/* 작심삼일 계산 로직. 화면 코드 없음. 같은 입력이면 같은 결과가 나온다. (spec 4번, 5번) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scheduler = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var MAX_DAYS = 366;
  var MAX_TITLE_UNIT = 6;

  // ---------- 날짜 도구 (시간대 영향을 받지 않도록 UTC 기준으로 계산) ----------
  function toDayNumber(dateStr) {
    var p = dateStr.split("-");
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function fromDayNumber(n) {
    var d = new Date(n * 86400000);
    var m = String(d.getUTCMonth() + 1).padStart(2, "0");
    var day = String(d.getUTCDate()).padStart(2, "0");
    return d.getUTCFullYear() + "-" + m + "-" + day;
  }
  function addDays(dateStr, n) { return fromDayNumber(toDayNumber(dateStr) + n); }
  function daysBetween(a, b) { return toDayNumber(b) - toDayNumber(a); }

  // ---------- 입력 해석 (spec 4-2) ----------
  function parseTaskLines(text) {
    var tasks = [];
    var re = new RegExp("^(.*\\S)\\s+(\\d+)\\s*([가-힣A-Za-z]{0,%d})$".replace("%d", MAX_TITLE_UNIT));
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(re);
      var title = line, amount = 1, unit = "회";
      if (m) {
        title = m[1];
        amount = parseInt(m[2], 10);
        unit = m[3] || "개";
      }
      tasks.push({ id: "t" + (tasks.length + 1), title: title, amount: amount, unit: unit, deadline: null });
    });
    return tasks;
  }

  // ---------- 나누기 (spec 5-1, 5-2) ----------
  // base는 일정을 만든 날이다. 일마다의 마감일이 base 이후일 때만 쓴다.
  // 일정을 만든 뒤 시간이 지나 그 날짜를 넘겨도 마감일은 그대로다.
  function effectiveDeadline(task, finalDeadline, base) {
    if (task.deadline && task.deadline >= base) return task.deadline;
    return finalDeadline;
  }
  function availableDays(today, deadline) {
    var n = daysBetween(today, deadline) + 1;
    if (n < 1) return 0;
    return Math.min(n, MAX_DAYS);
  }
  // amount를 days일에 고르게 나눈다. 남는 분량은 앞날에 하나씩 더 놓는다.
  function distribute(amount, days) {
    if (days < 1) return [];
    var q = Math.floor(amount / days), r = amount % days, out = [];
    for (var i = 0; i < days; i++) out.push(q + (i < r ? 1 : 0));
    return out;
  }
  function uniqueId(blocks, base) {
    var ids = {};
    blocks.forEach(function (b) { ids[b.id] = true; });
    if (!ids[base]) return base;
    var n = 2;
    while (ids[base + "_" + n]) n++;
    return base + "_" + n;
  }
  function buildPlan(tasks, settings, today) {
    var blocks = [];
    tasks.forEach(function (t) {
      if (!(t.amount > 0)) return;
      var dl = effectiveDeadline(t, settings.finalDeadline, today);
      var days = availableDays(today, dl);
      distribute(t.amount, days).forEach(function (a, i) {
        if (a > 0) {
          var date = addDays(today, i);
          blocks.push({ id: uniqueId(blocks, t.id + "_" + date), taskId: t.id, date: date, amount: a, done: false, edited: false });
        }
      });
    });
    return { status: "draft", startDate: today, blocks: blocks };
  }

  // ---------- 블록 고치기 (spec 5-3, 5-5) ----------
  function cloneBlocks(blocks) { return blocks.map(function (b) { return Object.assign({}, b); }); }

  // 블록을 다른 날로 옮긴다. 같은 일의 미완료 블록이 그 날에 있으면 합친다.
  function moveBlock(blocks, blockId, newDate, markEdited) {
    var out = cloneBlocks(blocks);
    var src = out.filter(function (b) { return b.id === blockId; })[0];
    if (!src) return out;
    if (src.date === newDate) { if (markEdited) src.edited = true; return out; }
    var target = out.filter(function (b) {
      return b !== src && b.taskId === src.taskId && b.date === newDate && !b.done;
    })[0];
    if (target) {
      target.amount += src.amount;
      if (markEdited) target.edited = true;
      return out.filter(function (b) { return b !== src; });
    }
    src.date = newDate;
    if (markEdited) src.edited = true;
    return out;
  }

  function lateDays(block, task, finalDeadline, base) {
    if (!task) return 0;
    var dl = effectiveDeadline(task, finalDeadline, base);
    return Math.max(0, daysBetween(dl, block.date));
  }

  // ---------- 밀린 일 (spec 5-4) ----------
  function overdueBlocks(blocks, today) {
    return blocks.filter(function (b) { return !b.done && b.date < today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); });
  }

  // 쪼개서 나누기 제안 (spec 5-6). 쓸 수 없으면 reason을 돌려준다.
  function splitProposal(block, task, finalDeadline, today, base) {
    if (block.amount < 2) return { ok: false, reason: "tooSmall" };
    var dl = effectiveDeadline(task, finalDeadline, base || today);
    var days = availableDays(today, dl);
    if (days < 2) return { ok: false, reason: days < 1 ? "noDays" : "oneDay" };
    var pieces = [];
    distribute(block.amount, days).forEach(function (a, i) {
      if (a > 0) pieces.push({ date: addDays(today, i), amount: a });
    });
    return { ok: true, pieces: pieces };
  }

  // 조각을 확정한다. 합이 원래 분량과 같아야 한다. 같은 일의 미완료 블록이 있는 날은 합친다.
  function applySplit(blocks, blockId, pieces) {
    var out = cloneBlocks(blocks);
    var src = out.filter(function (b) { return b.id === blockId; })[0];
    if (!src) return { ok: false, blocks: out };
    var sum = pieces.reduce(function (s, p) { return s + p.amount; }, 0);
    if (sum !== src.amount) return { ok: false, blocks: out };
    out = out.filter(function (b) { return b !== src; });
    pieces.forEach(function (p) {
      if (!(p.amount > 0)) return;
      var target = out.filter(function (b) { return b.taskId === src.taskId && b.date === p.date && !b.done; })[0];
      if (target) { target.amount += p.amount; target.edited = true; }
      else out.push({ id: uniqueId(out, src.taskId + "_" + p.date), taskId: src.taskId, date: p.date, amount: p.amount, done: false, edited: true });
    });
    return { ok: true, blocks: out };
  }

  // ---------- 오늘 몫 (spec 5-4) ----------
  function todayStatus(blocks, today) {
    var tb = blocks.filter(function (b) { return b.date === today; });
    var allDone = blocks.length > 0 && blocks.every(function (b) { return b.done; });
    return {
      total: tb.length,
      done: tb.filter(function (b) { return b.done; }).length,
      todayDone: tb.length > 0 && tb.every(function (b) { return b.done; }),
      allDone: allDone
    };
  }

  return {
    MAX_DAYS: MAX_DAYS,
    addDays: addDays, daysBetween: daysBetween,
    parseTaskLines: parseTaskLines, effectiveDeadline: effectiveDeadline, availableDays: availableDays,
    distribute: distribute, buildPlan: buildPlan, moveBlock: moveBlock, lateDays: lateDays,
    overdueBlocks: overdueBlocks, splitProposal: splitProposal, applySplit: applySplit, todayStatus: todayStatus
  };
});
