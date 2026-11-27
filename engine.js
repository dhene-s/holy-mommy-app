import { RULES, TUNING } from "./rules.js";
// Browser port of bot/prikorm/meal_service.py. No Telegram, network or storage calls.
export const CONSENT_VERSION = "pwa-v2-2026-11-27.1";
export const NOTICE =
  "Тестовый материал. Не проверено педиатром. Не использовать как рекомендацию по кормлению";
export const norm = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const split = (s) =>
  String(s ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const today = (zone = "Europe/Moscow", now = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
};
export function addDays(day, n) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function validDate(s) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T12:00Z")) &&
    new Date(s + "T12:00Z").toISOString().startsWith(s)
  );
}
export function months(born, day) {
  if (!validDate(born) || !validDate(day)) return -1;
  const [y, m, d] = day.split("-").map(Number),
    [by, bm, bd] = born.split("-").map(Number);
  return (y - by) * 12 + m - bm - (d < bd ? 1 : 0);
}
export function emptyState() {
  return {
    schema: 2,
    profile: null,
    periods: [],
    menus: {},
    diary: [],
    decisions: {},
    draft: null,
    changes: [],
    ui: {},
  };
}
export function libraryIndex(lib) {
  return new Map([...lib.foods, ...lib.recipes].map((i) => [i.id, i]));
}
export function resolve(lib, text) {
  const all = [...lib.foods, ...lib.recipes],
    q = norm(text);
  if (!q) return [];
  const exact = all.filter((i) => norm(i.name) === q);
  return exact.length ? exact : all.filter((i) => norm(i.name).includes(q));
}
export function ingredients(lib, key) {
  const r = lib.recipes.find((r) => r.id === key);
  return r
    ? r.ingredients.map((i) => i.food_id)
    : lib.foods.some((f) => f.id === key)
      ? [key]
      : [];
}
export function migrate(input) {
  const s = structuredClone(input || emptyState());
  if (s.schema === 2) return s;
  if (s.schema !== 1)
    throw Error(
      "Неизвестная версия данных. Сохраните копию и обратитесь к разработчику.",
    );
  s.schema = 2;
  s.migration = { from: 1, at: new Date().toISOString() };
  if (s.profile) {
    s.profile.app_started_at ||= today(s.profile.zone);
    s.profile.feeding_started_on ||= s.profile.feeding_start_date || null;
    s.profile.start_date_known = Boolean(s.profile.feeding_started_on);
    s.profile.start_date_uncertain_legacy =
      !s.profile.feeding_started_on &&
      s.diary.some((r) => r.status === "offered");
  }
  // V1 "Ввели" did not distinguish offering from eating. Preserve the original evidence as unconfirmed.
  for (const r of s.diary)
    if (r.status === "offered") {
      r.consumption_unknown = true;
      r.legacy_status = "offered";
    }
  for (const p of s.periods) {
    p.legacy_ids = [...p.ids];
    p.ids = p.ids.filter((id) => !/^R\d+$/.test(id));
    p.anchor_pending = !s.profile?.started && !s.profile?.feeding_started_on;
  }
  s.changes.push({ action: "migration_v2", at: new Date().toISOString() });
  return s;
}
export const stage = (f) => f.stage ?? RULES.stages[f.id] ?? 99;
export const allergenGroups = (f) => [
  ...new Set([
    ...(RULES.allergen_groups[f.id] || []),
    ...(f.allergen ? [f.allergen] : []),
  ]),
];
const noReaction = (r) =>
  ["-", "Нет реакции", "нет реакции", ""].includes(r.reaction ?? "-");
const declaredCache = new WeakMap();
function declaredKnown(lib, profile) {
  if (!profile) return new Set();
  let profiles = declaredCache.get(lib);
  if (!profiles) {
    profiles = new WeakMap();
    declaredCache.set(lib, profiles);
  }
  const stamp = JSON.stringify(profile.introduced_names || []),
    old = profiles.get(profile);
  if (old?.stamp === stamp) return old.ids;
  const ids = new Set();
  for (const name of profile.introduced_names || []) {
    const q = norm(name);
    if (!q) continue;
    const exact = lib.foods.filter((f) => norm(f.name) === q),
      matches = exact.length
        ? exact
        : lib.foods.filter((f) => norm(f.name).includes(q));
    if (matches.length === 1) ids.add(matches[0].id);
  }
  profiles.set(profile, { stamp, ids });
  return ids;
}
export function introduction(lib, s, id, asOf = today(s.profile?.zone)) {
  const f = lib.foods.find((f) => f.id === id);
  if (!f) return { status: "unknown", count: 0 };
  if (s.decisions[id] === "excluded") return { status: "excluded", count: 0 };
  if (s.decisions[id] === "pending") return { status: "review", count: 0 };
  if (blocked(lib, s).has(id)) {
    const groups = allergenGroups(f);
    const excluded = Object.entries(s.decisions).some(
      ([other, v]) =>
        v === "excluded" &&
        allergenGroups(
          lib.foods.find((x) => x.id === other) || { id: other },
        ).some((g) => groups.includes(g)),
    );
    const family = (s.profile?.excluded_names || []).some((term) =>
      [f.name, f.category, ...groups].some((v) => norm(v).includes(norm(term))),
    );
    return { status: excluded || family ? "excluded" : "review", count: 0 };
  }
  const declared = declaredKnown(lib, s.profile).has(id);
  const rows = s.diary
    .filter(
      (r) =>
        r.day <= asOf &&
        ["eaten", "offered"].includes(r.status) &&
        !r.consumption_unknown &&
        r.ingredients.includes(id),
    )
    .sort((a, b) => a.day.localeCompare(b.day));
  let streak = 0,
    max = 0,
    last = null;
  for (const d of [...new Set(rows.map((r) => r.day))]) {
    if (rows.some((r) => r.day === d && !noReaction(r))) {
      streak = 0;
      last = d;
      continue;
    }
    streak = last && addDays(last, 1) === d ? streak + 1 : 1;
    max = Math.max(max, streak);
    last = d;
  }
  if (declared || max >= 3)
    return { status: "introduced", count: 3, last, declared };
  const refused = s.diary
    .filter(
      (r) =>
        r.day <= asOf && r.status === "refused" && r.ingredients.includes(id),
    )
    .at(-1);
  if (refused && addDays(refused.day, TUNING.refusal_retry_days) > asOf)
    return {
      status: "deferred",
      count: 0,
      retry: addDays(refused.day, TUNING.refusal_retry_days),
      last,
    };
  const count =
    last && (last === asOf || addDays(last, 1) === asOf)
      ? Math.min(streak, 2)
      : 0;
  if (rows.length) return { status: "introducing", count, last };
  return {
    status: s.periods.some((p) => p.ids.includes(id))
      ? "planned"
      : "not_introduced",
    count: 0,
    last,
  };
}
export function known(lib, s, asOf = today(s.profile?.zone)) {
  const set = new Set(declaredKnown(lib, s.profile));
  const evidence = new Map();
  for (const row of s.diary)
    if (
      row.day <= asOf &&
      ["eaten", "offered"].includes(row.status) &&
      !row.consumption_unknown
    )
      for (const id of row.ingredients) {
        if (!evidence.has(id)) evidence.set(id, new Map());
        const dates = evidence.get(id);
        dates.set(row.day, (dates.get(row.day) ?? true) && noReaction(row));
      }
  for (const [id, dates] of evidence) {
    let previous = null,
      run = 0;
    for (const [date, ok] of [...dates].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      run = ok ? (previous && addDays(previous, 1) === date ? run + 1 : 1) : 0;
      if (run >= 3) set.add(id);
      previous = date;
    }
  }
  const b = blocked(lib, s);
  for (const id of b) set.delete(id);
  return set;
}
export function blocked(lib, s) {
  const ids = new Set(),
    groups = new Set();
  for (const term of s.profile?.excluded_names || []) {
    const q = norm(term);
    if (!q) continue;
    const foods = lib.foods.filter((f) =>
      [f.name, f.category, ...allergenGroups(f)].some((v) =>
        norm(v).includes(q),
      ),
    );
    if (!foods.length) ids.add("__unresolved__");
    foods.forEach((f) => ids.add(f.id));
  }
  for (const [id, decision] of Object.entries(s.decisions || {})) {
    if (decision === "returned") {
      ids.delete(id);
      continue;
    }
    ids.add(id);
    const f = lib.foods.find((f) => f.id === id);
    if (f) allergenGroups(f).forEach((g) => groups.add(g));
  }
  for (const f of lib.foods)
    if (allergenGroups(f).some((g) => groups.has(g))) ids.add(f.id);
  return ids;
}
export function ready(p, day) {
  const age = months(p?.born, day);
  return Boolean(
    p?.consent &&
      p.active &&
      p.ready &&
      age >= 4 &&
      age <= 24 &&
      (age >= 6 || p.early_doctor_confirmed),
  );
}
export function reason(lib, s, day) {
  const p = s.profile;
  if (!p?.consent)
    return "Заполните анкету, чтобы сохранить персональный план.";
  const age = months(p.born, day);
  if (age < 4)
    return "До 4 полных месяцев прикорм не планируется. Пока можно подготовиться.";
  if (age > 24) return "Эта библиотека рассчитана на возраст до 24 месяцев.";
  if (!p.ready)
    return "Готовность пока не подтверждена. Обсудите начало с педиатром.";
  if (age < 6 && !p.early_doctor_confirmed)
    return "В 4–5 месяцев нужно подтвердить согласование раннего начала с педиатром.";
  if (blocked(lib, s).has("__unresolved__"))
    return "Уточните названия исключений в профиле: автоматическое меню приостановлено.";
  return "С учётом ограничений безопасных вариантов пока нет. Нужна консультация педиатра; ограничения не отключаются.";
}
export function foodOK(
  lib,
  s,
  key,
  day,
  ingredient = false,
  allowNextStage = false,
) {
  const f = lib.foods.find((f) => f.id === key),
    p = s.profile;
  if (
    !f ||
    !ready(p, day) ||
    !["active_test", "approved_for_use"].includes(f.status)
  )
    return false;
  const b = blocked(lib, s);
  if (b.has(key) || b.has("__unresolved__")) return false;
  const age = months(p.born, day),
    n = norm(f.name),
    early = age < 6 && stage(f) === 4 && f.early_medical_allowed;
  if (age < 6 && !early) return false;
  const dairy =
    ingredient &&
    n === "коровье молоко" &&
    age >= 6 &&
    f.safety?.includes("в составе блюд возможно раньше");
  if ((f.min_age == null || age < f.min_age) && !early && !dairy) return false;
  const explicitStage = s.periods.some(
    (period) =>
      period.start <= day &&
      addDays(period.start, 30) > day &&
      (period.replacement_ids || []).includes(key),
  );
  if (
    !dairy &&
    stage(f) > age + (allowNextStage || explicitStage ? 1 : 0) &&
    !known(lib, s, day).has(key)
  )
    return false;
  if (!ingredient && f.category === "Жиры") return false;
  if (
    ["соль", "сахар", "соль добавленная", "сахар добавленный"].includes(n) ||
    (n === "мед" && (age < 12 || !ingredient))
  )
    return false;
  // Risk is separate from family preferences. Never assign a universal new-food plan to medical risk.
  const declared = declaredKnown(lib, p).has(key);
  if (
    p.risk !== "no" &&
    !declared &&
    !s.diary.some(
      (r) =>
        ["eaten", "offered"].includes(r.status) &&
        !r.consumption_unknown &&
        r.ingredients.includes(key) &&
        noReaction(r),
    ) &&
    s.decisions[key] !== "returned"
  )
    return false;
  if ((p.unavailable_foods || []).some((v) => norm(v) === n)) return false;
  return introductionWithoutRecursion(s, key, day) !== "deferred";
}
function introductionWithoutRecursion(s, id, day) {
  const r = s.diary
    .filter(
      (r) =>
        r.day <= day && r.status === "refused" && r.ingredients.includes(id),
    )
    .at(-1);
  return r && addDays(r.day, TUNING.refusal_retry_days) > day
    ? "deferred"
    : "ok";
}
const skills = { puree: 0, soft_lumps: 1, soft_pieces: 2, family: 3 };
export function recipeOK(lib, s, key, day, daily = false) {
  const r = lib.recipes.find((r) => r.id === key);
  if (
    !r ||
    !["active_test", "approved_for_use"].includes(r.status) ||
    months(s.profile?.born, day) < r.min_age ||
    (skills[s.profile?.food_skill] ?? 0) < (skills[r.texture] ?? 99) ||
    !r.ingredients.length
  )
    return false;
  if (!r.ingredients.every((i) => foodOK(lib, s, i.food_id, day, true)))
    return false;
  const k = known(lib, s, day),
    fresh = ingredients(lib, key).filter((id) => !k.has(id));
  if (daily && fresh.length > 1) return false;
  if (
    daily &&
    fresh.some(
      (id) => allergenGroups(lib.foods.find((f) => f.id === id)).length,
    )
  )
    return false; // First allergen exposure stays a separate component.
  return true;
}
export function eligible(lib, s, item, day, daily = false) {
  return item.ingredients
    ? recipeOK(lib, s, item.id, day, daily)
    : foodOK(lib, s, item.id, day);
}
export function feedingDays(s, day) {
  const start =
    s.profile?.feeding_started_on ||
    s.profile?.feeding_start_date ||
    s.profile?.calendar_started_on;
  return start
    ? Math.max(
        0,
        Math.floor((Date.parse(day) - Date.parse(start)) / 86400000) + 1,
      )
    : 0;
}
export function slots(p, day) {
  const age = months(p.born, day),
    start = p.feeding_started_on || p.feeding_start_date,
    elapsed = p.started_in_app
      ? Math.max(0, (p.actual_feeding_days || 1) - 1)
      : start
        ? Math.max(
            0,
            Math.floor((Date.parse(day) - Date.parse(start)) / 86400000),
          )
        : p.started
          ? 30
          : 0;
  const ceiling = age < 6 ? 1 : age < 9 ? 3 : age < 12 ? 4 : 5;
  const target =
    age < 6
      ? 1
      : age < 7
        ? Math.min(3, 1 + Math.floor(elapsed / TUNING.six_month_step_days))
        : age < 9
          ? 3
          : age < 12
            ? 4
            : 5;
  const gradual =
    elapsed < TUNING.ramp_days[0]
      ? 1
      : elapsed < TUNING.ramp_days[1]
        ? 2
        : elapsed < TUNING.ramp_days[2]
          ? 3
          : target;
  const count = Math.min(ceiling, Number(p.meal_count) || target, gradual);
  return {
    1: ["Обед"],
    2: ["Завтрак", "Обед"],
    3: ["Завтрак", "Обед", "Ужин"],
    4: ["Завтрак", "Обед", "Полдник", "Ужин"],
    5: ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"],
  }[count];
}
const BASE = [
  "кабачок",
  "тыква",
  "брокколи",
  "цветная капуста",
  "гречка",
  "морковь",
  "рис",
];
export function rankFoods(lib, s, foods, day) {
  const k = known(lib, s, day);
  const prior = s.periods.filter((p) => p.start < day).at(-1);
  const carry = new Set(prior?.ids || []);
  return [...foods].sort((a, b) => {
    const score = (f) => {
      const pos = BASE.indexOf(norm(f.name));
      if (pos >= 0) return pos * 10;
      if (months(s.profile.born, day) >= 6 && f.iron_rich)
        return (norm(f.name) === "индейка" ? 45 : 95) + stage(f);
      if (months(s.profile.born, day) >= 6 && allergenGroups(f).length)
        return 65 + stage(f);
      const category =
        {
          Овощи: 100,
          "Крупы и злаки": 120,
          "Мясо и птица": 130,
          "Фрукты и ягоды": 150,
          "Рыба и морепродукты": 160,
          Молочные: 170,
          Жиры: 180,
        }[f.category] ?? 190;
      return (
        category +
        stage(f) +
        (carry.has(f.id) ? -20 : 0) +
        (k.has(f.id) ? 1000 : 0)
      );
    };
    return score(a) - score(b) || stage(a) - stage(b);
  });
}
export function createPeriod(lib, s, start = today(s.profile?.zone)) {
  if (!ready(s.profile, start)) return null;
  const existing = s.periods.find(
    (p) => p.start <= start && addDays(p.start, 30) > start,
  );
  if (existing) return existing;
  const k = known(lib, s, start),
    end = addDays(start, 29),
    foods = lib.foods.filter(
      (f) =>
        foodOK(lib, s, f.id, end, true) &&
        !(
          norm(f.name) === "коровье молоко" && months(s.profile.born, end) < 12
        ),
    );
  const ids = rankFoods(
    lib,
    s,
    foods.filter((f) => !k.has(f.id)),
    start,
  ).map((f) => f.id);
  if (
    !ids.length &&
    !lib.foods.some((f) => foodOK(lib, s, f.id, start, true) && k.has(f.id))
  )
    return null;
  const period = {
    start,
    ids,
    initial_ids: [...ids],
    accepted: false,
    revision: 0,
    anchor_pending: !s.profile.started && !s.profile.feeding_started_on,
  };
  s.periods.push(period);
  return period;
}
export function refreshPeriods(lib, s, from = today(s.profile?.zone)) {
  for (const p of s.periods) {
    if (addDays(p.start, 30) <= from && !p.anchor_pending) continue;
    const date = p.start > from ? p.start : from,
      end = addDays(p.start, 29),
      k = known(lib, s, date),
      omitted = new Set(p.omitted || []);
    const ids = p.ids.filter(
      (id) => !k.has(id) && foodOK(lib, s, id, end, true),
    );
    if (!p.accepted)
      for (const f of rankFoods(
        lib,
        s,
        lib.foods.filter(
          (f) =>
            !k.has(f.id) &&
            !omitted.has(f.id) &&
            foodOK(lib, s, f.id, end, true),
        ),
        date,
      ))
        if (!ids.includes(f.id)) ids.push(f.id);
    if (JSON.stringify(ids) !== JSON.stringify(p.ids)) {
      s.changes.push({
        at: new Date().toISOString(),
        action: "adapt_plan",
        start: p.start,
        before: p.ids,
        after: ids,
      });
      if (ids.some((id) => !p.ids.includes(id))) p.accepted = false;
      p.ids = ids;
      p.revision++;
    }
  }
  for (const [date, menu] of Object.entries(s.menus))
    if (date >= from)
      s.menus[date] = menu.filter((m) => m.status !== "pending");
}
export function currentPeriod(lib, s, day = today(s.profile?.zone)) {
  const pending = s.periods.find((p) => p.anchor_pending);
  if (pending) {
    if (ready(s.profile, day)) return pending;
    return null;
  }
  return createPeriod(lib, s, day);
}
export function nextIntroduction(lib, s, p, day) {
  const k = known(lib, s, day),
    pool = p.ids
      .map((id) => lib.foods.find((f) => f.id === id))
      .filter((f) => f && !k.has(f.id) && foodOK(lib, s, f.id, day, true));
  const active = pool
    .filter((f) => introduction(lib, s, f.id, day).status === "introducing")
    .sort(
      (a, b) =>
        introduction(lib, s, b.id, day).count -
        introduction(lib, s, a.id, day).count,
    );
  if (active.length) {
    const first = active[0];
    const result = [first];
    if (
      s.profile.introduction_mode === "overlap" &&
      introduction(lib, s, first.id, day).count === 2 &&
      !allergenGroups(first).length
    ) {
      const second = pool.find(
        (f) => !active.includes(f) && !allergenGroups(f).length,
      );
      if (second) result.push(second);
    }
    return result;
  }
  return pool.length ? [pool[0]] : [];
}
function snapshotItem(lib, item, extra = []) {
  const ids = [...new Set([...ingredients(lib, item.id), ...extra])];
  return { ...structuredClone(item), ingredient_ids: ids };
}
export function getMenu(lib, s, day = today(s.profile?.zone)) {
  const p = currentPeriod(lib, s, day);
  if (!p || !p.accepted) return [];
  const old = s.menus[day] || [],
    completed = old.filter((m) => m.status !== "pending");
  if (!ready(s.profile, day)) return completed;
  // Recover completed slots after backup import using immutable diary evidence.
  for (const row of s.diary.filter(
    (r) => r.day === day && r.slot !== "-" && r.token === `${day}:${r.slot}`,
  ))
    if (!completed.some((m) => m.id === row.token))
      completed.push({
        id: row.token,
        slot: row.slot,
        key: "",
        name: row.name,
        snapshot: row.snapshot || { name: row.name, category: "Дневник" },
        ingredients: row.ingredients,
        newIDs: row.newIDs || [],
        status: row.status === "eaten" ? "done" : row.status,
      });
  const k = known(lib, s, day),
    newFoods = nextIntroduction(lib, s, p, day),
    newIds = newFoods.map((f) => f.id),
    used = new Set(),
    results = [];
  const allowedKnown = lib.foods.filter(
    (f) => k.has(f.id) && foodOK(lib, s, f.id, day),
  );
  const last = (id) =>
    s.diary
      .filter(
        (r) =>
          r.day <= day && r.status === "eaten" && r.ingredients.includes(id),
      )
      .map((r) => r.day)
      .sort()
      .at(-1) || "0000";
  const recipes = lib.recipes.filter(
    (r) =>
      r.category !== "Соусы" &&
      recipeOK(lib, s, r.id, day, true) &&
      ingredients(lib, r.id).every((id) => k.has(id) || newIds.includes(id)),
  );
  const elapsed = feedingDays(s, day),
    offset = Math.floor(Date.parse(day) / 86400000);
  for (const slot of slots(s.profile, day)) {
    const done = completed.find((m) => m.slot === slot);
    if (done) {
      results.push(done);
      continue;
    }
    let item, ids, snapshot;
    const priorDish = s.diary
      .filter((r) => r.day < day && r.status === "eaten")
      .at(-1)?.dish_id;
    const matching = recipes
      .filter((r) => r.meals.includes(slot.toLowerCase()) && !used.has(r.id))
      .sort(
        (a, b) =>
          Number(a.id === priorDish) - Number(b.id === priorDish) ||
          last(ingredients(lib, a.id)[0]).localeCompare(
            last(ingredients(lib, b.id)[0]),
          ),
      );
    if (matching.length) {
      const min = matching.filter((r) => r.id !== priorDish);
      item = (min.length ? min : matching)[
        offset % (min.length || matching.length)
      ];
    }
    if ((elapsed <= 30 || !s.profile.started) && newFoods.length) item = null; // Early introductions remain simple, not complex recipes.
    if (slot === "Обед" && newFoods.length) {
      const ordinary = newFoods.every((f) => !allergenGroups(f).length);
      if (
        !item ||
        !ordinary ||
        !ingredients(lib, item.id).some((id) => newIds.includes(id))
      ) {
        let parts = [...newFoods];
        if (parts.some((f) => f.category === "Жиры")) {
          const carrier = allowedKnown.find((f) => !allergenGroups(f).length);
          if (!carrier) continue;
          parts.unshift(carrier);
        }
        if (elapsed > 30 && parts.length === 1 && allowedKnown.length) {
          const carrier = allowedKnown.find((f) => f.id !== parts[0].id);
          if (carrier) parts.push(carrier);
        }
        item = parts[0];
        ids = parts.map((f) => f.id);
        snapshot = snapshotItem(lib, item, ids);
        snapshot.name = parts.map((f) => f.name).join(" + ");
        snapshot.components = parts;
        snapshot.ingredient_ids = ids;
      }
    }
    if (!item) {
      const priority = [...allowedKnown].sort(
        (a, b) =>
          last(a.id).localeCompare(last(b.id)) ||
          Number(allergenGroups(b).length > 0) -
            Number(allergenGroups(a).length > 0),
      );
      item = priority.find((f) => !used.has(f.id)) || priority[0];
    }
    if (!item) continue;
    used.add(item.id);
    ids ||= ingredients(lib, item.id);
    snapshot ||= snapshotItem(lib, item);
    // Rotate a long-unused familiar allergen as a separate component, never a new exposure schedule.
    if (
      slot === "Обед" &&
      elapsed > 30 &&
      !newFoods.some((f) => allergenGroups(f).length)
    ) {
      const sides = lib.foods
        .filter(
          (f) =>
            k.has(f.id) &&
            allergenGroups(f).length &&
            norm(f.name) !== "коровье молоко" &&
            foodOK(lib, s, f.id, day, true) &&
            !ids.includes(f.id),
        )
        .sort((a, b) => last(a.id).localeCompare(last(b.id)));
      if (sides.length && last(sides[0].id) < last(ids[0])) {
        const side = sides[0];
        snapshot = {
          ...snapshot,
          name: snapshot.name + " + " + side.name,
          components: [snapshot, side],
        };
        ids = [...new Set([...ids, side.id])];
        snapshot.ingredient_ids = ids;
      }
    }
    results.push({
      id: `${day}:${slot}`,
      slot,
      key: item.id,
      name: snapshot.name,
      snapshot,
      ingredients: ids,
      newIDs: ids.filter((id) => !k.has(id)),
      status: "pending",
    });
  }
  s.menus[day] = results;
  return results;
}
export function emergency(text) {
  return /задых|не дыш|не может дыш|затруднен.*дых|затруднён.*дых|отек.*(язык|горл)|отёк.*(язык|горл)|потер.*созна|обморок|синеет|удуш|анафилак|свист.*дых|осипл|резк.*слаб/i.test(
    text,
  );
}
export function record(
  lib,
  s,
  {
    day,
    mealID,
    name,
    form = "-",
    quantity = "-",
    reaction = "-",
    comment = "",
    ids,
    skip = false,
    refused = false,
    token,
    suspected,
    photo = null,
  },
  now = today(s.profile?.zone),
) {
  if (!s.profile?.consent || !validDate(day) || day > now)
    throw Error("Нужны согласие и дата не позже сегодняшней.");
  const meal = mealID ? s.menus[day]?.find((m) => m.id === mealID) : null;
  if (mealID && !meal) throw Error("Приём пищи не найден");
  const key = mealID || token;
  if (!key) throw Error("Не задан ключ записи");
  if (s.diary.some((r) => r.token === key)) return false;
  if (meal && meal.status !== "pending") throw Error("Этот приём уже отмечен");
  const actual = ids ?? meal?.ingredients ?? [];
  if (
    meal &&
    !skip &&
    !refused &&
    actual.some((id) => !foodOK(lib, s, id, day, true))
  )
    throw Error("Ограничения изменились: обновите меню.");
  const row = {
    id: crypto.randomUUID(),
    token: key,
    day,
    name: name || meal?.name || "-",
    form: form.trim() || "-",
    quantity: quantity.trim() || "-",
    reaction: reaction.trim() ? reaction : "-",
    comment,
    ingredients: actual,
    newIDs: meal?.newIDs || [],
    status: refused ? "refused" : skip ? "skipped" : "eaten",
    slot: meal?.slot || "-",
    dish_id: meal?.key || null,
    snapshot: meal?.snapshot || null,
    createdAt: new Date().toISOString(),
    photo,
  };
  s.diary.push(row);
  if (meal) meal.status = skip ? "skipped" : refused ? "refused" : "done";
  if (row.status === "eaten") {
    const p = s.profile;
    p.calendar_started_on ||= day;
    if (!p.feeding_started_on && !p.started && !p.start_date_uncertain_legacy) {
      p.feeding_started_on = day;
      p.started_in_app = true;
      p.start_date_known = true;
    }
    p.started = true;
    p.actual_feeding_days = new Set(
      s.diary
        .filter((r) => r.status === "eaten" && !r.consumption_unknown)
        .map((r) => r.day),
    ).size;
    for (const period of s.periods)
      if (period.anchor_pending) {
        period.start = day;
        period.anchor_pending = false;
      }
    if (!noReaction(row)) {
      row.suspected = suspected?.length ? suspected : actual;
      row.suspected.forEach((id) => (s.decisions[id] = "pending"));
      s.changes.push({
        at: row.createdAt,
        action: "reaction",
        ids: row.suspected,
        text: row.reaction,
      });
    }
  }
  refreshPeriods(lib, s, now);
  return true;
}
export function decide(s, ids, status) {
  if (!["returned", "excluded", "pending"].includes(status))
    throw Error("Неверное решение");
  for (const id of ids) s.decisions[id] = status;
  s.changes.push({ at: new Date().toISOString(), action: status, ids });
}
export function replacementCandidates(lib, s, old, day) {
  const k = known(lib, s, day),
    age = months(s.profile.born, day);
  return lib.foods
    .filter(
      (f) =>
        f.id !== old.id &&
        f.category === old.category &&
        stage(f) <= age + 1 &&
        foodOK(lib, s, f.id, day, true, true),
    )
    .sort(
      (a, b) =>
        Number(k.has(a.id)) - Number(k.has(b.id)) ||
        Number(stage(a) > age) - Number(stage(b) > age),
    );
}
export function replaceDish(lib, s, day, mealID, key) {
  const meal = s.menus[day]?.find((m) => m.id === mealID),
    item = libraryIndex(lib).get(key);
  if (
    !meal ||
    meal.status !== "pending" ||
    day < today(s.profile.zone) ||
    !item ||
    !eligible(lib, s, item, day, true)
  )
    throw Error("Нет безопасной замены");
  const k = known(lib, s, day),
    ids = ingredients(lib, key),
    unknown = ids.filter((id) => !k.has(id));
  if (
    unknown.some((id) => !meal.newIDs.includes(id)) ||
    meal.newIDs.some((id) => !ids.includes(id))
  )
    throw Error("Замена должна сохранять текущее знакомство");
  Object.assign(meal, {
    key,
    name: item.name,
    snapshot: snapshotItem(lib, item),
    ingredients: ids,
  });
  s.changes.push({
    action: "replace_dish",
    at: new Date().toISOString(),
    day,
    mealID,
    key,
  });
}
export function validateBackup(data, lib) {
  if (
    !data ||
    data.app !== "holy-mommy-pwa" ||
    data.version !== 1 ||
    !data.state ||
    JSON.stringify(data).length > 40000000
  )
    throw Error("Неверный формат резервной копии");
  const s = data.state,
    index = libraryIndex(lib);
  if (
    ![1, 2].includes(s.schema) ||
    !Array.isArray(s.diary) ||
    !Array.isArray(s.periods) ||
    !s.menus ||
    !s.decisions ||
    !Array.isArray(s.changes) ||
    !s.ui
  )
    throw Error("Неполные данные");
  if (s.profile) {
    const p = s.profile;
    for (const key of [
      "consent",
      "active",
      "ready",
      "early_doctor_confirmed",
      "notifications_requested",
    ])
      if (p[key] != null && typeof p[key] !== "boolean")
        throw Error("Некорректный флаг профиля");
    if (p.doctor_plan_note != null && typeof p.doctor_plan_note !== "string")
      throw Error("Некорректная запись врача");
    for (const key of [
      "introduced_names",
      "excluded_names",
      "unavailable_foods",
    ])
      if (
        p[key] != null &&
        (!Array.isArray(p[key]) ||
          p[key].some((v) => typeof v !== "string" || v.length > 5000))
      )
        throw Error("Некорректные названия в профиле");
    if (
      p.doctor_foods != null &&
      (!Array.isArray(p.doctor_foods) ||
        p.doctor_foods.some((id) => !lib.foods.some((f) => f.id === id)))
    )
      throw Error("Некорректный список врача");
    if (
      p.meal_count != null &&
      (!Number.isInteger(p.meal_count) || p.meal_count < 1 || p.meal_count > 5)
    )
      throw Error("Некорректное число приёмов");
    if (p.time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time))
      throw Error("Некорректное время");
  }
  if (s.diary.length && !s.profile)
    throw Error("Дневник без согласованного профиля");
  if (
    s.profile &&
    (!Array.isArray(s.profile.introduced_names) ||
      !Array.isArray(s.profile.excluded_names) ||
      !["no", "yes", "unknown"].includes(s.profile.risk) ||
      !["puree", "soft_lumps", "soft_pieces", "family"].includes(
        s.profile.food_skill,
      ) ||
      typeof s.profile.ready !== "boolean")
  )
    throw Error("Некорректный профиль");
  if (
    s.profile &&
    (!s.profile.consent ||
      !validDate(s.profile.born) ||
      typeof s.profile.name !== "string" ||
      !s.profile.consent_version ||
      !s.profile.consent_at)
  )
    throw Error("Нет корректного согласия или профиля");
  if (
    s.diary.length > 50000 ||
    s.periods.length > 300 ||
    s.diary.some(
      (r) =>
        (r.photo != null &&
          (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r.photo) ||
            r.photo.length > 3000000)) ||
        !validDate(r.day) ||
        !["offered", "eaten", "skipped", "refused"].includes(r.status) ||
        !Array.isArray(r.ingredients) ||
        r.ingredients.some((id) => !lib.foods.some((f) => f.id === id)) ||
        typeof r.createdAt !== "string" ||
        typeof r.slot !== "string" ||
        (r.comment != null && typeof r.comment !== "string") ||
        (r.newIDs != null &&
          (!Array.isArray(r.newIDs) ||
            r.newIDs.some((id) => !r.ingredients.includes(id)))) ||
        ["name", "form", "quantity", "reaction", "token"].some(
          (k) => typeof r[k] !== "string",
        ),
    )
  )
    throw Error("Некорректный дневник");
  if (
    new Set(s.diary.map((r) => r.token)).size !== s.diary.length ||
    s.periods.some(
      (p) =>
        !validDate(p.start) ||
        !Number.isInteger(p.revision) ||
        p.revision < 0 ||
        (p.omitted != null &&
          (!Array.isArray(p.omitted) ||
            p.omitted.some((id) => !index.has(id)))) ||
        !Array.isArray(p.ids) ||
        new Set(p.ids).size !== p.ids.length ||
        p.ids.some((id) => !index.has(id)),
    )
  )
    throw Error("Некорректный план");
  if (
    Object.entries(s.decisions).some(
      ([id, v]) =>
        !lib.foods.some((f) => f.id === id) ||
        !["pending", "returned", "excluded"].includes(v),
    )
  )
    throw Error("Некорректные ограничения");
  try {
    if (s.profile) today(s.profile.zone);
  } catch {
    throw Error("Некорректный часовой пояс");
  }
  // Derived menu snapshots are never trusted from imported files. Rebuild pending menus,
  // reconstruct completed status from diary tokens so imports cannot bypass constraints.
  s.menus = {};
  s.ui = {};
  if (s.draft) {
    const d = s.draft;
    if (!["entry", "replace", "onboarding"].includes(d.type))
      throw Error("Некорректный черновик");
    if (
      d.type === "entry" &&
      (["form", "quantity", "reaction", "symptoms"].some(
        (k) => d[k] != null && typeof d[k] !== "string",
      ) ||
        !validDate(d.day) ||
        typeof d.name !== "string" ||
        typeof d.token !== "string" ||
        (d.ids && !d.ids.every((id) => index.has(id))))
    )
      throw Error("Некорректный черновик записи");
    if (
      d.type === "replace" &&
      (!s.periods.some((p) => p.start === d.start) ||
        d.proposals?.some(
          (pair) =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            pair.some((id) => !index.has(id)),
        ))
    )
      throw Error("Некорректные замены");
    if (
      d.type === "onboarding" &&
      (!Array.isArray(d.answers?.introduced_names) ||
        !Array.isArray(d.answers?.excluded_names) ||
        typeof d.answers?.name !== "string" ||
        !d.answers?.consent ||
        !d.answers.consent_version ||
        !Number.isInteger(d.step) ||
        d.step < 0 ||
        d.step > 20)
    )
      throw Error("Некорректное согласие в черновике");
  }
  return migrate(s);
}
export function backup(s) {
  return {
    app: "holy-mommy-pwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    state: structuredClone(s),
  };
}

export function reminders(
  s,
  menu,
  date = today(s.profile?.zone),
  clock = new Date(),
) {
  if (!s.profile?.notifications_requested) return [];
  const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: s.profile.zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(clock),
    result = [];
  if (
    time >= (s.profile.time || "09:00") &&
    time < (s.profile.evening_time || "19:00") &&
    menu.length
  )
    result.push({
      kind: "morning",
      text: "Доброе утро! Изучите меню прикорма на сегодня",
      route: "today",
    });
  if (
    time >= (s.profile.evening_time || "19:00") &&
    menu.some((m) => m.status === "pending")
  )
    result.push({
      kind: "evening",
      text: "Не забудьте заполнить дневник прикорма за сегодня",
      route: "today",
    });
  const p = s.periods.find(
    (p) => !p.anchor_pending && p.start <= date && addDays(p.start, 30) > date,
  );
  if (p && date >= addDays(p.start, 23))
    result.push({
      kind: "next_month",
      text: "Пора согласовать меню прикорма на следующий месяц",
      route: "plan/" + addDays(p.start, 30),
    });
  return result;
}
// Shopping forecast uses a disposable copy. Assumed future success is never written to the real diary.
export function forecastMenus(
  lib,
  s,
  start = today(s.profile?.zone),
  days = 30,
) {
  const copy = structuredClone(s),
    result = [];
  for (let n = 0; n < days; n++) {
    const date = addDays(start, n),
      menu = getMenu(lib, copy, date);
    result.push({ day: date, meals: structuredClone(menu), provisional: true });
    for (const meal of menu)
      if (meal.status === "pending")
        record(lib, copy, { day: date, mealID: meal.id }, date);
  }
  return result;
}
