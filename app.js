import * as E from "./engine.js";
import { openStore, load, save, clear } from "./store.js";
const $ = (s) => document.querySelector(s),
  app = $("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (label, action, cls = "") =>
  `<button class="${cls}" data-action="${esc(action)}">${label}</button>`;
const home = () => '<a class="button" href="#today">🏠 В меню</a>';
const note = () => `<div class="notice">${E.NOTICE}</div>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (label, name, options, value) =>
  `<label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([v, t]) => `<option value="${v}" ${v === String(value) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
const dateText = (d) => d?.split("-").reverse().join(".") || "-";
let db,
  s,
  lib,
  idx,
  working = false,
  installPrompt = null,
  temporary = null,
  search = "",
  category = "",
  kind = "food",
  page = 0;
let onboarding = null,
  step = 0,
  noticeSeen = false;
const announce = (t) => {
  $("#status").textContent = t;
  setTimeout(() => ($("#status").textContent = ""), 6000);
};
async function persist() {
  await save(db, s);
}
function go(route) {
  if (location.hash === "#" + route) render();
  else location.hash = route;
}
function active() {
  return Boolean(s.profile?.consent && s.profile.active);
}
function day() {
  return E.today(s.profile?.zone);
}
function cards(items) {
  return items
    .map(
      (i) =>
        `<button class="item" data-action="card:${i.id}"><span>${esc(i.name)}<small>${esc(i.category)} · от ${i.min_age ?? "?"} мес.</small></span><span aria-hidden="true">›</span></button>`,
    )
    .join("");
}
function title(kicker, text) {
  return `<p class="eyebrow">${kicker}</p><h1>${text}</h1>`;
}
function errorMessage(error) {
  announce(error.message || String(error));
  console.error(error);
}
async function start() {
  try {
    if (navigator.locks) {
      const acquired = await new Promise((resolve) =>
        navigator.locks.request(
          "holy-mommy-editor",
          { ifAvailable: true },
          (lock) => {
            resolve(Boolean(lock));
            return lock ? new Promise(() => {}) : undefined;
          },
        ),
      );
      if (!acquired) {
        app.innerHTML =
          "<h1>Приложение уже открыто</h1><p>Чтобы не перезаписать дневник, закройте другое окно Holy Mommy и перезагрузите эту страницу.</p>";
        return;
      }
    }
    [db, lib] = await Promise.all([
      openStore(),
      fetch("./library.json").then((r) => {
        if (!r.ok) throw Error("Не удалось загрузить библиотеку");
        return r.json();
      }),
    ]);
    s = await load(db);
    idx = E.libraryIndex(lib);
    onboarding = s.draft?.type === "onboarding" ? s.draft.answers : null;
    step = s.draft?.step || 0;
    await render();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("./sw.js", { scope: "./" })
        .then((reg) => {
          if (reg.waiting)
            announce(
              "Обновление готово. Закройте все окна приложения и откройте снова.",
            );
          reg.addEventListener("updatefound", () =>
            reg.installing?.addEventListener("statechange", () => {
              if (reg.waiting && navigator.serviceWorker.controller)
                announce(
                  "Доступна новая версия. Закройте все окна приложения после сохранения.",
                );
            }),
          );
        })
        .catch(() =>
          announce(
            "Офлайн-кэш недоступен. Проверьте HTTPS и настройки браузера.",
          ),
        );
  } catch (error) {
    app.innerHTML =
      "<h1>Не удалось открыть приложение</h1><p>Для первого запуска нужен интернет. Проверьте, что браузеру разрешено локальное хранение данных, затем перезагрузите страницу.</p>";
    errorMessage(error);
  }
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
document.addEventListener(
  "click",
  (event) => {
    if (working && event.target.closest("a")) {
      event.preventDefault();
      announce("Сохраняем изменения…");
    }
  },
  true,
);
window.addEventListener("hashchange", () => render().catch(errorMessage));
async function render() {
  if (!s) return;
  let [route, arg] = location.hash.slice(1).split("/");
  route ||= "today";
  document
    .querySelectorAll("nav a")
    .forEach((a) =>
      a.setAttribute("aria-current", a.hash === "#" + route ? "page" : "false"),
    );
  if (route === "onboarding") {
    renderQuestion();
    return;
  }
  if (route === "library") {
    renderLibrary();
    return;
  }
  if (route === "card") {
    renderCard(arg);
    return;
  }
  if (route === "preparation") {
    renderPreparation();
    return;
  }
  if (route === "reactions") {
    renderReactions();
    return;
  }
  if (route === "settings") {
    renderSettings();
    return;
  }
  if (!active()) {
    app.innerHTML =
      title("Прикорм · с заботой", "Маленькие шаги<br>к большой еде") +
      `<div class="card lavender"><h2>Ваш спокойный помощник</h2><p>Анкета, гибкий план питания и дневник — на вашем телефоне. Без аккаунта, сервера и передачи ответов.</p></div>${note()}${button(onboarding ? "Продолжить анкету" : "Начать знакомство", "begin", "primary wide")}<a class="button wide" href="#library">📚 Библиотека · 119 продуктов и 216 рецептов</a><a class="button wide" href="#reactions">⚠️ Памятка по реакциям</a><p class="muted">Материалы предварительные. Они помогают проверить приложение, а не заменяют консультацию врача.</p>`;
    return;
  }
  if (route === "plan") await renderPlan(arg);
  else if (route === "diary") renderDiary();
  else if (route === "meal") renderMeal(arg);
  else if (route === "entry") renderEntry();
  else if (route === "editplan") renderEditPlan();
  else if (route === "shopping") renderShopping();
  else await renderToday(arg);
}
function renderQuestion() {
  onboarding ||= {
    name: "",
    born: "",
    ready: false,
    started: false,
    introduced_names: [],
    risk: "unknown",
    excluded_names: [],
    notifications_requested: false,
    zone: "Europe/Moscow",
    food_skill: "puree",
  };
  const a = onboarding;
  if (!noticeSeen && !a.consent) {
    app.innerHTML =
      title("Перед началом", "Давайте познакомимся") +
      note() +
      `<p>Мы не ставим диагнозы и не назначаем лечение. При экстренных симптомах обращайтесь за медицинской помощью.</p>${button("Ознакомился", "ack", "primary wide")}<a class="button" href="#library">Посмотреть библиотеку</a>`;
    return;
  }
  const qs = [
    [
      "Как зовут ребёнка?",
      field(
        "Имя (можно вымышленное)",
        "name",
        a.name,
        "text",
        'required maxlength="100" autocomplete="off"',
      ),
    ],
    [
      "Когда родился ребёнок?",
      field("Дата рождения", "born", a.born, "date", `required max="${day()}"`),
    ],
    [
      "Готовность к прикорму",
      select(
        "Есть ли признаки готовности?",
        "ready",
        [
          ["", "Выберите ответ"],
          ["yes", "Да"],
          ["no", "Нет"],
        ],
        a.readiness_answer || "",
      ) +
        "<details><summary>Как оценить готовность?</summary><p>Ребёнок удерживает голову, может находиться вертикально сидя с необходимой поддержкой, координирует движения рук, глаз и рта и проглатывает пищу. Не нужно ждать самостоятельного сидения. Обсудите готовность с педиатром.</p></details>",
    ],
    [
      "Уже начали прикорм?",
      select(
        "Прикорм начат?",
        "started",
        [
          ["no", "Нет"],
          ["yes", "Да"],
        ],
        a.started ? "yes" : "no",
      ),
    ],
    [
      "Какие продукты уже ввели?",
      field(
        "Названия через запятую",
        "introduced",
        a.introduced_names.join(","),
        "text",
        'maxlength="5000"',
      ) +
        '<p class="muted">Сохраним как сведения анкеты, без выдуманных дат и количества.</p>',
    ],
    [
      "Есть медицинские ограничения?",
      select(
        "Ограничения или рекомендации врача",
        "risk",
        [
          ["unknown", "Не знаю — нужно уточнить с педиатром"],
          ["no", "Нет"],
          ["yes", "Да"],
        ],
        a.risk,
      ) +
        '<p class="muted">При ответе «Да» новые продукты автоматически не назначаются. Доступны знакомые или возвращённые после консультации.</p>',
    ],
    [
      "Что нужно исключить?",
      field(
        "Продукты или группы через запятую",
        "excluded",
        a.excluded_names.join(","),
        "text",
        'required maxlength="5000"',
      ) +
        '<p class="muted">Если название не распознано, автоматический план будет приостановлен.</p>',
    ],
    [
      "Ежедневные напоминания",
      select(
        "Показывать напоминание при открытии приложения?",
        "notifications",
        [
          ["no", "Нет"],
          ["yes", "Да"],
        ],
        a.notifications_requested ? "yes" : "no",
      ) +
        '<p class="notice">Закрытая PWA не отправляет сообщения по расписанию. Уведомления Telegram сюда не переносятся. Меню доступно в любое время.</p>',
    ],
    [
      "В какое время напомнить?",
      field(
        "Ориентир утреннего напоминания",
        "time",
        a.time || "09:00",
        "time",
        "required",
      ) +
        '<p class="muted">Напоминание появится внутри открытого приложения после этого времени.</p>',
    ],
    [
      "Согласие на локальное хранение",
      `<p>Анкета, дата рождения, продукты, дневник и сведения о реакциях будут храниться только в IndexedDB этого браузера на этом устройстве до удаления данных. Они не отправляются разработчику, в Telegram или на сервер.</p><p>Резервная копия содержит эти данные: сохраняйте её в надёжном месте. Очистка браузера или смена телефона могут удалить данные. Фотографии и Telegram ID не собираются.</p><p class="muted">Версия согласия: ${E.CONSENT_VERSION}. Согласие для Telegram ${lib.schema_version ? "не переносится автоматически" : ""}.</p><label><input type="checkbox" name="consent" required ${a.consent ? "checked" : ""}>Согласен(на) на локальное хранение перечисленных данных</label>${button("Не согласен(на)", "decline")}`,
    ],
    [
      "Всё верно?",
      summary(a) +
        `<p class="muted">После сохранения можно указать пищевые навыки в настройках. По умолчанию — пюре; навыки не определяются только возрастом.</p>`,
    ],
  ];
  const [head, body] = qs[step];
  app.innerHTML =
    title(`Анкета · ${step + 1} из 11`, head) +
    `<div class="progress"><i style="width:${((step + 1) / 11) * 100}%"></i></div><form id="question">${body}<div class="actions">${step ? button("← Назад", "back") : home()}<button class="primary" type="submit">${step === 10 ? "Всё верно" : "Далее →"}</button></div></form>${step ? home() : ""}<p class="muted">До согласия ответы находятся только в памяти открытой страницы. После согласия черновик можно продолжить после перезапуска.</p>`;
  $("#question").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const f = new FormData(e.target);
      if (step === 0) a.name = String(f.get("name")).trim();
      if (step === 1) {
        a.born = f.get("born");
        if (!E.validDate(a.born) || a.born > day())
          throw Error("Проверьте дату рождения");
      }
      if (step === 2) {
        a.readiness_answer = f.get("ready");
        if (!a.readiness_answer) throw Error("Выберите ответ");
        a.ready = a.readiness_answer === "yes";
      }
      if (step === 3) {
        a.started = f.get("started") === "yes";
        if (!a.started) a.introduced_names = [];
      }
      if (step === 4) a.introduced_names = E.split(f.get("introduced"));
      if (step === 5) {
        a.risk = f.get("risk");
        if (a.risk === "unknown")
          throw Error(
            "Уточните ограничения у педиатра. До этого можно пользоваться библиотекой без персонального плана.",
          );
        if (a.risk === "no") a.excluded_names = [];
      }
      if (step === 6) a.excluded_names = E.split(f.get("excluded"));
      if (step === 7) {
        a.notifications_requested = f.get("notifications") === "yes";
        if (!a.notifications_requested) delete a.time;
      }
      if (step === 8) a.time = f.get("time");
      if (step === 9) {
        a.consent = true;
        a.consent_version = E.CONSENT_VERSION;
        a.consent_at = new Date().toISOString();
      }
      if (step === 10) {
        s.profile = { ...a, active: true };
        s.draft = null;
        onboarding = null;
        E.createPeriod(lib, s);
        await persist();
        go("today");
        return;
      }
      step++;
      if (step === 4 && !a.started) step++;
      if (step === 6 && a.risk === "no") step++;
      if (step === 8 && !a.notifications_requested) step++;
      if (a.consent) {
        s.draft = { type: "onboarding", answers: a, step };
        await persist();
      }
      renderQuestion();
    });
  };
}
function summary(a) {
  return `<div class="card"><h2>${esc(a.name)}</h2><p>Дата рождения: ${dateText(a.born)}<br>Готовность: ${a.ready ? "Да" : "Нет"}<br>Прикорм начат: ${a.started ? "Да" : "Нет"}<br>Ввели: ${esc(a.introduced_names.join(", ") || "—")}<br>Ограничения: ${a.risk === "yes" ? "Да" : "Нет"}<br>Исключения: ${esc(a.excluded_names.join(", ") || "—")}<br>Напоминания в приложении: ${a.notifications_requested ? esc(a.time) : "Нет"}</p></div>`;
}
function renderLibrary() {
  let list = kind === "food" ? lib.foods : lib.recipes;
  const cats = [...new Set(list.map((i) => i.category))].sort();
  list = list.filter(
    (i) =>
      (!category || category === i.category) &&
      E.norm(i.name).includes(E.norm(search)),
  );
  page = Math.max(0, Math.min(page, Math.ceil(list.length / 20) - 1));
  app.innerHTML =
    title("Библиотека", "Всё о маленькой еде") +
    note() +
    `<div class="row">${button("Продукты · 119", "kind:food", kind === "food" ? "primary" : "")}${button("Рецепты · 216", "kind:recipe", kind === "recipe" ? "primary" : "")}</div>${field("Поиск по названию", "search", search, "search")}<label for="category">Категория</label><select id="category"><option value="">Все категории</option>${cats.map((c) => `<option ${c === category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select><p class="muted">Найдено: ${list.length}. Каталог включает позиции для других возрастов; доступность плана проверяется отдельно.</p><div id="results">${cards(list.slice(page * 20, page * 20 + 20)) || "<p>Ничего не найдено</p>"}</div><div class="row">${page ? button("← Ранее", "page:-1") : ""}${(page + 1) * 20 < list.length ? button("Далее →", "page:1") : ""}</div>${home()}`;
  $("#search").oninput = (e) => {
    search = e.target.value;
    page = 0;
    const pos = e.target.selectionStart;
    renderLibrary();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  };
  $("#category").onchange = (e) => {
    category = e.target.value;
    page = 0;
    renderLibrary();
  };
}
function details(item) {
  const ingredients = item.ingredients
    ?.map(
      (i) =>
        `${idx.get(i.food_id)?.name || i.food_id} — ${i.amount ?? "—"} ${i.unit || ""}`,
    )
    .join("\n");
  const allergies = item.ingredients
    ? item.ingredients.map((i) => idx.get(i.food_id)?.allergen || "не указана")
    : [item.allergen || "не указана"];
  return (
    note() +
    `<div class="card"><p class="eyebrow">${esc(item.category)} · ${esc(item.status)}</p><h2>${esc(item.name)}</h2><p>Возрастной ориентир: ${item.min_age ?? "не указан"} мес. Это не обязательная дата введения.</p>${ingredients ? `<h3>Ингредиенты для приготовления</h3><p style="white-space:pre-line">${esc(ingredients)}</p><p class="muted">Закладка для приготовления, не норма съедания.</p>` : ""}<h3>Приготовление и подача</h3><p>${esc(item.how || item.form || "Не указаны в источнике")}</p>${item.how ? `<p>${esc(item.form)}</p>` : ""}<h3>Условия и безопасность</h3><p>${esc(item.condition || "Условия определяются ингредиентами и навыками.")}</p><p>${esc(item.safety || "См. ограничения ингредиентов. Дополнительные сведения не указаны.")}</p><p>Аллергенность: ${esc([...new Set(allergies)].join(", "))}. Неизвестная маркировка не означает отсутствие аллергена.</p>${item.ingredients ? `<p>Хранение: ${esc(item.storage || "не указано")}. Повторный разогрев: ${esc(item.reheat || "не указано")}.</p>` : ""}<p class="muted">Источники: ${esc(item.sources || "не указаны")}</p>${
      item.ingredients
        ? `<details><summary>Ограничения ингредиентов</summary>${item.ingredients
            .map((i) => {
              const f = idx.get(i.food_id);
              return `<h3>${esc(f.name)}</h3><p>${esc(f.condition)}. ${esc(f.safety)}</p>`;
            })
            .join("")}</details>`
        : ""
    }${item.audit ? `<details><summary>Что требует проверки</summary><ul>${item.audit.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>` : ""}</div>`
  );
}
function renderCard(id) {
  const item = idx.get(id);
  if (!item) {
    go("library");
    return;
  }
  app.innerHTML =
    title("Карточка", esc(item.name)) +
    details(item) +
    (active()
      ? `<div class="notice ${E.eligible(lib, s, item, day()) ? "" : "warning"}">${E.eligible(lib, s, item, day()) ? "Подходит по текущим техническим ограничениям. Медицинского одобрения нет." : "Не предлагается автоматически с текущим возрастом, навыками или ограничениями."}</div>${button("➕ Добавить в дневник", `add:${id}`, "primary")}${!item.ingredients ? button("✅ Уже пробовали", `known:${id}`) : ""}`
      : "") +
    '<a class="button" href="#library">← Библиотека</a>' +
    home();
}
async function renderToday(selected) {
  const d = E.validDate(selected) ? selected : day();
  const menu = E.getMenu(lib, s, d);
  await persist();
  const p = E.createPeriod(lib, s, d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: s.profile.zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const reminder =
    s.profile.notifications_requested &&
    d === day() &&
    time >= (s.profile.time || "09:00") &&
    menu.some((m) => m.status === "pending");
  app.innerHTML =
    title(
      d === day() ? "Сегодня · " + dateText(d) : "Просмотр · " + dateText(d),
      `Что сегодня на столе?`,
    ) +
    `<p class="muted">${esc(s.profile.name)} · ${E.months(s.profile.born, d)} мес.</p>${reminder ? '<div class="notice">💜 Не забудьте отметить приёмы пищи, чтобы сохранить информацию в дневнике прикорма.</div>' : ""}${!p?.accepted ? '<p class="notice">Предварительный план. Просмотрите и примите его в разделе «План».</p>' : ""}${note()}${menu.length ? menu.map((m) => `<button class="card item" data-action="meal:${d}|${m.id}"><span><small>${esc(m.slot)} · ${{ done: "Сохранено", skipped: "Пропущено", pending: "Не отмечено" }[m.status]}</small>${esc(m.name)} ${m.newIDs.length ? "🆕" : ""}</span><span>›</span></button>`).join("") : `<div class="card"><h2>План пока не доступен</h2><p>${esc(E.reason(lib, s, d))}</p><a class="button" href="#settings">Проверить настройки</a></div>`}<p class="muted">Вода с едой; грудное молоко/смесь продолжаются по возрасту и рекомендациям. Не заставляйте доедать.</p><div class="row">${button("← День раньше", `day:${E.addDays(d, -1)}`)}${button("День вперёд →", `day:${E.addDays(d, 1)}`)}</div><a class="button wide" href="#library">📚 Продукты и рецепты</a><a class="button" href="#preparation">Подготовка к прикорму</a>${d !== day() ? '<a class="button" href="#today">Вернуться к сегодняшнему дню</a>' : ""}`;
}
function renderMeal(arg) {
  const [d, id] = decodeURIComponent(arg || "").split("|");
  const meal = s.menus[d]?.find((m) => m.id === id);
  if (!meal) {
    go("today");
    return;
  }
  s.ui.lastMeal = { day: d, id };
  persist().catch(errorMessage);
  app.innerHTML =
    title(`${dateText(d)} · ${esc(meal.slot)}`, esc(meal.name)) +
    details(meal.snapshot) +
    `${meal.status === "pending" && d <= day() ? button("✅ Ввели", `ate:${d}|${id}`, "primary") + button("⏭ Пропустили", `skip:${d}|${id}`) + button("➕ Ввели другое", `other:${d}|${id}`) : `<p class="notice">${d > day() ? "Будущий день: только просмотр. Дата и дневник не изменяются." : "Этот приём уже отмечен."}</p>`}<a class="button" href="#today/${d}">← К меню дня</a>${home()}`;
}
function grouped(ids) {
  const groups = new Map();
  for (const id of ids) {
    const i = idx.get(id);
    if (!i) continue;
    const c = i.category;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  }
  return [...groups]
    .map(
      ([c, items]) =>
        `<details open><summary>${esc(c)} · ${items.length}</summary><ul>${items.map((i) => `<li>${esc(i.name)} ${E.known(lib, s).has(i.id) ? "<small>уже введён</small>" : ""}</li>`).join("")}</ul></details>`,
    )
    .join("");
}
async function renderPlan(selected) {
  const start = E.validDate(selected) ? selected : day(),
    p = E.createPeriod(lib, s, start);
  await persist();
  app.innerHTML =
    title("Гибкий план", "Ваш ближайший месяц") +
    note() +
    (p
      ? `<p>${dateText(p.start)} — ${dateText(E.addDays(p.start, 29))}</p><p class="muted">Цели и доступные блюда, а не обязательная программа. Ежедневно выбираются позиции с учётом фактического дневника и навыков.</p><div class="row">${button(p.accepted ? "✓ План принят" : "Принять план", `accept:${p.start}`, "primary")}${button(s.draft?.type === "replace" ? "Продолжить замены" : "Заменить позиции", `edit:${p.start}`)}</div><a class="button" href="#shopping/${p.start}">🛒 Список покупок</a>${grouped(p.ids)}${button("Следующий месяц", `nextperiod:${E.addDays(p.start, 30)}`)}`
      : `<div class="card"><p>${esc(E.reason(lib, s, start))}</p></div>`) +
    `<a class="button wide" href="#library">📚 Полная библиотека</a>${home()}`;
}
function renderEntry() {
  const d = s.draft?.type === "entry" ? s.draft : null;
  if (d?.mealID && !s.menus[d.day]) E.getMenu(lib, s, d.day);
  if (!d) {
    go("diary");
    return;
  }
  app.innerHTML =
    title("Дневник", "Что получилось попробовать?") +
    `<div class="emergency" id="urgent" hidden><strong>Немедленно вызовите скорую помощь по местному номеру (в России — 112).</strong><p>Не ждите сохранения записи или ответа приложения. При нарушении дыхания, отёке языка/горла, удушье нужна срочная помощь.</p></div><form id="entry">${field("Дата", "date", d.day, "date", `required max="${day()}" ${d.mealID || (d.slot && d.slot !== "-") ? "readonly" : ""}`)}${field("Фактически съели (через запятую)", "name", d.name, "text", `required maxlength="5000" ${d.planned ? "readonly" : ""}`)}${field("Форма подачи (неизвестно — дефис)", "form", d.form || "-", "text", 'maxlength="1000"')}${field("Фактическое количество (неизвестно — дефис)", "quantity", d.quantity || "-", "text", 'maxlength="1000"')}${select(
      "Реакция",
      "reaction",
      [
        ["Нет реакции", "Нет реакции"],
        ["Сыпь", "Сыпь"],
        ["Рвота", "Рвота"],
        ["Изменение стула", "Изменение стула"],
        ["Другое", "Другое"],
      ],
      d.reaction || "Нет реакции",
    )}<label for="symptoms">Симптомы или комментарий (сохраним исходный текст)</label><textarea id="symptoms" name="symptoms" maxlength="5000">${esc(d.symptoms || "")}</textarea><p class="muted">Неизвестные названия сохраняются без рекомендаций. При реакции возможные ингредиенты отправляются на проверку педиатру; приложение не определяет причину.</p><button class="primary" type="submit">Сохранить запись</button><a class="button" href="#reactions">⚠️ Экстренная памятка</a></form>${home()}`;
  const form = $("#entry");
  form.oninput = () => {
    const f = new FormData(form);
    Object.assign(d, {
      day: f.get("date"),
      name: f.get("name"),
      form: f.get("form"),
      quantity: f.get("quantity"),
      reaction: f.get("reaction"),
      symptoms: f.get("symptoms"),
    });
    $("#urgent").hidden = !E.emergency(d.symptoms);
    persist().catch(errorMessage);
  };
  form.onchange = form.oninput;
  form.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (E.emergency(d.symptoms)) {
        $("#urgent").hidden = false;
        if (
          !confirm(
            "Экстренная инструкция показана. Сначала вызовите помощь. Сохранить запись?",
          )
        )
          return;
      }
      const names = E.split(d.name),
        matches = names.map((n) => E.resolve(lib, n)),
        ids = [
          ...new Set(
            matches
              .filter((r) => r.length === 1)
              .flatMap((r) => E.ingredients(lib, r[0].id)),
          ),
        ];
      if (
        matches.some((r) => r.length !== 1) &&
        !confirm(
          "Есть неизвестные или неоднозначные названия. Сохранить как непроверенную запись без рекомендаций?",
        )
      )
        return;
      const hasReaction =
        d.reaction !== "Нет реакции" || E.emergency(d.symptoms);
      const reaction = hasReaction
        ? d.symptoms?.trim()
          ? d.symptoms
          : d.reaction
        : "Нет реакции";
      const comment = hasReaction ? "" : d.symptoms || "";
      if (d.editID) {
        const old = s.diary.find((r) => r.id === d.editID);
        if (!old) throw Error("Запись не найдена");
        if (d.day > day() || !E.validDate(d.day)) throw Error("Проверьте дату");
        const before = structuredClone(old);
        Object.assign(old, {
          name: d.name,
          day: d.day,
          form: d.form || "-",
          quantity: d.quantity || "-",
          reaction,
          comment,
          ingredients: ids,
        });
        if (reaction !== "Нет реакции" && reaction !== "-")
          ids.forEach((id) => (s.decisions[id] = "pending"));
        s.changes.push({
          at: new Date().toISOString(),
          action: "edit",
          id: old.id,
          before,
          after: structuredClone(old),
        });
      } else
        E.record(lib, s, {
          day: d.day,
          mealID: d.mealID,
          name: d.name,
          form: d.form,
          quantity: d.quantity,
          reaction,
          comment,
          ids: d.planned ? d.ids : ids,
          token: d.token,
        });
      s.draft = null;
      await persist();
      announce("Запись внесена в дневник");
      go("diary");
    });
  };
}
function renderDiary() {
  const rows = [...s.diary].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt),
  );
  const k = E.known(lib, s),
    b = E.blocked(lib, s),
    pending = Object.entries(s.decisions).filter(([, v]) => v === "pending"),
    excluded = Object.entries(s.decisions).filter(([, v]) => v === "excluded");
  const current = E.createPeriod(lib, s);
  app.innerHTML =
    title("История питания", "Дневник маленьких открытий") +
    `<div class="no-print">${s.draft?.type === "entry" ? '<a class="button wide" href="#entry">Продолжить незавершённую запись</a>' : ""}${button("➕ Добавить продукты", "manual", "primary")}${button("📄 Печать / PDF", "print")}<details><summary>✅ Уже ввели · ${k.size}</summary><p>${esc([...k].map((id) => idx.get(id)?.name).join(", ") || "Пока нет записей")}</p></details><details><summary>🥕 Ещё не ввели</summary><p>${esc(
      (current?.ids || [])
        .filter((id) => !idx.get(id)?.ingredients && !k.has(id))
        .map((id) => idx.get(id).name)
        .join(", ") || "Нет активных целей",
    )}</p></details><details open><summary>🩺 На проверке у педиатра · ${pending.length}</summary>${pending.map(([id]) => `<p>${esc(idx.get(id)?.name)} ${button("Вернуть", `return:${id}`)}${button("Исключить", `exclude:${id}`)}</p>`).join("") || "<p>Нет продуктов на проверке</p>"}<p class="muted">Не утверждаем, что эти ингредиенты вызвали реакцию. Решение о возвращении обсудите с врачом. История реакций сохраняется.</p></details><details><summary>Исключены из питания · ${b.size}</summary><p>${esc([...b].map((id) => idx.get(id)?.name || "Нераспознанное исключение").join(", ") || "Нет")}</p>${excluded.map(([id]) => button("Вернуть " + esc(idx.get(id)?.name), `return:${id}`)).join("")}</details><a class="button" href="#reactions">⚠️ Памятка по реакциям</a></div><h2>Хронология</h2><p class="print-only">${esc(s.profile.name)} · дата рождения ${dateText(s.profile.born)}. ${E.NOTICE}</p>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Продукт / блюдо</th><th>Форма</th><th>Количество</th><th>Реакция</th><th class="no-print"></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${dateText(r.day)}</td><td>${esc(r.name)}${r.status === "skipped" ? " (пропущено)" : ""}<small>${esc(r.slot)}</small>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</td><td>${esc(r.status === "skipped" ? "-" : r.form)}</td><td>${esc(r.status === "skipped" ? "-" : r.quantity)}</td><td style="white-space:pre-wrap">${esc(r.status === "skipped" ? "-" : r.reaction)}</td><td class="no-print">${r.status !== "skipped" ? button("Изменить", `editentry:${r.id}`) : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="card empty"><span class="symbol">🌱</span><p>Здесь появятся ваши записи.</p></div>'}<div class="no-print">${home()}</div>`;
}
function renderPreparation() {
  const labels = {
    preparation: "Безопасная подготовка",
    shopping: "Что подготовить",
    method: "Способы приготовления",
    not_ready: "Если готовность пока не подтверждена",
  };
  app.innerHTML =
    title("Перед первым шагом", "Подготовка к прикорму") +
    note() +
    lib.materials
      .filter((m) => labels[m.id])
      .map(
        (m) =>
          `<div class="card"><h2>${labels[m.id]}</h2><p>${esc(m.text)}</p><p class="muted">Исходный статус: ${esc(m.status)}</p></div>`,
      )
      .join("") +
    home();
}
function renderReactions() {
  app.innerHTML =
    title("Рядом, когда тревожно", "Памятка по реакциям") +
    `<div class="emergency"><strong>При нарушении дыхания, отёке языка/горла, потере сознания или удушье — немедленно вызовите скорую помощь по местному номеру (в России — 112).</strong><p>Не ждите заполнения дневника. Приложение не диагностирует и не назначает лечение.</p></div>${note()}${lib.reactions.map((r) => `<details class="card"><summary>${esc(r.symptoms)}</summary><p><strong>${esc(r.urgency)}</strong></p><p>${esc(r.text)}</p><p class="muted">Требуется проверка педиатром</p></details>`).join("")}${home()}`;
}
function renderSettings() {
  app.innerHTML =
    title("Всё под вашим контролем", "Настройки") +
    `<div class="card"><h2>На вашем телефоне</h2><p>Данные находятся в этом браузере. Аккаунта и синхронизации нет. Сохраните резервную копию перед очисткой браузера или сменой телефона.</p>${button("Экспорт резервной копии", "export", "primary")}<label for="import">Восстановить из файла JSON</label><input id="import" type="file" accept="application/json,.json"><p class="muted">Импорт заменит данные после проверки и подтверждения. Копия содержит личные сведения — не публикуйте её.</p></div>` +
    (active()
      ? `<form id="preferences" class="card"><h2>Профиль и безопасность</h2>${summary(s.profile)}${field("Имя ребёнка", "profile_name", s.profile.name, "text", 'required maxlength="100"')}${field("Дата рождения ребёнка", "profile_born", s.profile.born, "date", `required max="${day()}"`)}${field("Уже введённые продукты через запятую", "introduced_names", s.profile.introduced_names.join(","), "text", 'maxlength="5000"')}${select(
          "Медицинские ограничения",
          "risk",
          [
            ["no", "Нет"],
            ["yes", "Да"],
            ["unknown", "Нужно уточнить с врачом"],
          ],
          s.profile.risk,
        )}${select(
          "Освоенная текстура (по навыкам, не возрасту)",
          "food_skill",
          [
            ["puree", "Пюре"],
            ["soft_lumps", "Мягкие комочки"],
            ["soft_pieces", "Мягкие кусочки"],
            ["family", "Адаптированная семейная еда"],
          ],
          s.profile.food_skill,
        )}${select(
          "Готовность к прикорму",
          "ready",
          [
            ["yes", "Подтверждена"],
            ["no", "Пока нет"],
          ],
          s.profile.ready ? "yes" : "no",
        )}${select(
          "Число приёмов (можно уменьшить)",
          "meal_count",
          [
            ["", "По возрастному ориентиру"],
            ["1", "1"],
            ["2", "2"],
            ["3", "3"],
            ["4", "4"],
            ["5", "5"],
          ],
          s.profile.meal_count || "",
        )}${field("Исключения через запятую", "excluded", s.profile.excluded_names.join(","), "text", 'maxlength="5000"')}${field("Недоступные продукты через запятую", "unavailable", (s.profile.unavailable_foods || []).join(","), "text", 'maxlength="5000"')}${field("Часовой пояс (например Europe/Moscow)", "zone", s.profile.zone, "text", "required")}${select(
          "Напоминания внутри открытой PWA",
          "notifications",
          [
            ["no", "Выключены"],
            ["yes", "Включены"],
          ],
          s.profile.notifications_requested ? "yes" : "no",
        )}${field("Утреннее напоминание внутри приложения", "time", s.profile.time || "09:00", "time")}<p class="notice">При закрытом приложении уведомления не отправляются. Здесь нет фоновой рассылки. Вечерняя проверка неотмеченных приёмов видна при открытии «Сегодня».</p><details><summary>Индивидуальный сценарий врача для 4–5 месяцев</summary><label><input name="early" type="checkbox" ${s.profile.early_doctor_confirmed ? "checked" : ""}>Начало согласовано с врачом</label>${field("Дата консультации", "consultation", s.profile.doctor_consultation_date || "", "date", `max="${day()}"`)}${field("Рекомендации врача (своими словами)", "doctor_note", s.profile.doctor_plan_note || "", "text", 'maxlength="5000"')}${field("Разрешённые врачом продукты из базы через запятую", "doctor_foods", (s.profile.doctor_foods || []).map((id) => idx.get(id)?.name).join(","), "text", 'maxlength="5000"')}<p class="muted">Не стандартная схема. Возрастные условия, готовность, исключения и реакции сохраняются.</p></details><button type="submit" class="primary">Сохранить настройки</button></form><div class="card"><h2>Управление данными</h2>${button("🔄 Начать заново / удалить данные", "reset", "danger")}<p class="muted">Удаляются анкета, согласие, план, дневник и черновики только в этой PWA. Telegram-база не затрагивается.</p></div>`
      : '<a class="button" href="#today">Начать анкету</a>') +
    `<div class="card"><h2>Установить на телефон</h2>${button("Установить приложение", "install")}<p>Android: меню браузера → «Установить приложение». iPhone: откройте в Safari → «Поделиться» → «На экран Домой».</p><p class="muted">Для первого открытия нужен интернет. После загрузки приложение работает офлайн. Для обновления откройте с интернетом и затем закройте все окна PWA.</p>${button("Защитить локальное хранилище от автоочистки", "storage")}</div><a class="button" href="#library">📚 Библиотека</a>${home()}`;
  $("#import").onchange = (e) =>
    run(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5000000) throw Error("Файл слишком большой");
      const imported = E.validateBackup(JSON.parse(await file.text()), lib);
      if (!confirm("Заменить все локальные данные этой резервной копией?"))
        return;
      await save(db, imported);
      s = imported;
      onboarding = s.draft?.type === "onboarding" ? s.draft.answers : null;
      step = s.draft?.step || 0;
      announce("Резервная копия восстановлена");
      go("today");
    });
  if ($("#preferences"))
    $("#preferences").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const f = new FormData(e.target);
        E.today(f.get("zone"));
        const names = E.split(f.get("doctor_foods")),
          resolved = names.map((n) => E.resolve(lib, n));
        if (resolved.some((r) => r.length !== 1 || r[0].ingredients))
          throw Error(
            "Уточните названия продуктов из индивидуального плана врача",
          );
        if (
          !E.validDate(f.get("profile_born")) ||
          f.get("profile_born") > day()
        )
          throw Error("Проверьте дату рождения");
        const p = s.profile;
        Object.assign(p, {
          name: f.get("profile_name").trim(),
          born: f.get("profile_born"),
          risk: f.get("risk"),
          introduced_names: E.split(f.get("introduced_names")),
          food_skill: f.get("food_skill"),
          ready: f.get("ready") === "yes",
          meal_count: f.get("meal_count") ? Number(f.get("meal_count")) : null,
          excluded_names: E.split(f.get("excluded")),
          unavailable_foods: E.split(f.get("unavailable")),
          zone: f.get("zone"),
          notifications_requested: f.get("notifications") === "yes",
          time: f.get("time"),
          early_doctor_confirmed: f.has("early"),
          doctor_consultation_date: f.get("consultation"),
          doctor_plan_note: f.get("doctor_note"),
          doctor_foods: resolved.map((r) => r[0].id),
        });
        E.refreshPeriods(lib, s);
        await persist();
        announce("Настройки сохранены");
        go("today");
      });
    };
}
function renderEditPlan() {
  const d = s.draft;
  if (d?.type !== "replace") {
    go("plan");
    return;
  }
  const p = s.periods.find((p) => p.start === d.start);
  app.innerHTML =
    title("Изменения без спешки", "Замена позиций") +
    `<p>Исходный список целиком:</p>${grouped(p.ids)}<form id="replace">${field("Что заменить (названия через запятую)", "old", d.old || "", "text", 'required maxlength="10000"')}${field("На что заменить (в том же порядке; пусто — подобрать)", "targets", d.targets || "", "text", 'maxlength="10000"')}<button class="primary">Подготовить замены</button></form>${d.proposals ? `<div class="card"><h2>Проверьте изменения</h2>${d.proposals.map(([a, b]) => `<p>${esc(idx.get(a)?.name)} → ${esc(idx.get(b)?.name)}</p>`).join("")}${button("Подтвердить все замены", "confirmreplace", "primary")}</div>` : ""}<a class="button" href="#library">Посмотреть варианты из базы</a>${home()}`;
  $("#replace").oninput = (e) => {
    const f = new FormData(e.currentTarget);
    d.old = f.get("old");
    d.targets = f.get("targets");
    delete d.proposals;
    persist().catch(errorMessage);
  };
  $("#replace").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const old = E.split(d.old).map((n) => E.resolve(lib, n));
      if (old.some((r) => r.length !== 1 || !p.ids.includes(r[0].id)))
        throw Error(
          "Название не найдено в плане или неоднозначно. Уточните его по полному списку.",
        );
      const targets = E.split(d.targets),
        occupied = new Set(p.ids),
        proposals = [];
      if (targets.length && targets.length !== old.length)
        throw Error("Количество замен должно совпадать");
      for (let n = 0; n < old.length; n++) {
        const a = old[n][0];
        let b;
        if (targets.length) {
          const matches = E.resolve(lib, targets[n]);
          if (matches.length !== 1)
            throw Error(
              "Неизвестное или неоднозначное название. Его можно записать в дневник без рекомендаций, но нельзя включить в автоматическое меню.",
            );
          b = matches[0];
        } else
          b = [...idx.values()].find(
            (i) =>
              i.category === a.category &&
              !occupied.has(i.id) &&
              E.eligible(lib, s, i, d.start),
          );
        if (!b || !E.eligible(lib, s, b, d.start))
          throw Error(
            "Безопасная замена не найдена. Выберите доступную позицию из библиотеки.",
          );
        if (proposals.some(([id]) => id === a.id))
          throw Error("Исходная позиция повторяется");
        occupied.add(b.id);
        proposals.push([a.id, b.id]);
      }
      d.proposals = proposals;
      d.revision = p.revision;
      await persist();
      renderEditPlan();
    });
  };
}
function renderShopping() {
  const period =
    s.periods.find((p) => p.start === location.hash.split("/")[1]) ||
    s.periods.at(-1);
  if (!period) {
    go("plan");
    return;
  }
  const totals = new Map();
  for (let n = 0; n < 30; n++) {
    const date = E.addDays(period.start, n);
    if (date < day()) continue;
    for (const meal of E.getMenu(lib, s, date).filter(
      (m) => m.status === "pending",
    )) {
      const item = meal.snapshot;
      for (const ingredient of item.ingredients || [
        { food_id: item.id, amount: null, unit: "" },
      ]) {
        const f = idx.get(ingredient.food_id);
        if (!f) continue;
        const key = f.id + "|" + ingredient.unit;
        const row = totals.get(key) || {
          name: f.name,
          category: f.category,
          amount: 0,
          unknown: false,
          unit: ingredient.unit,
        };
        if (ingredient.amount == null) row.unknown = true;
        else row.amount += ingredient.amount;
        totals.set(key, row);
      }
    }
  }
  app.innerHTML =
    title("Для будущих блюд", "Список покупок") +
    '<p class="notice">Расчётная закладка для приготовления, не норма съедания ребёнка. Новые продукты меняются по фактическому дневнику; список нужно пересчитывать.</p>' +
    [...totals.values()]
      .sort((a, b) => a.category.localeCompare(b.category))
      .map(
        (i) =>
          `<p><strong>${esc(i.name)}</strong> — ${i.unknown ? "количество не задано" : esc(i.amount + " " + i.unit)}<small> · ${esc(i.category)}</small></p>`,
      )
      .join("") +
    home();
  persist().catch(errorMessage);
}
async function run(fn) {
  if (working) return;
  working = true;
  try {
    await fn();
  } catch (e) {
    errorMessage(e);
  } finally {
    working = false;
  }
}
app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  run(async () => {
    const [action, ...parts] = el.dataset.action.split(":"),
      value = parts.join(":");
    if (action === "begin") {
      go("onboarding");
      return;
    }
    if (action === "ack") {
      noticeSeen = true;
      renderQuestion();
      return;
    }
    if (action === "decline") {
      onboarding = null;
      s.draft = null;
      await persist();
      announce("Без согласия анкета не сохраняется. Библиотека доступна.");
      go("library");
      return;
    }
    if (action === "back") {
      step--;
      if (step === 8 && !onboarding.notifications_requested) step--;
      if (step === 6 && onboarding.risk === "no") step--;
      if (step === 4 && !onboarding.started) step--;
      if (onboarding.consent) {
        s.draft = { type: "onboarding", answers: onboarding, step };
        await persist();
      }
      renderQuestion();
      return;
    }
    if (action === "kind") {
      kind = value;
      category = "";
      page = 0;
      renderLibrary();
      return;
    }
    if (action === "page") {
      page += Number(value);
      renderLibrary();
      return;
    }
    if (action === "card") {
      go("card/" + value);
      return;
    }
    if (action === "day") {
      s.ui.lastMeal = null;
      await persist();
      go("today/" + value);
      return;
    }
    if (action === "meal") {
      go("meal/" + encodeURIComponent(value));
      return;
    }
    if (["ate", "other"].includes(action)) {
      if (
        s.draft?.type === "entry" &&
        !confirm("Заменить незавершённую запись новой?")
      )
        return;
      const [d, id] = value.split("|"),
        m = s.menus[d].find((m) => m.id === id);
      s.draft = {
        type: "entry",
        day: d,
        mealID: id,
        planned: action === "ate",
        name: action === "ate" ? m.name : "",
        ids: m.ingredients,
        form: "-",
        quantity: "-",
        reaction: "Нет реакции",
        token: crypto.randomUUID(),
      };
      await persist();
      go("entry");
      return;
    }
    if (action === "skip") {
      const [d, id] = value.split("|");
      E.record(lib, s, { day: d, mealID: id, skip: true });
      await persist();
      announce("Пропуск сохранён. Продукт не считается введённым.");
      go("today/" + d);
      return;
    }
    if (["manual", "add"].includes(action)) {
      if (
        s.draft?.type === "entry" &&
        !confirm("Заменить незавершённую запись новой?")
      )
        return;
      s.draft = {
        type: "entry",
        day: day(),
        name: idx.get(value)?.name || "",
        form: "-",
        quantity: "-",
        reaction: "Нет реакции",
        token: crypto.randomUUID(),
      };
      await persist();
      go("entry");
      return;
    }
    if (action === "known") {
      if (
        !confirm(
          "Отметить как уже знакомый продукт? Дату и количество не добавляем.",
        )
      )
        return;
      const n = idx.get(value).name;
      if (!s.profile.introduced_names.includes(n))
        s.profile.introduced_names.push(n);
      await persist();
      announce("Сохранено в знакомых продуктах");
      renderCard(value);
      return;
    }
    if (action === "editentry") {
      const row = s.diary.find((r) => r.id === value);
      s.draft = {
        type: "entry",
        ...row,
        day: row.day,
        editID: row.id,
        reaction: ["Нет реакции", "Сыпь", "Рвота", "Изменение стула"].includes(
          row.reaction,
        )
          ? row.reaction
          : "Другое",
        symptoms:
          row.reaction === "Нет реакции" ? row.comment || "" : row.reaction,
      };
      await persist();
      go("entry");
      return;
    }
    if (action === "print") {
      window.print();
      return;
    }
    if (["return", "exclude"].includes(action)) {
      if (
        !confirm(
          action === "return"
            ? "После консультации с врачом вернуть этот продукт в будущие меню? История реакции сохранится."
            : "Исключить продукт и блюда с ним?",
        )
      )
        return;
      E.decide(s, [value], action === "return" ? "returned" : "excluded");
      E.refreshPeriods(lib, s);
      await persist();
      renderDiary();
      return;
    }
    if (action === "accept") {
      s.periods.find((p) => p.start === value).accepted = true;
      await persist();
      announce("План принят");
      renderPlan(value);
      return;
    }
    if (action === "nextperiod") {
      go("plan/" + value);
      return;
    }
    if (action === "edit") {
      if (s.draft?.type !== "replace" || s.draft.start !== value)
        s.draft = { type: "replace", start: value };
      await persist();
      go("editplan");
      return;
    }
    if (action === "confirmreplace") {
      const d = s.draft,
        p = s.periods.find((p) => p.start === d.start);
      if (p.revision !== d.revision)
        throw Error("План изменился. Подготовьте замены заново.");
      if (
        d.proposals.some(([, id]) => !E.eligible(lib, s, idx.get(id), d.start))
      )
        throw Error("Ограничения изменились. Проверьте замены.");
      p.ids = [
        ...new Set(
          p.ids.map((id) => d.proposals.find(([a]) => a === id)?.[1] || id),
        ),
      ];
      p.omitted = [
        ...new Set([...(p.omitted || []), ...d.proposals.map(([id]) => id)]),
      ];
      p.revision++;
      s.changes.push({
        at: new Date().toISOString(),
        action: "replace",
        proposals: d.proposals,
      });
      s.draft = null;
      await persist();
      announce("Замены сохранены. Завершённые записи сохранены.");
      go("plan/" + p.start);
      return;
    }
    if (action === "export") {
      const blob = new Blob([JSON.stringify(E.backup(s), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `holy-mommy-backup-${day()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (action === "reset") {
      if (
        !confirm(
          "Полностью удалить анкету, дневник и планы на этом устройстве? Сначала сохраните резервную копию.",
        )
      )
        return;
      await clear(db);
      s = E.emptyState();
      onboarding = null;
      noticeSeen = false;
      step = 0;
      go("today");
      return;
    }
    if (action === "install") {
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
      } else
        announce(
          "В меню браузера выберите «Установить» или «На экран Домой». На iPhone используйте Safari → Поделиться.",
        );
      return;
    }
    if (action === "storage") {
      const granted = await navigator.storage?.persist?.();
      announce(
        granted
          ? "Браузер разрешил постоянное хранение. Резервные копии всё равно нужны."
          : "Браузер не дал гарантию хранения. Регулярно сохраняйте резервную копию.",
      );
      return;
    }
  });
});
// Restore the last meal of today on tab navigation, without modifying the real day.
document
  .querySelector('nav a[href="#today"]')
  .addEventListener("click", (e) => {
    if (s?.ui.lastMeal?.day === day()) {
      e.preventDefault();
      go("meal/" + encodeURIComponent(day() + "|" + s.ui.lastMeal.id));
    }
  });
start();
