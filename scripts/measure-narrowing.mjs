// Прибор 106-4: различимы ли 36 признаков реестра в пространстве эмбеддингов.
//
// Это измерение ПРЕДШЕСТВУЕТ заказанному в ТЗ: живого корпуса не существует
// (сервер рождён 2026-09-03, журнал каналов охватывает один день тестирования),
// а без различимости самих признаков никакой корпус фраз не поможет.
//
// Ключ берётся оттуда же, откуда его берёт слой данных: файл слота.
const fs = require("fs");

const SLOT = "/opt/fractera/app/.env.local";
const KEY = (fs.readFileSync(SLOT, "utf8").match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.log("ОТКАЗ: ключа нет в слоте"); process.exit(1); }

const MODEL = "text-embedding-3-small";
const facts = JSON.parse(fs.readFileSync("/tmp/facts.json", "utf8")).rows;

async function embedMany(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!r.ok) { console.log("ОТКАЗ embeddings:", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
    const d = await r.json();
    for (const e of d.data) out.push(e.embedding);
  }
  return out;
}

const cos = (a, b) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb));
};

// Документ признака — ЧТО он такое. Запрос — КАК его узнать.
// Тексты разные намеренно: одинаковые дали бы самоподтверждение, а не измерение.
const docs = facts.map((f) => `${f.title}. ${f.description}`);
const queries = facts.map((f) => f.howToFind);

// Негативный контроль берётся из НАСТОЯЩЕГО журнала владельца: эти фразы
// не относятся ни к одному признаку, и их верхнее сходство обязано быть ниже.
const controls = ["44:22", "hola", "Ну", "Ок", "hey"];

(async () => {
  const [D, Q, C] = [await embedMany(docs), await embedMany(queries), await embedMany(controls)];

  console.log("===NARROW_RESULT===");
  console.log("признаков:", facts.length, "· модель:", MODEL);

  // 1. Самопоиск: находит ли запрос признака свой собственный документ.
  const ranks = [];
  for (let i = 0; i < facts.length; i++) {
    const scored = D.map((d, j) => ({ j, s: cos(Q[i], d) })).sort((a, b) => b.s - a.s);
    ranks.push(scored.findIndex((x) => x.j === i) + 1);
  }
  const at = (k) => ranks.filter((r) => r > 0 && r <= k).length;
  const pct = (n) => `${n}/${facts.length} = ${Math.round((100 * n) / facts.length)}%`;
  console.log("recall@1 :", pct(at(1)));
  console.log("recall@5 :", pct(at(5)));
  console.log("recall@10:", pct(at(10)));
  console.log("медиана ранга:", ranks.slice().sort((a, b) => a - b)[Math.floor(ranks.length / 2)]);
  console.log("худшие пять (признак → ранг своего документа):");
  facts.map((f, i) => ({ k: f.key, r: ranks[i] })).sort((a, b) => b.r - a.r).slice(0, 5)
    .forEach((x) => console.log(`   ${x.r.toString().padStart(3)}  ${x.k}`));

  // 2. Взаимная похожесть документов: есть ли близнецы, которых не различить.
  const pairs = [];
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) pairs.push({ i, j, s: cos(D[i], D[j]) });
  pairs.sort((a, b) => b.s - a.s);
  const mean = pairs.reduce((a, p) => a + p.s, 0) / pairs.length;
  console.log("средняя взаимная похожесть документов:", mean.toFixed(3));
  console.log("самые неразличимые пары:");
  pairs.slice(0, 5).forEach((p) => console.log(`   ${p.s.toFixed(3)}  ${facts[p.i].key}  ↔  ${facts[p.j].key}`));

  // 3. Негативный контроль: мусорная фраза обязана дать НИЖЕ, чем настоящий запрос.
  const topOf = (v) => Math.max(...D.map((d) => cos(v, d)));
  const realTop = Q.map((q) => topOf(q));
  const realMean = realTop.reduce((a, b) => a + b, 0) / realTop.length;
  console.log("негативный контроль (верхнее сходство):");
  console.log("   настоящие запросы, среднее:", realMean.toFixed(3));
  controls.forEach((t, i) => console.log(`   контроль «${t}»: ${topOf(C[i]).toFixed(3)}`));
  // 4. ГИПОТЕЗА: сужать надо ВНУТРИ уровня, а не по всем 36 сразу.
  // Уровень (initiator/material/intent/entity/destination/field) известен
  // структурно, и модель для его выбора не нужна вовсе.
  console.log("--- сужение ВНУТРИ уровня ---");
  const lv = [...new Set(facts.map((f) => f.level))];
  let t1all = 0, t3all = 0, total = 0;
  for (const L of lv) {
    const idx = facts.map((f, i) => (f.level === L ? i : -1)).filter((i) => i >= 0);
    let t1 = 0, t3 = 0;
    for (const i of idx) {
      const scored = idx.map((j) => ({ j, s: cos(Q[i], D[j]) })).sort((a, b) => b.s - a.s);
      const r = scored.findIndex((x) => x.j === i) + 1;
      if (r === 1) t1++;
      if (r <= 3) t3++;
    }
    t1all += t1; t3all += t3; total += idx.length;
    console.log(`   ${String(L).padEnd(12)} признаков ${String(idx.length).padStart(2)} · свой первый ${t1}/${idx.length} · в тройке ${t3}/${idx.length}`);
  }
  console.log(`   ИТОГО внутри уровня: первый ${t1all}/${total} = ${Math.round((100 * t1all) / total)}% · в тройке ${t3all}/${total} = ${Math.round((100 * t3all) / total)}%`);
  console.log("===NARROW_DONE===");
})();
