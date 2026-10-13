/* 계산 로직 검증. 실행: node scheduler.test.js
   기댓값은 spec 12번의 손계산 값이다. 코드가 낸 값을 옮겨 적지 않았다. */
const S = require("./scheduler.js");
let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.log("실패: " + name + "\n  기대 " + e + "\n  실제 " + a); }
}
const MON = "2026-10-12";
const settings = { finalDeadline: "2026-10-16" };
const task = (id, amount, extra) => Object.assign({ id, title: id, amount, unit: "쪽", deadline: null }, extra || {});
const view = (plan) => plan.blocks.map((b) => b.date.slice(8) + ":" + b.taskId + ":" + b.amount);
const bv = (blocks) => blocks.map((b) => b.date.slice(8) + ":" + b.amount + (b.edited ? "*" : "")).sort();

// 날짜 도구
eq("날짜 더하기", S.addDays("2026-10-31", 1), "2026-11-01");
eq("날짜 차이", S.daysBetween("2026-10-12", "2026-10-16"), 4);
eq("쓸 수 있는 날", S.availableDays(MON, "2026-10-16"), 5);
eq("마감이 오늘", S.availableDays(MON, MON), 1);
eq("마감이 지남", S.availableDays(MON, "2026-10-11"), 0);

// 나누기
eq("분배 6/5일", S.distribute(30, 5), [6, 6, 6, 6, 6]);
eq("분배 3/5일", S.distribute(3, 5), [1, 1, 1, 0, 0]);
eq("분배 7/5일", S.distribute(7, 5), [2, 2, 1, 1, 1]);
eq("분배 날 없음", S.distribute(5, 0), []);

// 사례 1~4
eq("1 나누어떨어짐", view(S.buildPlan([task("A", 30)], settings, MON)), ["12:A:6", "13:A:6", "14:A:6", "15:A:6", "16:A:6"]);
eq("2 분량이 적음", view(S.buildPlan([task("A", 3)], settings, MON)), ["12:A:1", "13:A:1", "14:A:1"]);
eq("3 나머지", view(S.buildPlan([task("A", 7)], settings, MON)), ["12:A:2", "13:A:2", "14:A:1", "15:A:1", "16:A:1"]);
eq("4 일별 마감", view(S.buildPlan([task("A", 4, { deadline: "2026-10-14" })], settings, MON)), ["12:A:2", "13:A:1", "14:A:1"]);
eq("4 일별 마감이 지난 날짜면 전체 마감", view(S.buildPlan([task("A", 5, { deadline: "2026-10-01" })], settings, MON)), ["12:A:1", "13:A:1", "14:A:1", "15:A:1", "16:A:1"]);
eq("plan 상태", S.buildPlan([task("A", 3)], settings, MON).status, "draft");

// 사례 5 입력 해석
{
  const r = S.parseTaskLines("문제집 풀기 30쪽\n토익 LC 3회\n복습 7\n2단원 정리\n수학 2단원\n\n문제집 0쪽");
  eq("5 해석", r.map((t) => [t.title, t.amount, t.unit]), [
    ["문제집 풀기", 30, "쪽"], ["토익 LC", 3, "회"], ["복습", 7, "개"], ["2단원 정리", 1, "회"], ["수학", 2, "단원"], ["문제집", 0, "쪽"]
  ]);
  eq("5 분량 0은 블록 없음", S.buildPlan([r[5]], settings, MON).blocks.length, 0);
}

// 사례 6 다른 날로 옮기기 (오늘 10-14)
{
  const plan = S.buildPlan([task("A", 30)], settings, MON);
  const id12 = plan.blocks[0].id;
  const out = S.moveBlock(plan.blocks, id12, "2026-10-15", true);
  eq("6 옮기기", bv(out), ["13:6", "14:6", "15:12*", "16:6"]);
  eq("6 분량 합 유지", out.reduce((s, b) => s + b.amount, 0), 30);
  const empty = S.moveBlock(plan.blocks, id12, "2026-10-20", true);
  eq("6 빈 날로 옮기기", bv(empty), ["13:6", "14:6", "15:6", "16:6", "20:6*"]);
  const draft = S.moveBlock(plan.blocks, id12, "2026-10-15", false);
  eq("6 미리보기에서는 수정됨 없음", draft.some((b) => b.edited), false);
  eq("6 완료한 블록과는 합치지 않음", bv(S.moveBlock(plan.blocks.map((b) => b.date === "2026-10-15" ? Object.assign({}, b, { done: true }) : b), id12, "2026-10-15", true).filter((b) => b.date === "2026-10-15")), ["15:6", "15:6*"]);
}

// 사례 7 쪼개서 나누기
{
  const TODAY = "2026-10-14";
  const t = task("A", 30);
  const plan = S.buildPlan([t], settings, MON);
  const b12 = plan.blocks[0];
  const prop = S.splitProposal(b12, t, settings.finalDeadline, TODAY);
  eq("7 제안", prop.pieces, [{ date: "2026-10-14", amount: 2 }, { date: "2026-10-15", amount: 2 }, { date: "2026-10-16", amount: 2 }]);
  const done = S.applySplit(plan.blocks, b12.id, prop.pieces);
  eq("7 확정", [done.ok, bv(done.blocks)], [true, ["13:6", "14:8*", "15:8*", "16:8*"]]);
  eq("7 분량 합 유지", done.blocks.reduce((s, b) => s + b.amount, 0), 30);
  const bad = S.applySplit(plan.blocks, b12.id, [{ date: "2026-10-14", amount: 3 }, { date: "2026-10-15", amount: 2 }, { date: "2026-10-16", amount: 2 }]);
  eq("7 합이 다르면 거부", bad.ok, false);
  const skip = S.applySplit(plan.blocks, b12.id, [{ date: "2026-10-14", amount: 4 }, { date: "2026-10-15", amount: 0 }, { date: "2026-10-16", amount: 2 }]);
  eq("7 0은 건너뜀", [skip.ok, bv(skip.blocks)], [true, ["13:6", "14:10*", "15:6", "16:8*"]]);
}

// 사례 8 쪼개기를 쓸 수 없는 경우
{
  const t = task("A", 3, { unit: "회" });
  const plan = S.buildPlan([t], settings, MON);
  eq("8 분량 1", S.splitProposal(plan.blocks[0], t, settings.finalDeadline, "2026-10-14").reason, "tooSmall");
  const t2 = task("B", 10);
  const p2 = S.buildPlan([t2], settings, MON);
  eq("8 하루뿐", S.splitProposal(p2.blocks[0], t2, settings.finalDeadline, "2026-10-16").reason, "oneDay");
  eq("8 마감 지남", S.splitProposal(p2.blocks[0], t2, settings.finalDeadline, "2026-10-17").reason, "noDays");
  const t3 = task("C", 6, { deadline: "2026-10-13" });
  const p3 = S.buildPlan([t3], settings, MON);
  eq("8 일별 마감이 지난 뒤에도 마감은 그대로", S.splitProposal(p3.blocks[0], t3, settings.finalDeadline, "2026-10-14", MON).reason, "noDays");
  eq("8 일별 마감이 지난 뒤의 초과 일수", S.lateDays({ date: "2026-10-15" }, t3, settings.finalDeadline, MON), 2);
}

// 사례 9 경계값
eq("9 일 없음", S.buildPlan([], settings, MON).blocks.length, 0);
eq("9 마감이 오늘", view(S.buildPlan([task("A", 5)], { finalDeadline: MON }, MON)), ["12:A:5"]);

// 사례 10 오늘 몫과 밀린 일
{
  const blocks = [
    { id: "a", taskId: "A", date: "2026-10-12", amount: 1, done: false, edited: false },
    { id: "b", taskId: "A", date: "2026-10-13", amount: 1, done: true, edited: false },
    { id: "c", taskId: "A", date: "2026-10-14", amount: 1, done: true, edited: false },
    { id: "d", taskId: "B", date: "2026-10-14", amount: 1, done: false, edited: false }
  ];
  eq("10 밀린 일", S.overdueBlocks(blocks, "2026-10-14").map((b) => b.id), ["a"]);
  eq("10 오늘 몫 진행", (({ total, done, todayDone }) => [total, done, todayDone])(S.todayStatus(blocks, "2026-10-14")), [2, 1, false]);
  blocks[3].done = true;
  eq("10 오늘 몫 마침", S.todayStatus(blocks, "2026-10-14").todayDone, true);
  eq("10 모든 일은 아직", S.todayStatus(blocks, "2026-10-14").allDone, false);
}

// 마감 초과 일수
{
  const t = task("A", 5, { deadline: "2026-10-14" });
  eq("초과 일수", S.lateDays({ date: "2026-10-16" }, t, "2026-10-20", "2026-10-12"), 2);
  eq("초과 없음", S.lateDays({ date: "2026-10-13" }, t, "2026-10-20", "2026-10-12"), 0);
}

console.log("통과 " + pass + ", 실패 " + fail);
process.exit(fail ? 1 : 0);
