// Browser port of bot/prikorm/meal_service.py. No Telegram, network or storage calls.
export const CONSENT_VERSION = "pwa-2026-11-26.1";
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
    schema: 1,
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
export function known(lib, s) {
  const set = new Set();
  for (const name of s.profile?.introduced_names || []) {
    const r = resolve(lib, name);
    if (r.length === 1 && lib.foods.some((f) => f.id === r[0].id))
      set.add(r[0].id);
  }
  for (const row of s.diary)
    if (row.status === "offered") row.ingredients.forEach((i) => set.add(i));
  return set;
}
export function blocked(lib, s) {
  const set = new Set();
  for (const name of s.profile?.excluded_names || []) {
    const q = norm(name);
    const foods = lib.foods.filter((f) =>
      [f.name, f.category, f.allergen].some((x) => norm(x).includes(q)),
    );
    if (!foods.length) set.add("__unresolved__");
    foods.forEach((f) => set.add(f.id));
  }
  for (const [id, v] of Object.entries(s.decisions)) {
    if (v === "returned") set.delete(id);
    else set.add(id);
  }
  return set;
}
export function ready(p, day) {
  if (!p?.consent || !p.active) return false;
  const age = months(p.born, day);
  if (age < 4 || age > 24 || !p.ready) return false;
  if (age < 6)
    return Boolean(
      p.early_doctor_confirmed &&
        p.doctor_plan_note?.trim() &&
        p.doctor_foods?.length,
    );
  return true;
}
export function reason(lib, s, day) {
  const p = s.profile;
  if (!p?.consent)
    return "Чтобы сохранить персональный план, заполните анкету и дайте согласие.";
  const age = months(p.born, day);
  if (age < 4) return "До 4 месяцев прикорм не планируется.";
  if (age > 24) return "Эта библиотека рассчитана на возраст до 24 месяцев.";
  if (!p.ready)
    return "План пока не сформирован: необходимо подтвердить готовность к прикорму после обсуждения с педиатром.";
  if (age < 6 && !ready(p, day))
    return "В 4–5 месяцев нужен индивидуальный сценарий врача: согласование, перечень продуктов и запись рекомендаций в настройках.";
  if (blocked(lib, s).has("__unresolved__"))
    return "Некоторые исключения не удалось сопоставить с библиотекой. Уточните их в настройках; автоматическое меню приостановлено.";
  if (p.risk !== "no")
    return "При медицинских ограничениях автоматически доступны только знакомые продукты или возвращённые после консультации. Если их нет, нужен индивидуальный план врача.";
  return "Нет подходящих позиций с учётом возраста, навыков и ограничений. Не отключайте ограничения ради плана.";
}
export function foodOK(lib, s, key, day, ingredient = false) {
  const p = s.profile,
    f = lib.foods.find((f) => f.id === key);
  if (
    !f ||
    !ready(p, day) ||
    !["active_test", "approved_for_use"].includes(f.status)
  )
    return false;
  const b = blocked(lib, s);
  if (b.has(key) || b.has("__unresolved__")) return false;
  const age = months(p.born, day),
    n = norm(f.name);
  if (!ingredient && f.category === "Жиры") return false;
  if (["соль", "сахар", "сахар добавленный", "соль добавленная"].includes(n))
    return false;
  if (n === "мед" && (age < 12 || !ingredient)) return false;
  const early =
    age < 6 && p.doctor_foods?.includes(key) && f.early_medical_allowed;
  if (age < 6 && !early) return false;
  const dairy =
    ingredient &&
    n === "коровье молоко" &&
    age >= 6 &&
    f.safety?.includes("в составе блюд возможно раньше");
  if (f.min_age == null || (age < f.min_age && !early && !dairy)) return false;
  if (
    p.risk !== "no" &&
    !known(lib, s).has(key) &&
    s.decisions[key] !== "returned"
  )
    return false;
  return !(p.unavailable_foods || []).some((v) => norm(v) === n);
}
const skills = { puree: 0, soft_lumps: 1, soft_pieces: 2, family: 3 };
export function recipeOK(lib, s, key, day, daily = false) {
  const r = lib.recipes.find((r) => r.id === key);
  if (
    !r ||
    !["active_test", "approved_for_use"].includes(r.status) ||
    months(s.profile?.born, day) < r.min_age
  )
    return false;
  if ((skills[s.profile?.food_skill] ?? 0) < (skills[r.texture] ?? 99))
    return false;
  if (
    !r.ingredients.length ||
    !r.ingredients.every((i) => foodOK(lib, s, i.food_id, day, true))
  )
    return false;
  return (
    !daily ||
    new Set(ingredients(lib, key).filter((id) => !known(lib, s).has(id)))
      .size <= 1
  );
}
export function eligible(lib, s, item, day, daily = false) {
  return item.ingredients
    ? recipeOK(lib, s, item.id, day, daily)
    : foodOK(lib, s, item.id, day);
}
export function slots(p, day) {
  const age = months(p.born, day),
    n =
      age < 6
        ? Number(p.doctor_meal_count || 1)
        : Number(
            p.meal_count ||
              (age < 7 ? 1 : age < 9 ? 2 : age < 12 ? 3 : age < 18 ? 4 : 5),
          ),
    count = Math.max(1, Math.min(n, age < 9 ? 3 : age < 12 ? 4 : 5));
  return {
    1: ["Обед"],
    2: ["Завтрак", "Обед"],
    3: ["Завтрак", "Обед", "Ужин"],
    4: ["Завтрак", "Обед", "Полдник", "Ужин"],
    5: ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"],
  }[count];
}
export function createPeriod(lib, s, start = today(s.profile?.zone)) {
  if (!ready(s.profile, start)) return null;
  const existing = s.periods.find(
    (p) => p.start <= start && addDays(p.start, 30) > start,
  );
  if (existing) return existing;
  const k = known(lib, s),
    prior = s.periods.filter((p) => p.start < start).at(-1),
    carry = (prior?.ids || []).filter((id) => !k.has(id));
  const foods = lib.foods.filter((f) => foodOK(lib, s, f.id, start));
  foods.sort(
    (a, b) =>
      Number(carry.includes(b.id)) - Number(carry.includes(a.id)) ||
      Number(k.has(a.id)) - Number(k.has(b.id)) ||
      Number(!!b.iron_rich) - Number(!!a.iron_rich),
  );
  const groups = new Map();
  for (const f of foods) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category).push(f);
  }
  const chosen = [];
  while ([...groups.values()].some((a) => a.length))
    for (const a of groups.values()) if (a.length) chosen.push(a.shift().id);
  const ids = [
    ...carry.filter((id) => foods.some((f) => f.id === id)),
    ...chosen,
  ]
    .filter((id, i, a) => a.indexOf(id) === i)
    .slice(0, 30);
  ids.push(
    ...lib.recipes
      .filter((r) => r.category !== "Соусы" && recipeOK(lib, s, r.id, start))
      .map((r) => r.id),
  );
  if (!ids.length) return null;
  const period = { start, ids, accepted: false, revision: 0 };
  s.periods.push(period);
  return period;
}
// Re-evaluate the current/future periods when skills, restrictions or doctor decisions change.
// Existing replacements and historical meal snapshots remain intact.
export function refreshPeriods(lib, s, from = today(s.profile?.zone)) {
  for (const p of s.periods) {
    if (addDays(p.start, 30) <= from) continue;
    const date = p.start > from ? p.start : from,
      omitted = new Set(p.omitted || []);
    const ids = p.ids.filter((id) => {
      const item = libraryIndex(lib).get(id);
      return item && eligible(lib, s, item, date);
    });
    const foods = lib.foods.filter(
      (f) => foodOK(lib, s, f.id, date) && !omitted.has(f.id),
    );
    let count = ids.filter((id) => lib.foods.some((f) => f.id === id)).length;
    for (const f of foods)
      if (count < 30 && !ids.includes(f.id)) {
        ids.push(f.id);
        count++;
      }
    for (const r of lib.recipes)
      if (
        r.category !== "Соусы" &&
        !ids.includes(r.id) &&
        !omitted.has(r.id) &&
        recipeOK(lib, s, r.id, date)
      )
        ids.push(r.id);
    if (JSON.stringify(ids) !== JSON.stringify(p.ids)) {
      s.changes.push({
        at: new Date().toISOString(),
        action: "adapt_plan",
        start: p.start,
        before: p.ids,
        after: ids,
      });
      p.ids = ids;
      p.revision++;
      p.accepted = false;
    }
  }
}
export function getMenu(lib, s, day = today(s.profile?.zone)) {
  const period = createPeriod(lib, s, day);
  if (!period) return [];
  const old = s.menus[day] || [];
  // Restore marked meals after backup import even though derived pending snapshots are discarded.
  for (const row of s.diary.filter(
    (r) => r.day === day && r.slot !== "-" && r.token === `${day}:${r.slot}`,
  )) {
    if (!old.some((m) => m.id === row.token)) {
      const item = [...libraryIndex(lib).values()].find(
        (i) => i.name === row.name,
      );
      old.push({
        id: row.token,
        slot: row.slot,
        key: item?.id || "",
        name: row.name,
        snapshot: item || {
          name: row.name,
          category: "Запись дневника",
          status: "unverified",
        },
        ingredients: row.ingredients,
        newIDs: row.newIDs || row.ingredients,
        status: row.status === "skipped" ? "skipped" : "done",
      });
    }
  }
  const completed = old.filter((m) => m.status !== "pending");
  if (!ready(s.profile, day)) return completed;
  const index = libraryIndex(lib),
    k = known(lib, s),
    used = new Set(completed.map((m) => m.key)),
    newToday = new Set(completed.flatMap((m) => m.newIDs || []));
  const offset = Math.round(
      (Date.parse(day) - Date.parse(period.start)) / 86400000,
    ),
    carry = new Set(
      s.diary
        .filter((r) => r.status === "skipped")
        .flatMap((r) => r.ingredients)
        .filter((id) => !k.has(id)),
    );
  const foods = period.ids
    .map((id) => index.get(id))
    .filter((f) => f && !f.ingredients && foodOK(lib, s, f.id, day))
    .sort(
      (a, b) =>
        Number(carry.has(b.id)) - Number(carry.has(a.id)) ||
        Number(k.has(a.id)) - Number(k.has(b.id)) ||
        Number(Boolean(b.iron_rich) === (offset % 2 === 0)) -
          Number(Boolean(a.iron_rich) === (offset % 2 === 0)),
    );
  const recipes = period.ids
    .map((id) => index.get(id))
    .filter(
      (r) =>
        r?.ingredients &&
        r.category !== "Соусы" &&
        recipeOK(lib, s, r.id, day, true),
    );
  const result = [];
  for (const slot of slots(s.profile, day)) {
    const done = completed.find((m) => m.slot === slot);
    if (done) {
      result.push(done);
      continue;
    }
    const preferred =
      slot === "Завтрак"
        ? ["Каши", "Запеканки и омлеты"][offset % 2]
        : slot === "Обед"
          ? ["Супы", "Мясо и овощи", "Сытные блюда"][offset % 3]
          : slot === "Ужин"
            ? ["Рыба и овощи", "Тефтели и котлетки", "Мясо и овощи"][offset % 3]
            : "Полдники";
    let rs = recipes.filter((r) =>
      r.meals.includes(
        slot === "Второй завтрак" ? "завтрак" : slot.toLocaleLowerCase("ru"),
      ),
    );
    rs.sort(
      (a, b) =>
        Number(b.category === preferred) - Number(a.category === preferred),
    );
    const pref = rs.filter((r) => r.category === preferred);
    if (pref.length) {
      const n = Math.floor(offset / 2) % pref.length;
      rs = [
        ...pref.slice(n),
        ...pref.slice(0, n),
        ...rs.filter((r) => r.category !== preferred),
      ];
    }
    let candidates =
      slot === "Второй завтрак"
        ? [...foods.filter((f) => f.category === "Фрукты и ягоды"), ...foods]
        : [...rs, ...foods];
    let item = candidates.find(
      (i) =>
        !used.has(i.id) &&
        new Set([
          ...newToday,
          ...ingredients(lib, i.id).filter((id) => !k.has(id)),
        ]).size <= 1,
    );
    if (!item) item = foods.find((f) => k.has(f.id));
    if (!item) continue;
    used.add(item.id);
    const ids = ingredients(lib, item.id),
      newIDs = ids.filter((id) => !k.has(id));
    newIDs.forEach((id) => newToday.add(id));
    result.push({
      id: `${day}:${slot}`,
      slot,
      key: item.id,
      name: item.name,
      snapshot: structuredClone(item),
      ingredients: ids,
      newIDs,
      status: "pending",
    });
  }
  s.menus[day] = result;
  return result;
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
    token,
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
  if (meal?.status !== "pending" && meal) throw Error("Этот приём уже отмечен");
  if (meal && !skip && !eligible(lib, s, meal.snapshot, day, true))
    throw Error("Приём больше не соответствует ограничениям. Обновите меню.");
  const row = {
    id: crypto.randomUUID(),
    token: key,
    day,
    name: name || meal?.name || "-",
    form: form.trim() || "-",
    quantity: quantity.trim() || "-",
    reaction: reaction.trim() ? reaction : "-",
    comment,
    ingredients: ids ?? meal?.ingredients ?? [],
    newIDs: meal?.newIDs || [],
    status: skip ? "skipped" : "offered",
    slot: meal?.slot || "-",
    createdAt: new Date().toISOString(),
  };
  s.diary.push(row);
  if (meal) meal.status = skip ? "skipped" : "done";
  if (!skip && !["-", "Нет реакции", "нет реакции"].includes(row.reaction)) {
    row.ingredients.forEach((id) => (s.decisions[id] = "pending"));
    s.changes.push({
      at: row.createdAt,
      action: "reaction",
      ids: row.ingredients,
      text: row.reaction,
    });
  }
  // Pending menus are recalculated using current knowledge; completed snapshots stay immutable.
  return true;
}
export function decide(s, ids, status) {
  if (!["returned", "excluded"].includes(status))
    throw Error("Неверное решение");
  for (const id of ids) s.decisions[id] = status;
  s.changes.push({ at: new Date().toISOString(), action: status, ids });
}
export function validateBackup(data, lib) {
  if (
    !data ||
    data.app !== "holy-mommy-pwa" ||
    data.version !== 1 ||
    !data.state ||
    JSON.stringify(data).length > 5000000
  )
    throw Error("Неверный формат резервной копии");
  const s = data.state,
    index = libraryIndex(lib);
  if (
    s.schema !== 1 ||
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
      !["no", "yes"].includes(s.profile.risk) ||
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
    s.periods.length > 200 ||
    s.diary.some(
      (r) =>
        !validDate(r.day) ||
        !["offered", "skipped"].includes(r.status) ||
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
        d.answers.consent_version !== CONSENT_VERSION ||
        !Number.isInteger(d.step) ||
        d.step < 0 ||
        d.step > 10)
    )
      throw Error("Некорректное согласие в черновике");
  }
  return structuredClone(s);
}
export function backup(s) {
  return {
    app: "holy-mommy-pwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    state: structuredClone(s),
  };
}
