import { POLICY } from "./policy.js";
import { showPDF, localPhoto } from "./pdf.js";
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
const home = () => "";
const cap = (v) =>
  esc(String(v || "-").replace(/^./u, (c) => c.toLocaleUpperCase("ru")));
const statusText = (v) =>
  ({
    introduced: "Введён",
    introducing: `Знакомство: день ${v.count} из ${POLICY.introduction.days}`,
    planned: "Запланирован",
    review: "На проверке у врача",
    excluded: "Исключён",
    deferred: "Отложен",
    not_introduced: "Не введён",
  })[v.status] || "Неизвестный продукт";
const note = () => "";
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
let savedSignature="", pendingSaves=0, conflicted=false;
async function persist() {
  if(!pendingSaves&&JSON.stringify(s)===savedSignature)return;
  pendingSaves++;
  try {const written=await save(db,s);savedSignature=JSON.stringify(written);} finally {pendingSaves--;}
}
async function syncOnFocus() {
 if(!db||!s||working||pendingSaves||conflicted)return;
 try {const latest=await load(db);if((latest._revision||0)!==(s._revision||0)){s=latest;savedSignature=JSON.stringify(s);onboarding=s.draft?.type==="onboarding"?s.draft.answers:null;step=s.draft?.step||0;await render();}}catch(error){errorMessage(error)}
}
window.addEventListener("focus",syncOnFocus);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")syncOnFocus()});
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
        `<button class="item" data-action="card:${i.id}"><span>${cap(i.name)}<small>${esc(i.category)} · ${i.ingredients ? "от " + i.min_age + " мес. и условия ингредиентов" : E.stage(i) === 4 ? "базовый продукт; обычно около 6 мес." : "этап от " + E.stage(i) + " мес."}</small></span><span aria-hidden="true">›</span></button>`,
    )
    .join("");
}
function title(kicker, text) {
  return `<p class="eyebrow">${kicker}</p><h1>${text}</h1>`;
}
function errorMessage(error) {
  const messages={AbortError:"Загрузка заняла слишком много времени. Проверьте соединение и попробуйте снова.",InvalidStateError:"Это окно устарело после обновления. Откройте приложение снова — данные сохранены.",QuotaExceededError:"На устройстве не хватает места для сохранения. Сохраните резервную копию и освободите место.",TypeError:"Не получилось выполнить действие. Повторите попытку; сохранённые данные не удалены."};
  announce(messages[error.name]||error.message||"Не получилось выполнить действие. Попробуйте снова.");
  if(error.code === "STATE_CONFLICT") {
    conflicted=true;
    const box=document.createElement("div");box.className="notice";box.innerHTML=`<p>${esc(error.message)}</p>${button("Сохранить копию моего ввода", "export")}${button("Обновить данные", "reloadState")}`;box.id="state-conflict";if(!$("#state-conflict"))app.prepend(box);
  }
  console.error(error);
}
async function loadLibrary() {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try {const response=await fetch("./library.json",{signal:controller.signal});if(!response.ok)throw Error("Не удалось загрузить библиотеку");return await response.json();}finally{clearTimeout(timer)}
}
async function start() {
  try {
    [db, lib] = await Promise.all([
      openStore(),
      loadLibrary(),
    ]);
    s = await load(db);
    savedSignature=JSON.stringify(s);
    E.upgradeNames(lib, s, day());
    E.upgradePlanning(lib, s, day());
    try { await persist(); } catch(error) { if(error.code!=="STATE_CONFLICT") throw error; s=await load(db);savedSignature=JSON.stringify(s); }
    idx = E.libraryIndex(lib);
    onboarding = s.draft?.type === "onboarding" ? s.draft.answers : null;
    step = s.draft?.step || 0;
    await render();
    app.dataset.booting="false";
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
    app.dataset.booting="false";
    app.innerHTML =
      "<h1>Не удалось открыть приложение</h1><p>Для первого запуска нужен интернет. Проверьте соединение и разрешение на локальное хранение. Данные не удалены.</p><button id=retry-start>Попробовать снова</button>";
    $("#retry-start").addEventListener("click",()=>location.reload());
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
const nameFields=new Set(["introduced","introduced_names","excluded","unavailable","reaction_foods","doctor_allergens","old","targets","name"]);
app.addEventListener("input",event=>{
 const el=event.target;if(!lib||!nameFields.has(el.name)||el.type!=="text"||(el.name==="name"&&el.form?.id!=="entry"))return;
 let list=document.querySelector("#food-suggestions");if(!list){list=document.createElement("datalist");list.id="food-suggestions";document.body.append(list)}
 const pieces=String(el.value).split(","),tail=pieces.pop().trim(),prefix=pieces.length?pieces.join(",")+", ":"",r=E.recognizeName(lib,tail);
 list.innerHTML=[...new Map([...r.matches,...r.suggestions].map(i=>[i.id,i])).values()].slice(0,12).map(i=>`<option value="${esc(prefix+i.name)}"></option>`).join("");el.setAttribute("list",list.id);
});
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
  if (route === "swap") renderSwap(arg);
  else if (route === "clarify") renderClarify(arg);
  else if (route === "plan") await renderPlan(arg);
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
    excluded_names: [],
    risk: "unknown",
    zone: "Europe/Moscow",
    food_skill: "puree",
    notifications_requested: false,
  };
  const a = onboarding;
  if (!a.consent) {
    app.innerHTML =
      title("Перед началом", "Согласие на хранение данных") +
      `<p>${E.NOTICE}</p><p>Анкета, дневник, реакции и выбранные фотографии хранятся только на устройстве. Передачи в облако нет. Данные можно удалить в настройках. При очистке браузера они могут потеряться.</p><form id="consent"><label><input type="checkbox" required>Разрешаю локальное хранение данных для плана и дневника</label><button class="primary">Продолжить</button></form>${button("Не согласен(на)", "decline")}<a class="button" href="#library">Библиотека без анкеты</a>`;
    $("#consent").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        Object.assign(a, {
          consent: true,
          consent_version: E.CONSENT_VERSION,
          consent_at: new Date().toISOString(),
        });
        step = 0;
        s.draft = { type: "onboarding", answers: a, step };
        await persist();
        renderQuestion();
      });
    };
    return;
  }
  const qs = [
    [
      "name",
      "Как зовут ребёнка?",
      field(
        "Имя (можно вымышленное)",
        "name",
        a.name,
        "text",
        'required maxlength="100"',
      ),
    ],
    [
      "born",
      "Когда родился ребёнок?",
      field("Дата рождения", "born", a.born, "date", `required max="${day()}"`),
    ],
    [
      "ready",
      "Готовность к прикорму",
      select(
        "Есть ли признаки готовности?",
        "ready",
        [
          ["no", "Пока нет"],
          ["yes", "Да"],
        ],
        a.ready ? "yes" : "no",
      ) +
        "<p>Удержание головы, вертикальное положение с необходимой поддержкой, координация рук, глаз и рта, проглатывание пищи. Самостоятельное сидение не обязательно. Обсудите готовность с педиатром.</p>",
    ],
  ];
  if (E.earlyStartRequired(a, day())) qs.push([
    "early_info", "Раннее начало", `<p class="notice">${esc(POLICY.readiness.early_advice)}</p><p>Ознакомительный приём и индивидуальный темп. Подтверждение консультации не требуется.</p>`
  ]);
  qs.push([
    "started",
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
  ]);
  if (a.started)
    qs.push(
      [
        "feeding_start_date",
        "Когда начали?",
        field(
          "Дата начала, если известна",
          "feeding_start_date",
          a.feeding_start_date || "",
          "date",
          `max="${day()}"`,
        ),
      ],
      [
        "introduced",
        "Какие продукты уже ввели?",
        field(
          "Названия через запятую",
          "introduced",
          a.introduced_names.join(", "),
          "text",
          'maxlength="5000"',
        ),
      ],
    );
  qs.push(
    [
      "reactions",
      "Известные реакции",
      field(
        "На какие продукты были реакции (необязательно)",
        "reaction_foods",
        a.reaction_foods || "",
        "text",
        'maxlength="5000"',
      ),
    ],
    [
      "risk",
      "Медицинские ограничения",
      select(
        "Ограничения или рекомендации врача",
        "risk",
        [
          ["unknown", "Нужно уточнить с педиатром"],
          ["no", "Нет"],
          ["yes", "Да"],
        ],
        a.risk,
      ) +
        `<label><input name="severe_eczema" type="checkbox" ${a.severe_eczema ? "checked" : ""}>Тяжёлая экзема</label><label><input name="known_food_allergy" type="checkbox" ${a.known_food_allergy ? "checked" : ""}>Известная пищевая аллергия</label><p>В этих случаях знакомство с соответствующим новым аллергеном нужно согласовать с врачом.</p>`,
    ],
    [
      "excluded",
      "Что семья не хочет вводить?",
      field(
        "Продукты или группы через запятую",
        "excluded",
        a.excluded_names.join(", "),
        "text",
        'maxlength="5000"',
      ),
    ],
    [
      "skill",
      "Что ребёнок уже умеет?",
      select(
        "Освоенная текстура",
        "food_skill",
        [
          ["puree", "Пюре"],
          ["soft_lumps", "Мягкие комочки"],
          ["soft_pieces", "Мягкие кусочки"],
          ["family", "Адаптированная семейная еда"],
        ],
        a.food_skill,
      ) +
        `<label><input name="skills_confirmed" type="checkbox" ${a.skills_confirmed ? "checked" : ""}>Подтверждаю безопасное вертикальное положение и освоение выбранной текстуры</label>`,
    ],
    [
      "notifications",
      "Напоминания",
      select(
        "Показывать напоминания внутри приложения?",
        "notifications",
        [
          ["no", "Нет"],
          ["yes", "Да"],
        ],
        a.notifications_requested ? "yes" : "no",
      ) +
        "<p>Это сообщения в открытом приложении. Фоновая доставка пока не подключена.</p>",
    ],
  );
  if (a.notifications_requested)
    qs.push([
      "time",
      "Когда напомнить?",
      field("Утром", "time", a.time || "09:00", "time", "required") +
        field(
          "Вечером",
          "evening_time",
          a.evening_time || "19:00",
          "time",
          "required",
        ),
    ]);
  qs.push(["summary", "Всё верно?", summary(a)]);
  step = Math.max(0, Math.min(step, qs.length - 1));
  const [key, head, body] = qs[step];
  app.innerHTML =
    title(`Анкета · ${step + 1} из ${qs.length}`, head) +
    `<form id="question">${body}<div class="actions">${step ? button("← Назад", "back") : ""}<button class="primary">${key === "summary" ? "Всё верно" : "Далее →"}</button></div></form><p class="muted">Сохраняем автоматически. Можно продолжить после закрытия.</p>`;
  function capture() {
    const f = new FormData($("#question"));
    if (key === "name") a.name = String(f.get("name")).trim();
    if (key === "born") a.born = f.get("born");
    if (key === "ready") {
      a.ready = f.get("ready") === "yes";
      a.readiness_answer = a.ready ? "yes" : "no";
    }
    if (key === "started") {
      a.started = f.get("started") === "yes";
      if (!a.started) {
        a.introduced_names = [];
        a.feeding_start_date = null;
      }
    }
    if (key === "feeding_start_date")
      a.feeding_start_date = f.get("feeding_start_date") || null;
    if (key === "introduced") a.introduced_names = E.split(f.get("introduced"));
    if (key === "reactions") a.reaction_foods = f.get("reaction_foods");
    if (key === "risk") {
      a.risk = f.get("risk");
      a.severe_eczema = f.has("severe_eczema");
      a.known_food_allergy = f.has("known_food_allergy");
    }
    if (key === "excluded") a.excluded_names = E.split(f.get("excluded"));
    if (key === "skill") {
      a.food_skill = f.get("food_skill");
      a.skills_confirmed = f.has("skills_confirmed");
    }
    if (key === "notifications")
      a.notifications_requested = f.get("notifications") === "yes";
    if (key === "time") {
      a.time = f.get("time");
      a.evening_time = f.get("evening_time");
    }
    s.draft = { type: "onboarding", answers: a, step };
  }
  $("#question").oninput = () => {
    capture();
    persist().catch(errorMessage);
  };
  $("#question").onchange = $("#question").oninput;
  $("#question").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      capture();
      if (key === "born" && (!E.validDate(a.born) || a.born > day()))
        throw Error("Проверьте дату рождения");
      if (key === "skill" && a.food_skill !== "puree" && !a.skills_confirmed)
        throw Error("Для новой текстуры необходимо подтвердить навыки");
      if (
        key === "feeding_start_date" &&
        a.feeding_start_date &&
        (a.feeding_start_date < a.born || a.feeding_start_date > day())
      )
        throw Error("Проверьте дату начала");
      if (key === "summary") {
        s.profile = {
          ...a,
          active: true,
          app_started_at: day(),
          feeding_started_on: a.feeding_start_date || null,
          start_date_known: Boolean(a.feeding_start_date),
          introduction_mode: POLICY.introduction.default_mode,
        };
        for (const term of E.split(a.reaction_foods)) {
          const matches = E.resolve(lib, term);
          if (matches.length === 1)
            E.ingredients(lib, matches[0].id).forEach(
              (id) => (s.decisions[id] = "pending"),
            );
          else s.profile.excluded_names.push(term);
        }
        s.draft = null;
        onboarding = null;
        E.createPeriod(lib, s);
        await persist();
        go(E.months(s.profile.born, day()) < 4 ? "preparation" : "plan");
        return;
      }
      step++;
      s.draft.step = step;
      await persist();
      renderQuestion();
    });
  };
}

function summary(a) {
  return `<div class="card"><h2>${esc(a.name)}</h2><p>Дата рождения: ${dateText(a.born)}<br>Готовность: ${a.ready ? "Да" : "Нет"}<br>Прикорм начат: ${a.started ? "Да" : "Нет"}<br>Дата начала: ${dateText(a.feeding_started_on || a.feeding_start_date)}<br>Ввели: ${esc(a.introduced_names.join(", ") || "—")}<br>Ограничения: ${a.risk === "yes" ? "Да" : a.risk === "no" ? "Нет" : "Нужно уточнить"}<br>Исключения: ${esc(a.excluded_names.join(", ") || "—")}<br>Напоминания в приложении: ${a.notifications_requested ? esc(a.time) : "Нет"}</p></div>`;
}
function renderLibrary() {
  let list = kind === "food" ? lib.foods : lib.recipes;
  const cats = [...new Set(list.map((i) => i.category))].sort();
  list = list.filter(
    (i) =>
      (!category || category === i.category) &&
      (E.norm(i.name).includes(E.norm(search)) || E.recognizeName(lib,search).matches.some(v=>v.id===i.id)),
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
function specificSafety(item) {
  const foods = item.ingredients
    ? item.ingredients.map((i) => idx.get(i.food_id))
    : [item];
  const notes = new Set();
  for (const f of foods) {
    if (f.category === "Орехи и семена") notes.add(POLICY.safety_text.nuts);
    if (f.category === "Рыба и морепродукты")
      notes.add(POLICY.safety_text.fish);
    if (f.category === "Яйца" || f.category === "Мясо и птица")
      notes.add(POLICY.safety_text.meat_eggs);
    if (f.category === "Молочные") notes.add(POLICY.safety_text.dairy);
  }
  return [...notes]
    .map((t) => `<p class="notice warning">${esc(t)}</p>`)
    .join("");
}
function details(item) {
  if (item.components) return item.components.map(details).join("");
  let displayForm = item.form;
  if (active() && !item.ingredients && s.profile.food_skill === "puree") {
    displayForm = item.form?.includes("пюре")
      ? item.form.split(" или ")[0]
      : "Отдельная инструкция для пюре в источнике не указана; требуется уточнение.";
  }
  const ingredients = item.ingredients
    ?.map(
      (i) =>
        `${idx.get(i.food_id)?.name || i.food_id} — ${i.amount ?? "—"} ${i.unit || ""}`,
    )
    .join("\n");
  const allergies = item.ingredients
    ? item.ingredients.map(
        (i) => E.allergenGroups(idx.get(i.food_id)).join(", ") || "не указана",
      )
    : [E.allergenGroups(item).join(", ") || "не указана"];
  return (
    note() +
    `<div class="card"><p class="eyebrow">${esc(item.category)} · Черновой материал</p><h2>${cap(item.name)}</h2><p>Возрастной ориентир: ${item.min_age ?? "не указан"} мес. Это не обязательная дата введения.</p>${ingredients ? `<h3>Ингредиенты для приготовления</h3><p style="white-space:pre-line">${esc(ingredients)}</p><p class="muted">Закладка для приготовления, не норма съедания.</p>` : ""}<h3>Приготовление и подача</h3><p>${esc(item.how || displayForm || "Не указаны в источнике")}</p>${item.how ? `<p>${esc(item.form)}</p>` : ""}<h3>Условия и безопасность</h3>${specificSafety(item)}<p>${esc((item.condition || "Условия определяются ингредиентами и навыками.").replace("при старте 4–5 мес только по индивидуальному решению врача", "при старте 4–5 мес — при готовности и по решению мамы; рекомендуется обсудить с педиатром"))}</p><p>${esc(item.safety || "См. ограничения ингредиентов. Дополнительные сведения не указаны.")}</p><p>Аллергенность: ${esc([...new Set(allergies)].join(", "))}. Неизвестная маркировка не означает отсутствие аллергена.</p>${item.ingredients ? `<p>Хранение: ${esc(item.storage || "не указано")}. Повторный разогрев: ${esc(item.reheat || "не указано")}.</p>` : ""}<p class="muted">Источники: ${esc(item.sources || "не указаны")}</p>${
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
    title("Карточка", cap(item.name)) +
    details(item) +
    (active()
      ? `<div class="notice ${E.eligible(lib, s, item, day()) ? "" : "warning"}">${E.eligible(lib, s, item, day()) ? "Подходит по текущим техническим ограничениям. Медицинского одобрения нет." : "Не предлагается автоматически с текущим возрастом, навыками или ограничениями."}</div>${button("➕ Добавить в дневник", `add:${id}`, "primary")}${!item.ingredients ? button("✅ Уже пробовали", `known:${id}`) : ""}`
      : "") +
    '<a class="button" href="#library">← Библиотека</a>' +
    home();
}
function clarifyLinks() {
  return E.profileNameIssues(lib,s.profile,s).length ? `<a class="button primary" href="#clarify/${encodeURIComponent(location.hash.slice(1)||"today")}">Уточнить продукт</a>` : '';
}
function nameIssueNotice() {
 const issues=E.profileNameIssues(lib,s.profile,s);
 return issues.length?`<div class="notice"><p>Нужно уточнить: ${issues.map(i=>esc(i.term)).join(", ")}. Неоднозначные названия не подменяются автоматически.</p>${clarifyLinks()}</div>`:"";
}
function renderClarify(arg) {
 if(arg){let route="today";try{route=decodeURIComponent(arg)}catch{};s.ui.clarifyReturn=/^(today|plan|settings|diary)(\/|$)/.test(route)?route:"today";}
 const issues=E.profileNameIssues(lib,s.profile,s),labels={excluded_names:"Исключения",unavailable_foods:"Недоступные продукты",introduced_names:"Уже введены",unknown_reactions:"Реакция — продукт на проверку"};
 const query=s.ui.clarifyQuery||"",found=E.recognizeName(lib,query,{foodsOnly:true}),choices=[...new Map([...found.matches,...found.suggestions].map(f=>[f.id,f])).values()];
 const candidate=s.ui.nameFix,draft=candidate&&["excluded_names","unavailable_foods","introduced_names","unknown_reactions"].includes(candidate.field)&&Number.isInteger(candidate.index)&&candidate.index>=0&&lib.foods.some(f=>f.id===candidate.key)?candidate:null;
 app.innerHTML=title("Профиль", "Уточним названия")+field("Найти продукт в библиотеке", "clarify-query",query,"text")+(draft?`<div class="card"><p>${draft.field==="unknown_reactions" ? `Указать «${cap(idx.get(draft.key)?.name)}» как подозреваемый продукт? История реакции сохранится, продукт будет на проверке педиатра. Это не диагноз.` : `Заменить «${esc(draft.raw)}» на «${cap(idx.get(draft.key)?.name)}» в разделе «${labels[draft.field]}»?`}</p>${button("Подтвердить название","confirmName","primary")}</div>`:"")+issues.map(i=>`<div class="card"><h2>${esc(i.term)}</h2><p>${labels[i.field]}: ${i.status==="ambiguous"?"подходит несколько названий — выберите нужное":"такого названия не удалось найти"}.</p>${(query?choices:i.suggestions).map(f=>button(cap(f.name),`fixName:${i.field}|${i.index}|${f.id}`,"wide")).join("")}<p>Если нужного варианта нет, исправьте название в профиле. Медицинские исключения не будут проигнорированы.</p></div>`).join("")+(issues.length?"":"<p>Названия уточнены. Меню можно открыть.</p>")+`<a class="button" href="#settings">Исправить в профиле</a><a class="button" href="#plan">План на месяц</a><a class="button" href="#${esc(s.ui.clarifyReturn||"today")}">Назад</a>`;
 const input=$("#clarify-query");input.oninput=()=>{const position=input.selectionStart;s.ui.clarifyQuery=input.value;persist().catch(errorMessage);renderClarify();$("#clarify-query").focus();$("#clarify-query").setSelectionRange(position,position);};
}
function renderSwap(arg) {
 const [date,id]=decodeURIComponent(arg||"").split("|"),meal=s.menus[date]?.find(m=>m.id===id);
 if(!meal||meal.status!=="pending"){go("today/"+date);return}
 const allOptions=E.mealChangeOptions(lib,s,date,id),draft=s.ui.swap?.context===arg?s.ui.swap:null;
 const query=draft?.query||"",options=Object.fromEntries(Object.entries(allOptions).map(([mode,items])=>[mode,items.filter(i=>!query||E.norm(i.name).includes(E.norm(query))||E.recognizeName(lib,query).matches.some(f=>f.id===i.id))]));
 const labels={same:"Другое блюдо с тем же новым продуктом",new:"Другой подходящий новый продукт",familiar:"Блюдо из знакомых продуктов"};
 app.innerHTML=title("Меню дня", "Чем заменим блюдо?")+`<p>${cap(meal.name)}</p>`+(!draft?.confirm?field("Поиск вариантов", "swap-search",query,"text"):"")+(draft?.confirm?`<div class="card"><h2>Проверьте замену</h2><p>${cap(meal.name)} → ${cap(idx.get(draft.key)?.name)}</p><p>${draft.mode==="familiar"?"Знакомство с новым продуктом перенесётся. Продукт не будет считаться введённым.":"Изменится предложение в меню, а не фактическая запись дневника."}</p>${button("Подтвердить замену","swapConfirm","primary")}</div>`:"")+Object.entries(labels).map(([mode,label])=>`<div class="card">${button(label,`swapMode:${mode}`,"wide")}${draft?.mode===mode&&!draft.confirm?(options[mode].length?options[mode].map(i=>button(cap(i.name),`swapPick:${date}|${id}|${mode}|${i.id}`,"wide")).join(""):(query&&allOptions[mode].length?'<p>По этому названию ничего не найдено. Очистите поиск или выберите другое действие.</p>'+button('Очистить поиск','swapClear'):'<p>Сейчас подходящих вариантов нет с учётом возраста, навыков, ограничений и сегодняшнего знакомства. Можно выбрать другое действие ниже.</p>')):""}</div>`).join("")+button("Указать, что ребёнок съел",`other:${date}|${id}`,"wide")+button("Пропустить приём прикорма",`skip:${date}|${id}`,"wide")+`<a class="button" href="#meal/${encodeURIComponent(date+"|"+id)}">Назад</a>`;
 const input=$("#swap-search");if(input)input.oninput=()=>{const position=input.selectionStart;s.ui.swap={...(s.ui.swap||{}),context:arg,query:input.value};persist().catch(errorMessage);renderSwap(arg);$("#swap-search").focus();$("#swap-search").setSelectionRange(position,position);};
}
function hasFamiliarMenu(date) {
  const known = E.known(lib, s, date);
  return lib.foods.some((food) => known.has(food.id) && E.foodOK(lib, s, food.id, date));
}
function earlyStartNotice(date) {
  return E.earlyStartRequired(s.profile, date) ? `<p class="notice">${esc(POLICY.readiness.early_advice)}</p>` : "";
}
async function renderToday(selected) {
  const d = E.validDate(selected) ? selected : day(),
    p = E.currentPeriod(lib, s, d),
    menu = E.previewMenu(lib, s, d);
  await persist();
  const suggestion = E.textureSuggestion(s.profile, d);
  const elapsed = E.feedingDays(s, d),
    nearing = p && !p.anchor_pending && E.addDays(p.start, 23) <= d;
  app.innerHTML =
    title(
      `${dateText(d)} · ${elapsed ? (s.profile.start_date_known ? "День прикорма " : "День дневника ") + elapsed : s.profile.started || s.profile.start_date_uncertain_legacy ? "Дата начала неизвестна" : "Первый день ещё не начат"}`,
      "Что сегодня на столе?",
    ) +
    `<p>${esc(s.profile.name)} · ${E.months(s.profile.born, d)} мес.</p>${earlyStartNotice(d)}${nameIssueNotice()}${suggestion ? `<div class="notice"><p>Следующий сценарий по готовности: ${esc(suggestion.text)}. Пюре можно сохранять. Текстура не меняется автоматически.</p><a class="button" href="#settings">Проверить освоенные навыки</a></div>` : ""}${nearing ? `<div class="notice">Пора согласовать следующий месяц. ${button("Посмотреть план", `nextperiod:${E.addDays(p.start, 30)}`)}</div>` : ""}${p?.anchor_pending ? "<p>Первое меню остаётся до фактического кормления. Согласование плана не запускает календарь.</p>" : ""}${p && !p.accepted && (p.ids.length || hasFamiliarMenu(d)) ? '<a class="button primary" href="#plan">Согласовать предварительный план</a>' : ""}${menu.length ? menu.map((m) => `<button class="card item" data-action="meal:${d}|${m.id}"><span><small>${esc(m.slot)} · ${{ done: "Сохранено", skipped: "Не пробовали", refused: "Отказался", pending: "Не отмечено" }[m.status]}</small>${cap(m.name)} ${m.newIDs.length ? "🆕" : ""}<small>${m.newIDs.map((id) => `${cap(idx.get(id).name)}: ${statusText(E.introduction(lib, s, id, d))}`).join(" · ")}${m.ingredients.some((id) => E.allergenGroups(idx.get(id)).length) ? " · ⚠️ Аллерген" : ""}</small></span><span>›</span></button>`).join("") : !p || (!p.ids.length && !hasFamiliarMenu(d)) ? `<div class="card"><h2>План пока не доступен</h2><p>${esc(E.reason(lib, s, d))}</p><a class="button" href="#settings">Проверить профиль</a><a class="button" href="#preparation">Подготовка</a></div>` : p?.accepted ? `<p class="notice">${esc(E.reason(lib, s, d))}</p>` : ""}<p class="muted">${E.months(s.profile.born, d) >= 6 ? POLICY.water.text : "Вопрос воды при раннем старте согласуйте с врачом."} ${esc(POLICY.feeding_reminder)}</p>${E.reminders(
      s,
      menu,
      d,
    )
      .map(
        (r) =>
          `<div class="notice"><small>Напоминание внутри приложения</small><p>${r.text}</p><a class="button" href="#${r.route}">Открыть</a></div>`,
      )
      .join(
        "",
      )}<div class="row">${button("← День раньше", `day:${E.addDays(d, -1)}`)}${button("День вперёд →", `day:${E.addDays(d, 1)}`)}</div>`;
}

function portionBlock(date, meal) {
  const guide = E.portionGuidance(lib, s, date, meal);
  return `<div class="card lavender"><h3>Ориентир всего приёма пищи</h3><p>${esc(guide.meal)}</p>${guide.new_product ? `<p>Первое знакомство: ${esc(guide.new_product)}.</p>` : ""}${guide.allergen ? `<p class="notice warning">${esc(guide.allergen)}</p>` : ""}<p class="muted">${esc(guide.scope)} Закладка рецепта и фактически съеденное количество учитываются отдельно. Ориентиры требуют медицинской проверки.</p></div>`;
}
function renderMeal(arg) {
  const [d, id] = decodeURIComponent(arg || "").split("|"),
    meal = (d > day() ? E.previewMenu(lib, s, d) : s.menus[d] || []).find((m) => m.id === id);
  if (!meal) {
    go("today");
    return;
  }
  s.ui.lastMeal = { day: d, id };
  persist().catch(errorMessage);
  app.innerHTML =
    title(`${dateText(d)} · ${esc(meal.slot)}`, cap(meal.name)) +
    (meal.snapshot.components
      ? meal.snapshot.components.map(details).join("")
      : details(meal.snapshot)) +
    portionBlock(d, meal) +
    (meal.status === "pending" && d <= day()
      ? button("✅ Поели", `ate:${d}|${id}`, "primary") +
        button("⏭ Не пробовали", `skip:${d}|${id}`) +
        button("Отказался", `refuse:${d}|${id}`) +
        button("⚠️ Есть реакция", `reaction:${d}|${id}`) +
        button("Заменить блюдо", `dish:${d}|${id}`) +
        button("Дали другой продукт", `other:${d}|${id}`)
      : `<p>${d > day() ? "Будущий день: только просмотр. Дата и дневник не изменяются." : "Этот приём уже отмечен."}</p>`) +
    `<a class="button" href="#today/${d}">← К меню дня</a>`;
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
        `<details open><summary>${esc(c)} · ${items.length}</summary><ul>${items.map((i) => `<li data-food-id="${esc(i.id)}">${cap(i.name)} ${E.allergenGroups(i).length ? "⚠️ Аллерген" : ""} ${E.known(lib, s).has(i.id) ? "<small>уже введён</small>" : ""}</li>`).join("")}</ul></details>`,
    )
    .join("");
}
async function renderPlan(selected) {
  const date = E.validDate(selected) ? selected : day(),
    p = E.validDate(selected)
      ? E.createPeriod(lib, s, date)
      : E.currentPeriod(lib, s, date);
  await persist();
  const k = E.known(lib, s, date),
    ids = (p?.ids || []).filter((id) => !k.has(id));
  app.innerHTML =
    title("План на 30 дней", "Ваш ближайший месяц") + nameIssueNotice() +
    (p && (ids.length || hasFamiliarMenu(date))
      ? `${earlyStartNotice(date)}<p>${p.anchor_pending ? "Первый месяц: календарь начнётся после первого кормления" : dateText(p.start) + " — " + dateText(E.addDays(p.start, 29))}</p><p>Список рассчитан по прогнозу фактических трёхдневных циклов на 30 дней. Пропуски и реакции изменят прогноз. Согласуйте только новые продукты. Очередь — приоритет, а не обязательное число продуктов в неделю. Блюда подбираются автоматически; незавершённые знакомства переносятся.</p>${!p.accepted && p.legacy_plans?.length ? "<p class=\"notice\">Старый список пересчитан по вместимости календаря. Дневник и завершённые кормления сохранены; согласуйте исправленный план.</p>" : ""}${ids.length ? grouped(ids) : "<p>Новых продуктов нет. Продолжим меню из знакомых продуктов.</p>"}<div class="row">${button(p.accepted ? "✓ План принят" : "Согласовать план", `accept:${p.start}`, "primary")}${button(s.draft?.type === "replace" ? "Продолжить замены" : "Заменить продукты", `edit:${p.start}`)}</div><a class="button" href="#shopping/${p.start}">🛒 Список покупок</a>`
      : `<p>${esc(E.reason(lib, s, date))}</p>${earlyStartNotice(date)}<a class="button" href="#settings">Проверить профиль</a><a class="button" href="#preparation">Подготовка</a>`);
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
    `<div class="emergency" id="urgent" hidden><strong>Немедленно вызовите скорую помощь по местному номеру (в России — 112).</strong><p>Не ждите сохранения записи или ответа приложения. При нарушении дыхания, отёке языка/горла, удушье нужна срочная помощь.</p></div><form id="entry">${d.consumption_unknown ? '<label><input name="confirm_ate" type="checkbox" required>Подтверждаю, что ребёнок действительно съел продукт</label>' : ""}${field("Дата", "date", d.day, "date", `required max="${day()}" ${d.mealID || (d.slot && d.slot !== "-") ? "readonly" : ""}`)}${field("Фактически съели (через запятую)", "name", d.name, "text", `required maxlength="5000" ${d.planned ? "readonly" : ""}`)}${field("Форма подачи (неизвестно — дефис)", "form", d.form || "-", "text", 'maxlength="1000"')}${field("Фактическое количество (неизвестно — дефис)", "quantity", d.quantity || "-", "text", 'maxlength="1000"')}${select(
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
    )}<label for="symptoms">Симптомы или комментарий (сохраним исходный текст)</label><textarea id="symptoms" name="symptoms" maxlength="5000">${esc(d.symptoms || "")}</textarea><label for="extra_comment">Дополнительный комментарий</label><textarea id="extra_comment" name="extra_comment" maxlength="5000">${esc(d.extra_comment || "")}</textarea><p class="muted">Неизвестные названия сохраняются без рекомендаций. При реакции возможные ингредиенты отправляются на проверку педиатру; приложение не определяет причину.</p>${d.planned ? `<fieldset><legend>Какие компоненты ребёнок действительно съел?</legend>${d.ids.map((id) => `<label><input type="checkbox" name="consumed" value="${id}" ${!d.consumed_ids || d.consumed_ids.includes(id) ? "checked" : ""}>${cap(idx.get(id).name)}</label>`).join("")}</fieldset>` : ""}<label for="suspected">При реакции подозреваемый ингредиент</label><select id="suspected" name="suspected"><option value="">Не знаю — учесть все ингредиенты</option>${(d.ids || []).map((id) => `<option value="${id}" ${d.suspected === id ? "selected" : ""}>${cap(idx.get(id).name)}</option>`).join("")}</select><label for="photo">Фото по желанию — только на устройстве</label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp"><label><input type="checkbox" id="photo-consent">Разрешаю сохранить выбранное фото в дневнике</label>${d.photo ? "<p>Фото сохранено в черновике</p>" : ""}<button class="primary" type="submit">Сохранить запись</button><a class="button" href="#reactions">⚠️ Экстренная памятка</a></form>${home()}<a class="button" href="#${esc(d.returnRoute || (d.mealID ? "meal/"+encodeURIComponent(d.day+"|"+d.mealID) : "diary"))}">Назад</a>`;
  const form = $("#entry");
  function syncSuspects() {
    if(!d.planned)d.ids=[...new Set(E.split(d.name).flatMap(name=>{const r=E.recognizeName(lib,name);return r.status==="resolved"?E.ingredients(lib,r.matches[0].id):[]}))];
    const actual=d.planned?(d.consumed_ids||d.ids):d.ids,select=$("#suspected");
    if(d.suspected&&!actual.includes(d.suspected))d.suspected="";
    select.innerHTML='<option value="">Не знаю — учесть все ингредиенты</option>'+actual.map(id=>`<option value="${esc(id)}" ${d.suspected===id?"selected":""}>${cap(idx.get(id)?.name)}</option>`).join("");
  }
  syncSuspects();
  form.oninput = () => {
    const f = new FormData(form);
    Object.assign(d, {
      day: f.get("date"),
      name: f.get("name"),
      form: f.get("form"),
      quantity: f.get("quantity"),
      reaction: f.get("reaction"),
      symptoms: f.get("symptoms"),
      extra_comment: f.get("extra_comment"),
      consumed_ids: f.getAll("consumed"),
      suspected: f.get("suspected"),
    });
    syncSuspects();
    $("#urgent").hidden = !E.emergency(d.symptoms);
    persist().catch(errorMessage);
  };
  form.onchange = form.oninput;
  $("#photo").onchange = (e) =>
    run(async () => {
      if (!$("#photo-consent").checked) {
        e.target.value = "";
        throw Error("Сначала разрешите локальное хранение выбранного фото");
      }
      d.photo = await localPhoto(e.target.files[0]);
      await persist();
      announce("Фото сохранено только на устройстве");
    });
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
      if (d.planned && d.consumed_ids?.length === 0)
        throw Error(
          "Если ребёнок не ел, отметьте «Не пробовали» или «Отказался» в меню дня",
        );
      if(!d.planned&&!E.split(d.name).length)throw Error("Укажите, что ребёнок съел, или отметьте пропуск в меню дня.");
      const names = d.planned ? [d.name] : E.split(d.name),
        matches = names.map((n) => E.resolve(lib, n)),
        ids = [
          ...new Set(
            matches
              .filter((r) => r.length === 1)
              .flatMap((r) => E.ingredients(lib, r[0].id)),
          ),
        ];
      if (
        !d.planned &&
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
      const comment = [d.extra_comment, hasReaction ? "" : d.symptoms]
        .filter(Boolean)
        .join("\n");
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
          status: "eaten",
          consumption_unknown: false,
          comment,
          ingredients: d.planned ? d.consumed_ids || d.ids : ids,
          photo: d.photo || null,
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
          ids: d.planned ? d.consumed_ids || d.ids : ids,
          suspected: d.suspected ? [d.suspected] : undefined,
          photo: d.photo || null,
          unplanned: !d.planned,
          token: d.token,
        });
      if(hasReaction && !d.planned) for(let n=0;n<matches.length;n++) if(matches[n].length!==1&&!E.isEmptyName(names[n])) {
        s.unknown_reactions ||= [];s.unknown_reactions.push({term:names[n],rowID:d.editID||s.diary.at(-1)?.id});
      }
      E.refreshPeriods(lib, s);
      s.draft = null;
      await persist();
      announce("Запись внесена в дневник");
      go("diary");
    });
  };
}
function renderDiary() {
  const k = E.known(lib, s),
    rows = [...s.diary].sort(
      (a, b) =>
        a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt),
    ),
    introducing = lib.foods.filter(
      (f) => E.introduction(lib, s, f.id).status === "introducing",
    ),
    accessible = lib.foods.filter(
      (f) => E.stage(f) <= E.months(s.profile.born, day()),
    );
  app.innerHTML =
    title("Дневник и прогресс", "Маленькие открытия") +
    `<div class="card lavender"><h2>${k.size} из 119 продуктов</h2><progress max="119" value="${k.size}"></progress><p>В знакомстве: ${introducing.length}. Возрастной ассортимент: ${accessible.filter((f) => k.has(f.id)).length} / ${accessible.length}.</p><small>Обзор разнообразия, а не оценка медицинского развития.</small><p>Текущий месячный план: ${(() => {
      const p = E.currentPeriod(lib, s),
        ids = (p?.initial_ids || p?.ids || []).filter(
          (id) => !(p?.omitted || []).includes(id),
        );
      return ids.filter((id) => k.has(id)).length + " / " + ids.length;
    })()} продуктов завершили знакомство.</p></div>${button("➕ Добавить продукты", "manual", "primary")}${s.draft?.type === "entry" ? '<a class="button" href="#entry">Продолжить запись</a>' : ""}<div class="row">${button("📄 Открыть PDF", "pdf:open")}${button("Сохранить PDF", "pdf:save")}${button("Поделиться PDF", "pdf:share")}</div><details><summary>Прогресс по категориям</summary>${[
      ...new Set(lib.foods.map((f) => f.category)),
    ]
      .map((c) => {
        const foods = lib.foods.filter((f) => f.category === c);
        return `<p>${esc(c)}: ${foods.filter((f) => k.has(f.id)).length} / ${foods.length}</p>`;
      })
      .join("")}</details>${[
      "introduced",
      "introducing",
      "not_introduced",
      "review",
      "excluded",
      "deferred",
    ]
      .map((status) => {
        const foods = lib.foods.filter((f) => {
          const v = E.introduction(lib, s, f.id);
          return status === "not_introduced"
            ? ["not_introduced", "planned"].includes(v.status)
            : v.status === status;
        });
        return `<details ${status === "review" ? "open" : ""}><summary>${{ introduced: "✅ Введённые", introducing: "🌱 В процессе знакомства", not_introduced: "🥕 Ещё не введённые", review: "🩺 На проверку врачу", excluded: "Исключённые", deferred: "Отложенные" }[status]} · ${foods.length}</summary>${foods.map((f) => `<p>${cap(f.name)} ${E.allergenGroups(f).length ? "⚠️" : ""} <small>${statusText(E.introduction(lib, s, f.id))}</small>${["review", "excluded"].includes(status) ? button("Вернуть", `return:${f.id}`) + button("Исключить", `exclude:${f.id}`) : ""}</p>`).join("")}</details>`;
      })
      .join(
        "",
      )}<h2>Фактические кормления</h2>${rows.map((r) => `<div class="card"><small>${dateText(r.day)} · ${esc(r.slot)} · ${{ eaten: "Поели", offered: "Ранее отмечено; факт поедания не уточнён", skipped: "Не пробовали", refused: "Отказался" }[r.status]}</small><h3>${cap(r.name)}</h3><p>${esc(r.form)} · ${esc(r.quantity)}</p><p>${esc(r.reaction)} ${esc(r.comment || "")}</p>${r.photo ? `<img class="diary-photo" src="${r.photo}" alt="Фото к записи">` : ""}<small>${r.ingredients.map((id) => `${cap(idx.get(id)?.name)}: ${statusText(E.introduction(lib, s, id, r.day))}`).join(" · ")}</small>${r.status === "eaten" ? button("Изменить", `editentry:${r.id}`) : ""}</div>`).join("") || "<p>Пока нет записей.</p>"}<a class="button" href="#reactions">Памятка по реакциям</a>`;
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
          `<div class="card"><h2>${labels[m.id]}</h2><p>${esc(m.text)}</p></div>`,
      )
      .join("") +
    home();
}
function renderReactions() {
  app.innerHTML =
    title("Рядом, когда тревожно", "Памятка по реакциям") +
    `<div class="emergency"><strong>При нарушении дыхания, отёке языка/горла, потере сознания или удушье — немедленно вызовите скорую помощь по местному номеру (в России — 112).</strong><p>Не ждите заполнения дневника. Приложение не диагностирует и не назначает лечение.</p></div>${note()}${lib.reactions.map((r) => `<details class="card"><summary>${esc(r.symptoms)}</summary><p><strong>${esc(r.urgency)}</strong></p><p>${esc(r.text)}</p></details>`).join("")}${home()}`;
}
function renderSettings() {
  app.innerHTML =
    title("Всё под вашим контролем", "Настройки") +
    `<details><summary>Дополнительные настройки: резервная копия</summary><div class="card"><h2>На вашем телефоне</h2><p>Данные находятся в этом браузере. Аккаунта и синхронизации нет. Сохраните резервную копию перед очисткой браузера или сменой телефона.</p>${button("Экспорт резервной копии", "export", "primary")}<label for="import">Восстановить из файла</label><input id="import" type="file" accept="application/json,.json"><p class="muted">Импорт заменит данные после проверки и подтверждения. Копия содержит личные сведения — не публикуйте её.</p></div></details>` +
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
          "Число приёмов по аппетиту и готовности",
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
          "Напоминания внутри приложения",
          "notifications",
          [
            ["no", "Выключены"],
            ["yes", "Включены"],
          ],
          s.profile.notifications_requested ? "yes" : "no",
        )}${field("Утреннее напоминание внутри приложения", "time", s.profile.time || "09:00", "time")}${field("Вечернее напоминание внутри приложения", "evening_time", s.profile.evening_time || "19:00", "time")}<p class="notice">При закрытом приложении уведомления не отправляются. Здесь нет фоновой рассылки. Вечерняя проверка неотмеченных приёмов видна при открытии «Сегодня».</p><details><summary>Ранний старт: информация</summary><p>${esc(POLICY.readiness.early_advice)}</p><p class="muted">Не стандартная схема. Возрастные условия, готовность, исключения и реакции сохраняются.</p></details><details><summary>Аллергены и согласование врача</summary><label><input name="severe_eczema" type="checkbox" ${s.profile.severe_eczema ? "checked" : ""}>Тяжёлая экзема</label><label><input name="known_food_allergy" type="checkbox" ${s.profile.known_food_allergy ? "checked" : ""}>Известная пищевая аллергия</label><label><input name="allergen_doctor_confirmed" type="checkbox" ${s.profile.allergen_doctor_confirmed ? "checked" : ""}>Введение указанных аллергенов согласовано с врачом</label>${field("Какие продукты с аллергенами согласованы (через запятую)", "doctor_allergens", (s.profile.doctor_allergen_foods || []).map((id) => idx.get(id)?.name).join(", "), "text", 'maxlength="5000"')}<p>Это не отменяет зарегистрированную реакцию или исключение: их возвращение подтверждается в разделе проверки врача.</p></details><label><input name="skills_confirmed" type="checkbox" ${s.profile.skills_confirmed ? "checked" : ""}>Подтверждаю навыки выбранной текстуры</label>${select(
          "Режим знакомства",
          "introduction_mode",
          [
            ["conservative", "Завершать одно знакомство"],
            ["overlap", "Перекрывающиеся циклы: тест, требует проверки врача"],
          ],
          s.profile.introduction_mode || POLICY.introduction.default_mode,
        )}<button type="submit" class="primary">Сохранить настройки</button></form><div class="card"><h2>Управление данными</h2>${button("🔄 Начать заново / удалить данные", "reset", "danger")}<p class="muted">Удаляются анкета, согласие, план, дневник и черновики только в этой PWA. Telegram-база не затрагивается.</p></div>`
      : '<a class="button" href="#today">Начать анкету</a>') +
    `<div class="card"><h2>Установить на телефон</h2>${button("Установить приложение", "install")}<p>Android: меню браузера → «Установить приложение». iPhone: откройте в Safari → «Поделиться» → «На экран Домой».</p><p class="muted">Для первого открытия нужен интернет. После загрузки приложение работает офлайн. Для обновления откройте с интернетом и затем закройте все окна приложения.</p>${button("Защитить локальное хранилище от автоочистки", "storage")}</div><a class="button" href="#library">📚 Библиотека</a>${home()}`;
  $("#import").onchange = (e) =>
    run(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 40000000) throw Error("Файл слишком большой");
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw Error(
          "Не удалось прочитать резервную копию. Проверьте выбранный файл.",
        );
      }
      const imported = E.validateBackup(parsed, lib);
      if (!confirm("Заменить все локальные данные этой резервной копией?"))
        return;
      imported._revision=s._revision||0;
      E.upgradeNames(lib,imported);E.upgradePlanning(lib,imported);
      await save(db, imported);
      savedSignature=JSON.stringify(imported);conflicted=false;
      s = imported;
      onboarding = s.draft?.type === "onboarding" ? s.draft.answers : null;
      step = s.draft?.step || 0;
      announce("Резервная копия восстановлена");
      go("today");
    });
  if ($("#preferences")) {
    const form = $("#preferences"),
      draft = s.ui.settingsDraft;
    if (draft)
      for (const element of form.elements)
        if (element.name && Object.hasOwn(draft, element.name)) {
          if (element.type === "checkbox")
            element.checked = draft[element.name] === "on";
          else element.value = element.name === "early" ? (["on", "yes"].includes(draft.early) ? "yes" : "no") : draft[element.name];
        }
    form.oninput = () => {
      s.ui.settingsDraft = Object.fromEntries(new FormData(form));
      for (const control of form.elements)
        if (control.name && control.type === "checkbox")
          s.ui.settingsDraft[control.name] = control.checked ? "on" : "";
      persist().catch(errorMessage);
    };
    form.onchange = form.oninput;
  }
  if ($("#preferences"))
    $("#preferences").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const f = new FormData(e.target);
        try {
          E.today(f.get("zone"));
        } catch {
          throw Error("Проверьте часовой пояс, например Europe/Moscow");
        }
        const names = E.split(f.get("doctor_allergens")),
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
        if (f.get("food_skill") !== "puree" && !f.has("skills_confirmed"))
          throw Error("Подтвердите навыки выбранной текстуры");
        const p = s.profile;
        Object.assign(p, {
          name: f.get("profile_name").trim(),
          born: f.get("profile_born"),
          risk: f.get("risk"),
          introduced_names: E.split(f.get("introduced_names")),
          food_skill: f.get("food_skill"),
          skills_confirmed: f.has("skills_confirmed"),
          introduction_mode: f.get("introduction_mode") || "conservative",
          ready: f.get("ready") === "yes",
          meal_count: f.get("meal_count") ? Number(f.get("meal_count")) : null,
          excluded_names: E.split(f.get("excluded")),
          unavailable_foods: E.split(f.get("unavailable")),
          zone: f.get("zone"),
          notifications_requested: f.get("notifications") === "yes",
          time: f.get("time"),
          evening_time: f.get("evening_time"),
          early_doctor_confirmed: s.profile.early_doctor_confirmed,
          doctor_consultation_date: s.profile.doctor_consultation_date || null,
          doctor_plan_note: s.profile.doctor_plan_note || null,
          doctor_foods: s.profile.doctor_foods || [],
          severe_eczema: f.has("severe_eczema"),
          known_food_allergy: f.has("known_food_allergy"),
          allergen_doctor_confirmed: f.has("allergen_doctor_confirmed"),
          doctor_allergen_foods: resolved.map((r) => r[0].id),
        });
        E.reconcileProfile(lib, s);
        delete s.ui.settingsDraft;
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
    `<p>Исходный список целиком:</p>${grouped(p.ids)}<form id="replace">${field("Что заменить (названия через запятую)", "old", d.old || "", "text", 'required maxlength="10000"')}${field("На что заменить (в том же порядке; пусто — подобрать)", "targets", d.targets || "", "text", 'maxlength="10000"')}<button class="primary">Подготовить замены</button></form>${d.proposals ? `<div class="card"><h2>Проверьте изменения</h2>${d.proposals.map(([a, b]) => `<p>${esc(idx.get(a)?.name)} → ${esc(idx.get(b)?.name)}</p>`).join("")}${button("Подтвердить все замены", "confirmreplace", "primary")}${button("Другие варианты", "replacementOptions")}</div>` : ""}<a class="button" href="#library">Посмотреть варианты из базы</a><a class="button" href="#plan/${p.start}">Назад</a>${home()}`;
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
          b = E.replacementCandidates(lib, s, a, p.start).find(
            (i) =>
              i.category === a.category &&
              !proposals.some(([, id]) => id === i.id) &&
              E.foodOK(lib, s, i.id, d.start, true, true),
          );
        if (
          !b ||
          b.category !== a.category ||
          !E.foodOK(lib, s, b.id, d.start, true, true)
        )
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
  const from = period.start > day() ? period.start : day();
  const days = Math.max(
    0,
    Math.round(
      (Date.parse(E.addDays(period.start, 30)) - Date.parse(from)) / 86400000,
    ),
  );
  for (const projected of E.forecastMenus(lib, s, from, days)) {
    for (const meal of projected.meals.filter((m) => m.status === "pending")) {
      const item = meal.snapshot;
      const listed=item.ingredients||[],covered=new Set(listed.map(i=>i.food_id));
      for (const ingredient of [...listed,...meal.ingredients.filter(id=>!covered.has(id)).map(id=>({food_id:id,amount:null,unit:""}))]) {
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
    '<p class="notice">Предварительная закладка для приготовления при успешном знакомстве без пропусков и реакций. Это не норма съедания. Прогноз не записывается в дневник; список пересчитывается по фактическим событиям.</p>' +
    [...totals.values()]
      .sort((a, b) => a.category.localeCompare(b.category))
      .map(
        (i) =>
          `<p><strong>${cap(i.name)}</strong> — ${i.unknown ? "количество не задано" : esc(i.amount + " " + i.unit)}<small> · ${esc(i.category)}</small></p>`,
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
      if (false && step === 8 && !onboarding.notifications_requested) step--;
      if (false && step === 6 && onboarding.risk === "no") step--;
      if (false && step === 4 && !onboarding.started) step--;
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
    if (["ate", "other", "reaction"].includes(action)) {
      const [requestedDay,requestedID]=value.split("|");
      if(["ate","other"].includes(action)&&s.draft?.type==="entry"&&s.draft.day===requestedDay&&s.draft.mealID===requestedID&&s.draft.planned===(action!=="other")){go("entry");return;}
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
        planned: action !== "other",
        returnRoute: location.hash.slice(1),
        name: action !== "other" ? m.name : "",
        ids: m.ingredients,
        form: "-",
        quantity: "-",
        reaction: action === "reaction" ? "Другое" : "Нет реакции",
        token: crypto.randomUUID(),
      };
      await persist();
      go("entry");
      return;
    }
    if (action === "dish") { go("swap/"+encodeURIComponent(value)); return; }
    if (action === "swapClear") {if(s.ui.swap)s.ui.swap.query="";await persist();renderSwap(location.hash.split("/")[1]);return;}
    if (action === "swapMode") { s.ui.swap={context:location.hash.split("/")[1],mode:value,query:s.ui.swap?.query||""};await persist();renderSwap(s.ui.swap.context);return; }
    if (action === "swapPick") {
      const [date,id,mode,key]=value.split("|");s.ui.swap={context:encodeURIComponent(date+"|"+id),mode,key,confirm:true};await persist();renderSwap(s.ui.swap.context);return;
    }
    if (action === "swapConfirm") {
      const draft=s.ui.swap;if(!draft?.confirm)throw Error("Выберите замену и подтвердите её.");const [date,id]=decodeURIComponent(draft.context).split("|");E.changeMeal(lib,s,date,id,draft.mode,draft.key);delete s.ui.swap;await persist();announce("Замена сохранена. Дневник не изменён.");go("today/"+date);return;
    }
    if (action === "fixName") {
      const [field,index,key]=value.split("|");s.ui.nameFix={field,index:Number(index),key,raw:field==="unknown_reactions"?s.unknown_reactions[Number(index)].term:s.profile[field][Number(index)]};await persist();renderClarify();return;
    }
    if (action === "confirmName") {
      const d=s.ui.nameFix;
      if(d?.field==="unknown_reactions"){
        const row=s.unknown_reactions?.[d.index];if(!row||row.term!==d.raw||!lib.foods.some(f=>f.id===d.key))throw Error("Выберите продукт ещё раз.");
        row.resolvedID=d.key;s.decisions[d.key]="pending";const entry=s.diary.find(r=>r.id===row.rowID);if(entry)entry.clarified_ingredients=[...(entry.clarified_ingredients||[]),d.key];
        s.changes.push({action:"clarify_reaction",term:d.raw,id:d.key,at:new Date().toISOString()});delete s.ui.nameFix;E.reconcileProfile(lib,s);await persist();go(s.ui.clarifyReturn||"today");return;
      }
      if(!d||!["excluded_names","unavailable_foods","introduced_names"].includes(d.field)||!Number.isInteger(d.index)||d.index<0||!Array.isArray(s.profile[d.field])||!lib.foods.some(f=>f.id===d.key))throw Error("Выберите продукт из библиотеки ещё раз.");if(s.profile[d.field]?.[d.index]!==d.raw)throw Error("Список изменился. Выберите продукт ещё раз.");
      const before=[...s.profile[d.field]];s.profile[d.field][d.index]=idx.get(d.key).name;
      for(const unresolved of s.unknown_reactions||[])if(unresolved.term===d.raw&&!unresolved.resolvedID){
        s.decisions[d.key]="pending";unresolved.resolvedID=d.key;const row=s.diary.find(r=>r.id===unresolved.rowID);if(row)row.clarified_ingredients=[...(row.clarified_ingredients||[]),d.key];
        if(unresolved.auto_exclusion&&d.field==="excluded_names")s.profile[d.field].splice(d.index,1);
      }
      s.changes.push({action:"clarify_name",field:d.field,before,after:[...s.profile[d.field]],at:new Date().toISOString()});delete s.ui.nameFix;E.reconcileProfile(lib,s);await persist();go(s.ui.clarifyReturn||"plan");return;
    }
    if (action === "reloadState") {conflicted=false;s=await load(db);savedSignature=JSON.stringify(s);onboarding=s.draft?.type==="onboarding"?s.draft.answers:null;step=s.draft?.step||0;await render();return;}
    if (action === "skip" || action === "refuse") {
      const [d, id] = value.split("|");
      E.record(lib, s, {
        day: d,
        mealID: id,
        skip: action === "skip",
        refused: action === "refuse",
      });
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
        reaction: action === "reaction" ? "Другое" : "Нет реакции",
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
        extra_comment: row.reaction === "Нет реакции" ? "" : row.comment || "",
        symptoms:
          row.reaction === "Нет реакции" ? row.comment || "" : row.reaction,
      };
      await persist();
      go("entry");
      return;
    }
    if (action === "print" || action === "pdf") {
      await showPDF(lib, s, value || "save");
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
      go("today");
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
    if (action === "replacementOptions") {
      const draft = s.draft;
      app.innerHTML =
        title("Замена продуктов", "Другие безопасные варианты") +
        (draft.proposals || [])
          .map(([old]) => {
            const food = idx.get(old),
              candidates = E.replacementCandidates(lib, s, food, draft.start);
            return `<details open><summary>Вместо ${cap(food.name)}</summary>${candidates.length ? candidates.map((f) => button(cap(f.name), `pickProduct:${old}|${f.id}`)).join("") : "<p>Безопасной замены нет.</p>"}</details>`;
          })
          .join("") +
        `<a class="button" href="#editplan">Вернуться к подтверждению</a>`;
      return;
    }
    if (action === "pickProduct") {
      const [old, target] = value.split("|"),
        draft = s.draft;
      const pairs = draft.proposals.map(([a, b]) => [
        a,
        a === old ? target : b,
      ]);
      draft.targets = pairs.map(([, id]) => idx.get(id).name).join(", ");
      delete draft.proposals;
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
        d.proposals.some(([, id]) => !E.foodOK(lib, s, id, d.start, true, true))
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
      p.replacement_ids = [
        ...new Set([
          ...(p.replacement_ids || []),
          ...d.proposals.map(([, id]) => id),
        ]),
      ];
      p.revision++;
      s.changes.push({
        at: new Date().toISOString(),
        action: "replace",
        proposals: d.proposals,
      });
      E.refreshPeriods(lib, s);
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
      await clear(db,s._revision||0);
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
