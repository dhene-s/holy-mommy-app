import { POLICY } from "./policy.js";
import { RULES, TUNING } from "./rules.js";
// Browser port of bot/prikorm/meal_service.py. No Telegram, network or storage calls.
export const PLANNER_VERSION = "cycles-2026-11-27.2";
// Disposable projections never migrate plans or recursively build more projections.
const projections = new WeakSet();
const previews = new WeakMap();
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
  if (declared || max >= POLICY.introduction.days)
    return {
      status: "introduced",
      count: POLICY.introduction.days,
      last,
      declared,
    };
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
      ? Math.min(streak, POLICY.introduction.days - 1)
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
      if (run >= POLICY.introduction.days) set.add(id);
      previous = date;
    }
  }
  const b = blocked(lib, s);
  for (const id of b) set.delete(id);
  return set;
}
const blockedCache = new WeakMap();
export function blocked(lib, s) {
  let states = blockedCache.get(lib);
  if (!states) { states = new WeakMap(); blockedCache.set(lib, states); }
  const stamp = JSON.stringify([s.profile?.excluded_names || [], s.decisions || {}]),
    cached = states.get(s);
  if (cached?.stamp === stamp) return new Set(cached.ids);
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
  states.set(s, { stamp, ids: new Set(ids) });
  return ids;
}
export function earlyStartRequired(profile, day) {
  const age = months(profile?.born, day);
  return age >= POLICY.readiness.minimum_months && age < POLICY.readiness.standard_months;
}
export function confirmEarlyStart(lib, s, answer, date = today(s.profile?.zone)) {
  if (typeof answer !== "boolean" || !s.profile?.consent || !earlyStartRequired(s.profile, date))
    throw Error("Подтверждение доступно для профиля ребёнка 4–5 месяцев.");
  s.profile.early_doctor_confirmed = answer;
  if (s.ui.settingsDraft) s.ui.settingsDraft.early = answer ? "yes" : "no";
  s.changes.push({ action: "early_start_answer", answer, at: new Date().toISOString() });
  if (answer) {
    // A formerly blocked/empty plan must be offered for agreement, not remain accepted and empty.
    for (const p of s.periods)
      if ((p.anchor_pending || addDays(p.start, 30) > date) && !p.ids.length) p.accepted = false;
    refreshPeriods(lib, s, date);
    const period = currentPeriod(lib, s, date);
    if (period && !period.initial_ids?.length) period.initial_ids = [...period.ids];
    return period;
  }
  for (const [day, menu] of Object.entries(s.menus))
    if (day >= date) s.menus[day] = menu.filter((m) => m.status !== "pending");
  return null;
}
export function ready(p, day) {
  const age = months(p?.born, day);
  return Boolean(
    p?.consent &&
      p.active &&
      p.ready &&
      age >= POLICY.readiness.minimum_months &&
      age <= POLICY.readiness.maximum_months &&
      (age >= POLICY.readiness.standard_months || p.early_doctor_confirmed === true),
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
  if (p.risk === "unknown" || p.risk == null)
    return "В анкете не уточнены медицинские ограничения. Укажите ответ в настройках профиля; согласование раннего старта сохраняется отдельно.";
  if (p.risk === "yes")
    return "В профиле указаны медицинские ограничения. Универсальный план новых продуктов не формируется; согласование раннего старта их не отменяет.";
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
    early =
      age < POLICY.readiness.standard_months &&
      POLICY.early_priority.some((name) => norm(name) === n) &&
      f.early_medical_allowed;
  if (age < POLICY.readiness.standard_months && !early) return false;
  const dairy =
    ingredient &&
    n === "коровье молоко" &&
    age >= 6 &&
    f.safety?.includes("в составе блюд возможно раньше");
  if ((f.min_age == null || age < f.min_age) && !early && !dairy) return false;
  if (!ingredient && f.category === "Жиры") return false;
  if (
    ["соль", "сахар", "соль добавленная", "сахар добавленный"].includes(n) ||
    (n === "мед" && (age < 12 || !ingredient))
  )
    return false;
  // Risk is separate from family preferences. Never assign a universal new-food plan to medical risk.
  const declared = declaredKnown(lib, p).has(key);
  const doctorAllergen =
    !!p.allergen_doctor_confirmed &&
    (p.doctor_allergen_foods || []).includes(key);
  if (
    POLICY.allergens.doctor_required_for.some((flag) => p[flag]) &&
    allergenGroups(f).length &&
    !known(lib, s, day).has(key) &&
    !doctorAllergen &&
    s.decisions[key] !== "returned"
  )
    return false;

  if (
    p.risk !== "no" &&
    !doctorAllergen &&
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
    : planFoodOK(lib, s, item.id, day);
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
export function feedingExperience(p, day) {
  const start = p.feeding_started_on || p.feeding_start_date;
  return p.started_in_app
    ? Math.max(0, (p.actual_feeding_days || 1) - 1)
    : start
      ? Math.max(
          0,
          Math.floor((Date.parse(day) - Date.parse(start)) / 86400000),
        )
      : p.started
        ? POLICY.meals.unknown_prior_experience_days
        : 0;
}
export function slots(p, day) {
  const age = months(p.born, day),
    band = POLICY.meals.bands.find((b) => age >= b.min && age <= b.max);
  if (!band) return [];
  const requested =
    p.meal_count == null
      ? band.target
      : Math.max(1, Math.min(Number(p.meal_count) || 1, band.ceiling));
  const experience = feedingExperience(p, day),
    ramp = POLICY.meals.ramp_days;
  const progressive =
    experience < ramp[0]
      ? 1
      : experience < ramp[1]
        ? 2
        : experience < ramp[2]
          ? 3
          : requested;
  return POLICY.meals.slots[Math.min(requested, progressive, band.ceiling)];
}
export function priorityFoodIds(lib, s, day) {
  const age = months(s.profile.born, day),
    k = known(lib, s, day),
    result = [];
  if (age < POLICY.readiness.standard_months)
    return POLICY.early_priority
      .map((n) => lib.foods.find((f) => norm(f.name) === norm(n))?.id)
      .filter(Boolean);
  for (const group of POLICY.priority_groups)
    for (const item of group.items) {
      const candidates = item.names
        .map((n) => lib.foods.find((f) => norm(f.name) === norm(n)))
        .filter(Boolean);
      if (item.representative) {
        if (candidates.some((f) => k.has(f.id))) continue;
        const pick = candidates.find(
          (f) => !k.has(f.id) && planFoodOK(lib, s, f.id, day, true),
        );
        if (pick) result.push(pick.id);
      } else result.push(...candidates.map((f) => f.id));
    }
  return result;
}
export function planFoodOK(lib, s, key, day, ingredient = false) {
  const f = lib.foods.find((f) => f.id === key);
  return (
    !!f &&
    foodOK(lib, s, key, day, ingredient) &&
    (known(lib, s, day).has(key) ||
      stage(f) <=
        months(s.profile.born, day) + POLICY.matrix_planning.prospective_months)
  );
}
export function rankFoods(lib, s, foods, day) {
  const priority = priorityFoodIds(lib, s, day),
    prior = s.periods.filter((p) => p.start < day).at(-1),
    carry = new Set(prior?.ids || []);
  const fallback = (f) =>
    priority.includes(f.id)
      ? priority.indexOf(f.id)
      : priority.length + stage(f) * 10 + (carry.has(f.id) ? -5 : 0);
  return [...foods].sort((a, b) => fallback(a) - fallback(b));
}
export function verifiedAllergenProtocol(group) {
  const entry = POLICY.allergens.verified_protocols?.[group];
  return entry?.review_status === "approved" &&
    validDate(entry.reviewed_at) &&
    typeof entry.review_version === "string" &&
    entry.review_version.trim() &&
    /^https:\/\//.test(entry.source_url || "")
    ? entry
    : null;
}
export function reviewedRepeatPriority(lib, s, food, day) {
  let priority = 0;
  for (const group of allergenGroups(food)) {
    const protocol = verifiedAllergenProtocol(group);
    if (
      !Number.isInteger(protocol?.return_after_days) ||
      protocol.return_after_days < 1
    )
      continue;
    const last = s.diary
      .filter(
        (r) =>
          r.day < day &&
          r.status === "eaten" &&
          r.ingredients.some((id) =>
            allergenGroups(
              lib.foods.find((f) => f.id === id) || { id },
            ).includes(group),
          ),
      )
      .map((r) => r.day)
      .sort()
      .at(-1);
    const gap = last
      ? Math.floor((Date.parse(day) - Date.parse(last)) / 86400000)
      : protocol.return_after_days;
    priority = Math.max(
      priority,
      gap >= protocol.return_after_days
        ? gap - protocol.return_after_days + 1
        : 0,
    );
  }
  return priority;
}
export function portionGuidance(lib, s, day, meal) {
  const age = months(s.profile.born, day),
    ids = meal.ingredients || [],
    newIds = meal.newIDs || [],
    allergen = newIds.some(
      (id) =>
        allergenGroups(lib.foods.find((f) => f.id === id) || { id }).length,
    ),
    experience = feedingExperience(s.profile, day);
  const band = POLICY.portions.bands.find(
    (b) => age >= b.min && age < b.max_exclusive,
  );
  let mealText =
    age < POLICY.readiness.standard_months
      ? POLICY.portions.early
      : experience === 0 && !allergen
        ? POLICY.portions.start
        : experience < POLICY.meals.ramp_days[0]
          ? POLICY.portions.first_steps
          : band?.text || "Индивидуальный ориентир требует уточнения";
  if (allergen && experience === 0)
    mealText =
      "Стартовый объём нового аллергена не задан. Общие объёмы приёма не являются дозировкой аллергена.";
  const allergenIds = newIds.filter(
    (id) => allergenGroups(lib.foods.find((f) => f.id === id) || { id }).length,
  );
  const newGroups = [
    ...new Set(
      allergenIds.flatMap((id) =>
        allergenGroups(lib.foods.find((f) => f.id === id)),
      ),
    ),
  ];
  const protocol =
    allergenIds.length === 1 && newGroups.length === 1
      ? verifiedAllergenProtocol(newGroups[0])
      : null;
  const verifiedText = protocol?.initial_amount_text
    ? `Указанный аллерген (${newGroups[0]}): ${protocol.initial_amount_text}. ${protocol.observation_text || "Время наблюдения отдельно не задано."} Источник: ${protocol.source_url}`
    : null;
  if (verifiedText && experience === 0)
    mealText =
      "Стартовое количество указано отдельно для конкретного аллергена. Объём приёма не является фактически съеденным количеством.";
  const ordinaryFirst = newIds.some(
    (id) =>
      !allergenGroups(lib.foods.find((f) => f.id === id) || { id }).length &&
      !s.diary.some(
        (r) =>
          r.day < day && r.status === "eaten" && r.ingredients.includes(id),
      ),
  );
  return {
    meal: mealText,
    new_product:
      age >= POLICY.readiness.standard_months && ordinaryFirst && !allergen
        ? POLICY.portions.ordinary_new_start
        : null,
    allergen: allergen ? verifiedText || POLICY.allergens.initial_notice : null,
    scope: POLICY.portions.scope,
    status: POLICY.portions.status,
    source: POLICY.portions.source,
  };
}
export function textureSuggestion(p, day) {
  if (!p.ready) return null;
  const age = months(p.born, day),
    target = POLICY.textures.find((t) => age >= t.min && age <= t.max),
    scores = { puree: 0, soft_lumps: 1, soft_pieces: 2, family: 3 };
  return target && (scores[p.food_skill] ?? 0) < scores[target.skill]
    ? target
    : null;
}
function uniqueCategories(lib, ids) {
  return new Set(
    ids
      .map((id) => lib.foods.find((f) => f.id === id)?.category)
      .filter(Boolean),
  );
}
function componentSnapshot(lib, parts) {
  const ids = [...new Set(parts.flatMap((f) => ingredients(lib, f.id)))];
  return {
    ...structuredClone(parts[0]),
    name: parts.map((p) => p.name).join(" + "),
    components: structuredClone(parts),
    ingredient_ids: ids,
  };
}
export function createPeriod(lib, s, start = today(s.profile?.zone)) {
  if (!ready(s.profile, start)) return null;
  const existing = s.periods.find(
    (p) => p.start <= start && addDays(p.start, 30) > start,
  );
  if (existing) {
    ensurePeriod(lib, s, existing, start);
    return existing;
  }
  const k = known(lib, s, start),
    end = addDays(start, 29),
    foods = lib.foods.filter(
      (f) =>
        planFoodOK(lib, s, f.id, end, true) &&
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
  if (!projections.has(s)) {
    projectPeriod(lib, s, period, start);
    period.initial_ids = [...period.ids];
  }
  return period;
}
// Select monthly goals from actual possible introduction events, not library size.
function projectPeriod(lib, s, period, from) {
  const start = period.anchor_pending ? from : (from > period.start ? from : period.start),
    end = period.anchor_pending ? addDays(start, 29) : addDays(period.start, 29);
  if (start > end) return;
  const copy = structuredClone(s),
    target = copy.periods.find((p) => p.start === period.start),
    k = known(lib, copy, start),
    omitted = new Set(period.omitted || []),
    agreed = period.accepted ? new Set([...(period.ids || []), ...(period.restricted_ids || []), ...lib.foods.filter((f) => introduction(lib, s, f.id, start).status === "introducing").map((f) => f.id)]) : null,
    candidates = rankFoods(lib, copy, lib.foods.filter((f) =>
      (!agreed || agreed.has(f.id)) && !k.has(f.id) && !omitted.has(f.id) && planFoodOK(lib, copy, f.id, end, true) &&
      !(norm(f.name) === "коровье молоко" && months(copy.profile.born, end) < 12)
    ), start).map((f) => f.id);
  target.ids = candidates;
  target.accepted = true;
  target.planning_version = PLANNER_VERSION;
  projections.add(copy);
  const days = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const forecast = candidates.length ? forecastMenus(lib, copy, start, days) : [],
    ids = [...new Set(forecast.flatMap((r) => r.meals
      .filter((m) => m.status === "pending")
      .flatMap((m) => m.newIDs)).filter((id) => !k.has(id)))];
  period.ids = ids;
  period.deferred_ids = candidates.filter((id) => !ids.includes(id));
  period.planning_version = PLANNER_VERSION;
  period.projected_from = start;
  period.initial_ids ||= [...ids];
}
function ensurePeriod(lib, s, period, from) {
  if (projections.has(s) || period.planning_version === PLANNER_VERSION) return;
  const before = structuredClone(period);
  period.legacy_plans ||= [];
  period.legacy_plans.push({ ids: before.ids, initial_ids: before.initial_ids,
    accepted: before.accepted, revision: before.revision, planning_version: before.planning_version || "legacy" });
  period.accepted = false;
  projectPeriod(lib, s, period, from);
  period.initial_ids = [...new Set([
    ...(before.initial_ids || before.ids).filter((id) => known(lib, s, from).has(id)),
    ...period.ids,
  ])];
  period.accepted = false;
  period.revision = (period.revision || 0) + 1;
  s.changes.push({ action: "migrate_cycle_plan", at: new Date().toISOString(),
    start: period.start, before: before.ids, after: [...period.ids] });
  for (const [date, menu] of Object.entries(s.menus))
    if (date >= from) s.menus[date] = menu.filter((m) => m.status !== "pending");
}
export function upgradePlanning(lib, s, from = today(s.profile?.zone)) {
  for (const p of s.periods)
    if (p.anchor_pending || addDays(p.start, 30) > from) ensurePeriod(lib, s, p, from);
  return s;
}
export function refreshPeriods(lib, s, from = today(s.profile?.zone)) {
  for (const p of s.periods) {
    if (addDays(p.start, 30) <= from && !p.anchor_pending) continue;
    const date = p.start > from ? p.start : from,
      end = addDays(p.start, 29),
      k = known(lib, s, date),
      omitted = new Set(p.omitted || []);
    const restricted = blocked(lib, s);
    p.restricted_ids = [
      ...new Set([
        ...(p.restricted_ids || []),
        ...p.ids.filter((id) => restricted.has(id)),
      ]),
    ];
    const ids = p.ids.filter(
      (id) => !k.has(id) && planFoodOK(lib, s, id, end, true),
    );
    for (const id of p.restricted_ids)
      if (
        !ids.includes(id) &&
        !k.has(id) &&
        !omitted.has(id) &&
        planFoodOK(lib, s, id, end, true)
      )
        ids.push(id);
    if (!p.accepted)
      for (const f of rankFoods(
        lib,
        s,
        lib.foods.filter(
          (f) =>
            !k.has(f.id) &&
            !omitted.has(f.id) &&
            planFoodOK(lib, s, f.id, end, true),
        ),
        date,
      ))
        if (!ids.includes(f.id)) ids.push(f.id);
    if (!projections.has(s)) {
      const projected = { ...p, ids };
      projectPeriod(lib, s, projected, date);
      ids.splice(0, ids.length, ...projected.ids);
      p.deferred_ids = projected.deferred_ids;
      p.planning_version = projected.planning_version;
      p.projected_from = projected.projected_from;
    }
    if (JSON.stringify(ids) !== JSON.stringify(p.ids)) {
      s.changes.push({
        at: new Date().toISOString(),
        action: "adapt_plan",
        start: p.start,
        before: p.ids,
        after: ids,
      });
      if (
        ids.some((id) => !p.ids.includes(id) && !p.restricted_ids.includes(id) && !s.diary.some((r) => r.day <= date && r.status === "eaten" && noReaction(r) && r.ingredients.includes(id)))
      )
        p.accepted = false;
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
    if (ready(s.profile, day)) {
      ensurePeriod(lib, s, pending, day);
      return pending;
    }
    return null;
  }
  return createPeriod(lib, s, day);
}
export function nextIntroduction(lib, s, p, day) {
  const k = known(lib, s, day),
    pool = rankFoods(
      lib,
      s,
      p.ids
        .map((id) => lib.foods.find((f) => f.id === id))
        .filter(
          (f) => f && !k.has(f.id) && planFoodOK(lib, s, f.id, day, true),
        ),
      day,
    );
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
      (s.profile.introduction_mode || POLICY.introduction.default_mode) ===
        "overlap" &&
      introduction(lib, s, first.id, day).count ===
        POLICY.introduction.overlap_on_day - 1 &&
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
  const completed = (s.menus[day] || []).filter((m) => m.status !== "pending");
  if (!ready(s.profile, day)) return completed;
  for (const row of s.diary.filter(
    (r) => r.day === day && r.slot !== "-" && r.token === `${day}:${r.slot}`,
  ))
    if (!completed.some((m) => m.id === row.token))
      completed.push({
        id: row.token,
        slot: row.slot,
        key: row.dish_id || "",
        name: row.name,
        snapshot: row.snapshot || { name: row.name, category: "Дневник" },
        ingredients: row.ingredients,
        newIDs: row.newIDs || [],
        status: row.status === "eaten" ? "done" : row.status,
      });
  const k = known(lib, s, day),
    before = known(lib, s, addDays(day, -1)),
    experience = feedingExperience(s.profile, day),
    daySlots = [...slots(s.profile, day)],
    results = [],
    used = new Set(completed.map((m) => m.key));
  for (const old of completed)
    if (!daySlots.includes(old.slot)) {
      const free = daySlots.findIndex(
        (slot) => !completed.some((m) => m.slot === slot),
      );
      if (free >= 0) daySlots[free] = old.slot;
      else daySlots.push(old.slot);
    }

  const exposures = [
    ...new Set(
      s.diary
        .filter((r) => r.day === day && r.status === "eaten")
        .flatMap((r) => r.ingredients)
        .filter((id) => !before.has(id)),
    ),
  ];
  let newFoods = nextIntroduction(lib, s, p, day);
  if (exposures.length) {
    const exposedAllergen = exposures.some(
      (id) =>
        allergenGroups(lib.foods.find((f) => f.id === id) || { id }).length,
    );
    newFoods = newFoods.filter(
      (f) =>
        exposures.includes(f.id) ||
        (!exposedAllergen &&
          s.profile.introduction_mode === "overlap" &&
          !allergenGroups(f).length &&
          exposures.length < POLICY.introduction.overlap_on_day - 1),
    );
  }
  const newIds = newFoods.map((f) => f.id);
  const freshAllergen = newFoods.some((f) => allergenGroups(f).length);
  const newSlot =
    daySlots.includes("Обед") &&
    newFoods.some((f) =>
      POLICY.meals.new_food_lunch_categories.includes(f.category),
    )
      ? "Обед"
      : daySlots.find((slot) => slot === POLICY.meals.new_food_default_slot) ||
        daySlots[0];
  const knownFoods = lib.foods.filter(
    (f) => k.has(f.id) && foodOK(lib, s, f.id, day),
  );
  const last = (id) =>
    s.diary
      .filter(
        (r) =>
          r.day < day && r.status === "eaten" && r.ingredients.includes(id),
      )
      .map((r) => r.day)
      .sort()
      .at(-1) || "0000";
  const lastDish = (id) =>
    s.diary
      .filter((r) => r.day < day && r.status === "eaten" && r.dish_id === id)
      .map((r) => r.day)
      .sort()
      .at(-1) || "0000";
  const recipePool = lib.recipes.filter(
    (r) =>
      r.category !== "Соусы" &&
      recipeOK(lib, s, r.id, day, true) &&
      ingredients(lib, r.id).every((id) => k.has(id) || newIds.includes(id)),
  );
  const categoryLast = (c) => {
    let date = "0000";
    for (const row of s.diary)
      if (
        row.day < day &&
        row.status === "eaten" &&
        row.ingredients.some(
          (id) => lib.foods.find((f) => f.id === id)?.category === c,
        ) &&
        row.day > date
      )
        date = row.day;
    return date;
  };
  const weights = POLICY.diversity.weights;
  const oldestRegular = [...POLICY.diversity.regular_groups].sort((a, b) =>
    categoryLast(a).localeCompare(categoryLast(b)),
  );
  const usedCategories = () =>
    uniqueCategories(
      lib,
      results.flatMap((m) => m.ingredients),
    );
  for (const slot of daySlots) {
    const done = completed.find((m) => m.slot === slot);
    if (done) {
      results.push(done);
      continue;
    }
    let item, ids, snapshot;
    const preferences = POLICY.meals.category_preferences[slot] || [],
      coverage = usedCategories();
    const matching = recipePool.filter(
      (r) =>
        r.meals.includes(slot.toLowerCase()) &&
        !used.has(r.id) &&
        ingredients(lib, r.id).every((id) => k.has(id) || slot === newSlot),
    );
    const recipeScore = (r) => {
      const cats = uniqueCategories(lib, ingredients(lib, r.id));
      let score = 0;
      for (let n = 0; n < preferences.length; n++)
        if (cats.has(preferences[n]))
          score += weights.slot_base - n * weights.slot_step;
      for (const group of POLICY.diversity.daily_preferred_groups)
        if (
          (
            POLICY.diversity.coverage_slots[
              group.length === 1 ? group[0] : "animal_protein"
            ] || [slot]
          ).includes(slot) &&
          !group.some((c) => coverage.has(c)) &&
          group.some((c) => cats.has(c))
        )
          score += weights.daily_coverage;
      const notCoveredRegular = oldestRegular.filter((c) => !coverage.has(c));
      const oldest = notCoveredRegular[0];
      if (oldest && cats.has(oldest)) score += weights.regular_category;
      if (
        ingredients(lib, r.id).some(
          (id) =>
            k.has(id) &&
            reviewedRepeatPriority(
              lib,
              s,
              lib.foods.find((f) => f.id === id),
              day,
            ) > 0,
        )
      )
        score += weights.regular_category;
      if (
        POLICY.diversity.avoid_consecutive_same_dish &&
        lastDish(r.id) === addDays(day, -1)
      )
        score -= weights.same_dish_yesterday;
      return score;
    };
    matching.sort(
      (a, b) =>
        recipeScore(b) - recipeScore(a) ||
        ingredients(lib, a.id)
          .map(last)
          .sort()[0]
          .localeCompare(ingredients(lib, b.id).map(last).sort()[0]) ||
        lastDish(a.id).localeCompare(lastDish(b.id)),
    );
    if (matching.length) {
      const best = recipeScore(matching[0]),
        scoreBest = matching.filter(
          (r) =>
            recipeScore(r) === best &&
            lastDish(r.id) === lastDish(matching[0].id),
        );
      item =
        scoreBest[Math.floor(Date.parse(day) / 86400000) % scoreBest.length];
    }
    if (slot === newSlot && newFoods.length) {
      if (
        experience < POLICY.introduction.first_month_days ||
        freshAllergen ||
        !item ||
        !ingredients(lib, item.id).some((id) => newIds.includes(id))
      ) {
        let parts = [...newFoods];
        if (parts.some((f) => f.category === "Жиры")) {
          const carrier = knownFoods.find((f) => !allergenGroups(f).length);
          if (!carrier) continue;
          parts.unshift(carrier);
        }
        if (
          experience >= POLICY.introduction.first_month_days &&
          parts.length === 1
        ) {
          const carrier = knownFoods
            .filter((f) => f.id !== parts[0].id)
            .sort(
              (a, b) =>
                Number(coverage.has(a.category)) -
                  Number(coverage.has(b.category)) ||
                last(a.id).localeCompare(last(b.id)),
            )[0];
          if (carrier) parts.push(carrier);
        }
        item = parts[0];
        snapshot = componentSnapshot(lib, parts);
        ids = snapshot.ingredient_ids;
      }
    }
    if (!item) {
      const parts = [];
      for (const group of POLICY.meals.simple_components[slot] || []) {
        const choices = knownFoods
          .filter(
            (f) =>
              group.includes(f.category) && !parts.some((p) => p.id === f.id),
          )
          .sort(
            (a, b) =>
              Number(used.has(a.id)) - Number(used.has(b.id)) ||
              last(a.id).localeCompare(last(b.id)),
          );
        if (choices[0]) parts.push(choices[0]);
      }
      if (!parts.length) {
        const choices = [...knownFoods].sort(
          (a, b) =>
            Number(used.has(a.id)) - Number(used.has(b.id)) ||
            last(a.id).localeCompare(last(b.id)),
        );
        if (choices[0]) parts.push(choices[0]);
      }
      if (!parts.length) continue;
      if (months(s.profile.born, day) < POLICY.readiness.standard_months)
        parts.splice(1);
      item = parts[0];
      snapshot = componentSnapshot(lib, parts);
      ids = snapshot.ingredient_ids;
    }
    ids ||= ingredients(lib, item.id);
    snapshot ||= snapshotItem(lib, item);
    // Repeat familiar allergens by recency, never with an invented medical frequency.
    if (
      slot === "Обед" &&
      experience >= POLICY.introduction.first_month_days &&
      !freshAllergen
    ) {
      const sides = lib.foods
        .filter(
          (f) =>
            k.has(f.id) &&
            (allergenGroups(f).length ||
              POLICY.diversity.regular_groups.includes(f.category)) &&
            norm(f.name) !== "коровье молоко" &&
            foodOK(lib, s, f.id, day, true) &&
            !ids.includes(f.id),
        )
        .sort(
          (a, b) =>
            reviewedRepeatPriority(lib, s, b, day) -
              reviewedRepeatPriority(lib, s, a, day) ||
            Number(
              new Set([...usedCategories(), ...uniqueCategories(lib, ids)]).has(
                a.category,
              ),
            ) -
              Number(
                new Set([
                  ...usedCategories(),
                  ...uniqueCategories(lib, ids),
                ]).has(b.category),
              ) ||
            categoryLast(a.category).localeCompare(categoryLast(b.category)) ||
            last(a.id).localeCompare(last(b.id)),
        );
      if (
        sides[0] &&
        (reviewedRepeatPriority(lib, s, sides[0], day) > 0 ||
          categoryLast(sides[0].category) <
            [...uniqueCategories(lib, ids)].map(categoryLast).sort().at(-1))
      ) {
        snapshot = componentSnapshot(lib, [snapshot, sides[0]]);
        ids = [...new Set([...ids, sides[0].id])];
        snapshot.ingredient_ids = ids;
      }
    }
    used.add(item.id);
    results.push({
      id: `${day}:${slot}`,
      slot,
      key: item.id,
      name: snapshot.name,
      snapshot,
      ingredients: ids,
      newIDs: ids.filter((id) => !k.has(id)),
      status: "pending",
      policy_version: POLICY.version,
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
      "severe_eczema",
      "known_food_allergy",
      "allergen_doctor_confirmed",
    ])
      if (p[key] != null && typeof p[key] !== "boolean")
        throw Error("Некорректный флаг профиля");
    if (
      p.doctor_allergen_foods != null &&
      (!Array.isArray(p.doctor_allergen_foods) ||
        p.doctor_allergen_foods.some(
          (id) => !lib.foods.some((f) => f.id === id),
        ))
    )
      throw Error("Некорректные согласования аллергенов");
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
  projections.add(copy);
  for (let n = 0; n < days; n++) {
    const date = addDays(start, n),
      menu = getMenu(lib, copy, date);
    result.push({ day: date, meals: structuredClone(menu), provisional: true });
    for (const meal of menu) {
      if (meal.status !== "pending") continue;
      if (!copy.menus[date]?.some((m) => m.id === meal.id))
        copy.menus[date] = [...(copy.menus[date] || []), structuredClone(meal)];
      record(lib, copy, { day: date, mealID: meal.id }, date);
    }
  }
  return result;
}

// A future screen uses the same sequential forecast as monthly goals/shopping.
// It never writes assumed feedings, dates or pending snapshots to the user state.
export function previewMenu(lib, s, date, from = today(s.profile?.zone)) {
  if (date <= from) return getMenu(lib, s, date);
  const count = Math.floor((Date.parse(date) - Date.parse(from)) / 86400000) + 1;
  if (count > 60) return [];
  const signature = JSON.stringify([from, s.profile, s.diary, s.decisions, s.periods, s.menus]);
  let cached = previews.get(s);
  if (!cached || cached.signature !== signature || cached.rows.length < count) {
    cached = { signature, rows: forecastMenus(lib, s, from, count <= 30 ? 30 : 60) };
    previews.set(s, cached);
  }
  return structuredClone(cached.rows[count - 1]?.meals || []);
}
