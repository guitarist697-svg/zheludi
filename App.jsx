import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Tesseract from "tesseract.js";
import "./styles.css";

const currency = "₽";

function money(n) {
  return `${Math.round((Number(n) + Number.EPSILON) * 100) / 100}`.replace(".", ",") + ` ${currency}`;
}

function parseReceiptText(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ");

    // Ищем цену в конце строки: 860.00 / 860,00 / 860
    const match = normalized.match(/(.+?)\s+(\d{2,6})([.,]\d{2})?$/);

    if (!match) continue;

    const name = match[1]
      .replace(/^\d+\s*/, "")
      .replace(/\b\d+[.,]\d{2}\b/g, "")
      .trim();

    const amount = Number(`${match[2]}${match[3] || ""}`.replace(",", "."));

    if (name.length >= 2 && amount > 0) {
      items.push({
        id: crypto.randomUUID(),
        name,
        amount,
        eaters: []
      });
    }
  }

  return items;
}

function calculateDebts(items, payer, people, mode = "direct") {
  const direct = {};
  const balance = {};

  people.forEach((p) => {
    balance[p] = 0;
  });

  for (const item of items) {
    if (!item.eaters.length) continue;

    balance[payer] += item.amount;

    const share = item.amount / item.eaters.length;

    for (const eater of item.eaters) {
      balance[eater] -= share;

      if (eater !== payer) {
        const key = `${eater}|||${payer}`;
        direct[key] = (direct[key] || 0) + share;
      }
    }
  }

  if (mode === "direct") {
    return simplifyDirect(direct);
  }

  return minimizeTransfers(balance);
}

function simplifyDirect(direct) {
  const pairs = {};

  Object.entries(direct).forEach(([key, amount]) => {
    const [from, to] = key.split("|||");
    const sorted = [from, to].sort();
    const pairKey = `${sorted[0]}|||${sorted[1]}`;
    const sign = from === sorted[0] ? 1 : -1;
    pairs[pairKey] = (pairs[pairKey] || 0) + sign * amount;
  });

  return Object.entries(pairs)
    .map(([key, net]) => {
      const [a, b] = key.split("|||");
      const amount = Math.round(Math.abs(net) * 100) / 100;
      if (amount < 0.01) return null;
      return net > 0
        ? { from: a, to: b, amount }
        : { from: b, to: a, amount };
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount);
}

function minimizeTransfers(balance) {
  const debtors = [];
  const creditors = [];

  Object.entries(balance).forEach(([name, value]) => {
    const rounded = Math.round(value * 100) / 100;
    if (rounded < -0.01) debtors.push({ name, amount: -rounded });
    if (rounded > 0.01) creditors.push({ name, amount: rounded });
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.round(Math.min(debtors[i].amount, creditors[j].amount) * 100) / 100;
    transfers.push({ from: debtors[i].name, to: creditors[j].name, amount });

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return transfers;
}

function App() {
  const [people, setPeople] = useState(["Роман", "Михан", "Эндрю"]);
  const [name, setName] = useState("");
  const [payer, setPayer] = useState("Роман");
  const [imageUrl, setImageUrl] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState("");
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("direct");

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [items]
  );

  const transfers = useMemo(
    () => calculateDebts(items, payer, people, mode),
    [items, payer, people, mode]
  );

  function addPerson() {
    const trimmed = name.trim();
    if (!trimmed || people.includes(trimmed)) return;
    setPeople([...people, trimmed]);
    setName("");
  }

  async function recognizeReceipt(file) {
    if (!file) return;

    setImageUrl(URL.createObjectURL(file));
    setOcrProgress("Распознаю чек…");

    const result = await Tesseract.recognize(file, "rus+eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setOcrProgress(`Распознаю: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const text = result.data.text;
    setOcrText(text);
    setItems(parseReceiptText(text).map((item) => ({ ...item, eaters: [...people] })));
    setOcrProgress("Готово");
  }

  function toggleEater(itemId, person) {
    setItems(
      items.map((item) => {
        if (item.id !== itemId) return item;

        const eaters = item.eaters.includes(person)
          ? item.eaters.filter((p) => p !== person)
          : [...item.eaters, person];

        return { ...item, eaters };
      })
    );
  }

  function updateItem(itemId, patch) {
    setItems(items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  function addManualItem() {
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        name: "Новая позиция",
        amount: 0,
        eaters: [...people]
      }
    ]);
  }

  function loadDemoReceipt() {
    setItems([
      ["Рай Ривер Звентаил стаут Pint", 860],
      ["Хобби Вайсбир Pint", 890],
      ["Бургер от Шефа", 1090],
      ["Бургер от Шефа", 1090],
      ["Куриные крылья", 850],
      ["Картофель фри", 490],
      ["Сервис / остальное", 4190]
    ].map(([name, amount]) => ({
      id: crypto.randomUUID(),
      name,
      amount,
      eaters: [...people]
    })));
  }

  return (
    <main className="app">
      <section className="hero">
        <h1>Split Party OCR</h1>
        <p>Загрузи фото чека, приложение распознает позиции, а ты отметишь, кто что ел.</p>
      </section>

      <section className="layout">
        <aside className="card">
          <h2>Участники</h2>

          <div className="inline">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              onKeyDown={(e) => e.key === "Enter" && addPerson()}
            />
            <button onClick={addPerson}>+</button>
          </div>

          <div className="chips">
            {people.map((person) => (
              <span className="chip" key={person}>
                {person}
              </span>
            ))}
          </div>

          <label>Кто оплатил чек</label>
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            {people.map((person) => (
              <option key={person}>{person}</option>
            ))}
          </select>

          <label>Режим расчета</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="direct">Прямые долги</option>
            <option value="minimal">Минимум переводов</option>
          </select>
        </aside>

        <section className="stack">
          <div className="card">
            <h2>1. Фото чека</h2>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => recognizeReceipt(e.target.files?.[0])}
            />

            {imageUrl && <img className="receipt" src={imageUrl} alt="Чек" />}
            {ocrProgress && <p className="status">{ocrProgress}</p>}

            <div className="actions">
              <button onClick={loadDemoReceipt}>Загрузить пример</button>
              <button onClick={addManualItem}>+ Позиция вручную</button>
            </div>
          </div>

          <div className="card">
            <h2>2. Позиции из чека</h2>

            {items.length === 0 && (
              <div className="empty">Пока нет позиций. Загрузи фото чека или нажми “Загрузить пример”.</div>
            )}

            {items.map((item) => (
              <div className="item" key={item.id}>
                <input
                  value={item.name}
                  onChange={(e) => updateItem(item.id, { name: e.target.value })}
                />
                <input
                  type="number"
                  value={item.amount}
                  onChange={(e) => updateItem(item.id, { amount: Number(e.target.value) })}
                />

                <div className="eaters">
                  {people.map((person) => (
                    <label className="eater" key={person}>
                      <input
                        type="checkbox"
                        checked={item.eaters.includes(person)}
                        onChange={() => toggleEater(item.id, person)}
                      />
                      {person}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="total">Итого: {money(total)}</div>
          </div>

          <div className="card">
            <h2>3. Кто кому переводит</h2>

            {transfers.length === 0 ? (
              <div className="empty">Пока переводов нет.</div>
            ) : (
              transfers.map((t, index) => (
                <div className="transfer" key={index}>
                  <span>{t.from} → {t.to}</span>
                  <b>{money(t.amount)}</b>
                </div>
              ))
            )}
          </div>

          {ocrText && (
            <details className="card">
              <summary>Показать сырой OCR-текст</summary>
              <pre>{ocrText}</pre>
            </details>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
