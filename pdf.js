import { known, months, today, NOTICE } from "./engine.js";
export async function makePDF(lib, s) {
  const { PDFDocument, rgb } = globalThis.PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(globalThis.fontkit);
  const font = await doc.embedFont(
    await fetch("./DejaVuSans.ttf").then((r) => r.arrayBuffer()),
    { subset: true },
  );
  const charset = new Set(font.getCharacterSet());
  let page, y;
  const clean = (t) =>
    [...String(t ?? "-")]
      .map((c) => (charset.has(c.codePointAt(0)) ? c : "?"))
      .join("");
  function line(text, size = 10) {
    for (const paragraph of clean(text).split("\n")) {
      let current = "";
      for (const word of paragraph.split(" ")) {
        if (
          font.widthOfTextAtSize(current + " " + word, size) > 490 &&
          current
        ) {
          draw(current, size);
          current = "";
        }
        if (font.widthOfTextAtSize(word, size) > 490) {
          for (const c of word) {
            if (font.widthOfTextAtSize(current + c, size) > 490) {
              draw(current, size);
              current = "";
            }
            current += c;
          }
        } else current += (current ? " " : "") + word;
      }
      draw(current, size);
    }
  }
  function draw(t, size) {
    if (!page || y < 50) {
      page = doc.addPage([595, 842]);
      y = 795;
    }
    page.drawText(t, { x: 45, y, size, font, color: rgb(0.2, 0.16, 0.24) });
    y -= size + 6;
  }
  line("Holy Mommy — дневник для педиатра", 16);
  line(
    `${s.profile.name} · возраст ${months(s.profile.born, today(s.profile.zone))} мес.`,
  );
  line(
    "Начало прикорма: " +
      (s.profile.feeding_started_on ||
        s.profile.feeding_start_date ||
        "дата неизвестна"),
  );
  const rows = [...s.diary].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt),
  );
  line("Период: " + (rows[0]?.day || "-") + " — " + (rows.at(-1)?.day || "-"));
  line(NOTICE, 8);
  for (const r of rows) {
    line(
      `${r.day} · ${r.slot} · ${r.status === "eaten" || (r.status === "offered" && !r.consumption_unknown) ? "Поели" : r.status === "offered" ? "Ранее отмечено; факт поедания не уточнён" : r.status === "refused" ? "Отказался" : "Не пробовали"}`,
      11,
    );
    line("Продукт / блюдо: " + r.name);
    line(
      "Форма: " +
        (r.form || "-") +
        " | Фактически съели: " +
        (["eaten", "offered"].includes(r.status) ? r.quantity || "-" : "-"),
    );
    line("Реакция: " + (r.reaction || "-"));
    if (r.comment) line("Комментарий: " + r.comment);
    line("");
  }
  line("Введённые продукты", 12);
  const ids = known(lib, s);
  line(
    lib.foods
      .filter((f) => ids.has(f.id))
      .map((f) => f.name)
      .join(", ") || "-",
  );
  for (const [status, title] of [
    ["pending", "На проверку врачу"],
    ["excluded", "Исключены"],
  ]) {
    line(title, 12);
    line(
      Object.entries(s.decisions)
        .filter(([, v]) => v === status)
        .map(([id]) => lib.foods.find((f) => f.id === id)?.name || id)
        .join(", ") || "-",
    );
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}
export async function showPDF(lib, s, action) {
  const target =
    action === "open" ? window.open("about:blank", "_blank") : null;
  try {
    const blob = await makePDF(lib, s),
      file = new File([blob], `holy-mommy-${today(s.profile.zone)}.pdf`, {
        type: "application/pdf",
      });
    if (action === "share" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Дневник прикорма" });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    if (target) target.location.href = url;
    else {
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    target?.close();
    throw e;
  }
}
export async function localPhoto(file) {
  if (file.size > 12000000 || !/^image\/(jpeg|png|webp)$/.test(file.type))
    throw Error("Выберите фото JPEG, PNG или WebP размером до 12 МБ");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
