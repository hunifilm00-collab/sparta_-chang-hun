/* 작심삼일 계산 로직. 화면 코드 없음. 같은 입력이면 같은 결과가 나온다. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scheduler = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var STEP = 5;
  var DEFAULT_MINUTES = 30;
  var MAX_DAYS = 60;

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
  function isWeekend(dateStr) {
    var w = new Date(toDayNumber(dateStr) * 86400000).getUTCDay();
    return w === 0 || w === 6;
  }
  function ceilStep(n) { return Math.ceil(n / STEP) * STEP; }

  // ---------- 입력 해석 ----------
  // 한 줄에 "제목 분" 형식. 분이 없으면 기본값을 쓴다.
  function parseTaskLines(text) {
    var tasks = [];
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^(.*\S)\s+(\d+)\s*(?:분|m|min)?$/i);
      var title = line;
      var minutes = DEFAULT_MINUTES;
      if (m) { title = m[1]; minutes = parseInt(m[2], 10); }
      tasks.push({
        id: "t" + (tasks.length + 1),
        title: title,
        minutes: minutes > 0 ? ceilStep(minutes) : 0,
        deadline: null,
        priority: 2
      });
    });
    return tasks;
  }

  function availabilityFor(settings, date) {
    var o = settings.overrides && settings.overrides[date];
    if (typeof o === "number") return Math.max(0, o);
    return Math.max(0, isWeekend(date) ? settings.weekendMinutes : settings.weekdayMinutes);
  }

  function effectiveDeadline(task, settings) {
    return task.deadline || settings.finalDeadline;
  }

  // 마감이 이른 순, 중요도가 높은 순, 입력 순서가 앞선 순
  function sortTasks(tasks, settings) {
    return tasks
      .map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) {
        var da = toDayNumber(effectiveDeadline(a.t, settings));
        var db = toDayNumber(effectiveDeadline(b.t, settings));
        if (da !== db) return da - db;
        var pa = a.t.priority || 2, pb = b.t.priority || 2;
        if (pa !== pb) return pb - pa;
        return a.i - b.i;
      })
      .map(function (x) { return x.t; });
  }

  // ---------- 배치 ----------
  // queue: [{ task, left }] 를 앞에서부터 amount 분만큼 채워 블록으로 만든다.
  function takeFromQueue(queue, amount, date, out) {
    var used = 0;
    while (amount > 0 && queue.length) {
      var head = queue[0];
      var take = Math.min(head.left, amount);
      out.push({ id: head.task.id + "_" + date, taskId: head.task.id, date: date, minutes: take, done: false });
      head.left -= take;
      amount -= take;
      used += take;
      if (head.left <= 0) queue.shift();
    }
    return used;
  }

  function makeQueue(tasks, settings, remainingByTask) {
    return sortTasks(tasks, settings)
      .map(function (t) {
        var left = remainingByTask ? remainingByTask[t.id] : t.minutes;
        return { task: t, left: left || 0 };
      })
      .filter(function (q) { return q.left > 0; });
  }

  function planCatchup(tasks, settings, startDate, remainingByTask) {
    var queue = makeQueue(tasks, settings, remainingByTask);
    var total = queue.reduce(function (s, q) { return s + q.left; }, 0);
    var blocks = [];
    var days = Math.max(1, daysBetween(startDate, settings.finalDeadline) + 1);
    var perDay = total > 0 ? ceilStep(total / days) : 0;
    var date = startDate;
    var guard = 0;
    while (queue.length && guard < 400) {
      takeFromQueue(queue, perDay, date, blocks);
      date = addDays(date, 1);
      guard++;
    }
    return { blocks: blocks, total: total, unplaced: 0, perDay: perDay };
  }

  function planFit(tasks, settings, startDate, remainingByTask) {
    var queue = makeQueue(tasks, settings, remainingByTask);
    var total = queue.reduce(function (s, q) { return s + q.left; }, 0);
    var blocks = [];
    for (var i = 0; i < MAX_DAYS && queue.length; i++) {
      var date = addDays(startDate, i);
      var avail = availabilityFor(settings, date);
      if (avail > 0) takeFromQueue(queue, avail, date, blocks);
    }
    var unplaced = queue.reduce(function (s, q) { return s + q.left; }, 0);
    return { blocks: blocks, total: total, unplaced: unplaced, perDay: null };
  }

  // ---------- 요약 ----------
  // 일마다 마지막 블록의 날짜가 마감을 넘기면 넘긴 일수를 돌려준다. 완료한 블록도 포함한다.
  function lateTasksOf(blocks, tasks, settings) {
    var lastByTask = {};
    blocks.forEach(function (b) {
      if (!lastByTask[b.taskId] || toDayNumber(b.date) > toDayNumber(lastByTask[b.taskId])) lastByTask[b.taskId] = b.date;
    });
    var late = [];
    tasks.forEach(function (t) {
      var last = lastByTask[t.id];
      if (!last) return;
      var days = daysBetween(effectiveDeadline(t, settings), last);
      if (days > 0) late.push({ taskId: t.id, lateDays: days });
    });
    return late;
  }

  function summarize(method, raw, tasks, settings, startDate, keptBlocks) {
    var all = (keptBlocks || []).concat(raw.blocks);
    var byDate = {};
    raw.blocks.forEach(function (b) { byDate[b.date] = (byDate[b.date] || 0) + b.minutes; });
    var overDays = 0, overMinutes = 0;
    Object.keys(byDate).forEach(function (d) {
      var excess = byDate[d] - availabilityFor(settings, d);
      if (excess > 0) { overDays++; overMinutes += excess; }
    });
    var lateTasks = lateTasksOf(all, tasks, settings);
    var dates = raw.blocks.map(function (b) { return b.date; }).sort();
    var endDate = dates.length ? dates[dates.length - 1] : null;
    var avgPerDay = 0;
    if (raw.total > 0) {
      if (method === "catchup") avgPerDay = raw.perDay;
      else if (endDate) avgPerDay = ceilStep(raw.total / (daysBetween(startDate, endDate) + 1));
    }
    return {
      method: method,
      totalMinutes: raw.total,
      avgPerDay: avgPerDay,
      overDays: overDays,
      overMinutes: overMinutes,
      lateTasks: lateTasks,
      lateCount: lateTasks.length,
      unplacedMinutes: raw.unplaced,
      endDate: endDate
    };
  }

  function validMethod(m) {
    if (m !== "catchup" && m !== "fit") throw new Error("알 수 없는 방식: " + m);
  }

  // 처음부터 배치한다.
  function buildPlan(tasks, settings, method) {
    validMethod(method);
    var start = settings.today;
    var raw = method === "catchup" ? planCatchup(tasks, settings, start) : planFit(tasks, settings, start);
    return { method: method, startDate: start, blocks: raw.blocks, summary: summarize(method, raw, tasks, settings, start, []) };
  }

  // 두 방식을 한 번에 계산한다. 비교 화면에서 쓴다.
  function compare(tasks, settings) {
    return { catchup: buildPlan(tasks, settings, "catchup"), fit: buildPlan(tasks, settings, "fit") };
  }

  // 완료한 블록은 두고 남은 분량을 startDate부터 다시 배치한다.
  function reschedule(plan, tasks, settings, startDate) {
    var kept = plan.blocks.filter(function (b) { return b.done; });
    var remaining = {};
    tasks.forEach(function (t) { remaining[t.id] = t.minutes; });
    kept.forEach(function (b) { remaining[b.taskId] = Math.max(0, (remaining[b.taskId] || 0) - b.minutes); });
    var raw = plan.method === "catchup"
      ? planCatchup(tasks, settings, startDate, remaining)
      : planFit(tasks, settings, startDate, remaining);
    // 같은 날 같은 일의 완료 블록과 id가 겹치지 않게 한다.
    var taken = {};
    kept.forEach(function (b) { taken[b.id] = true; });
    raw.blocks.forEach(function (b) { if (taken[b.id]) b.id = b.id + "_r"; });
    return {
      method: plan.method,
      startDate: startDate,
      blocks: kept.concat(raw.blocks),
      summary: summarize(plan.method, raw, tasks, settings, startDate, kept)
    };
  }

  return {
    STEP: STEP, DEFAULT_MINUTES: DEFAULT_MINUTES, MAX_DAYS: MAX_DAYS,
    addDays: addDays, daysBetween: daysBetween, isWeekend: isWeekend,
    parseTaskLines: parseTaskLines, availabilityFor: availabilityFor,
    sortTasks: sortTasks, lateTasksOf: lateTasksOf, buildPlan: buildPlan, compare: compare, reschedule: reschedule
  };
});
