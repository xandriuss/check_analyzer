"use client";

import { useState } from "react";

/* =========================
   TYPES
========================= */
type Item = [string, string];

type ApiResponse = {
  total: number;
  junk_total: number;
  items: Item[];
};

/* =========================
   COMPONENT
========================= */
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const upload = async () => {
    if (!file) return;

    setLoading(true);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/upload", {
        method: "POST",
        body: form,
      });

      const data: ApiResponse = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>📄 Receipt Scanner</h1>

      {/* FILE INPUT */}
      <input
        type="file"
        onChange={(e) => {
          if (e.target.files) {
            setFile(e.target.files[0]);
          }
        }}
      />

      <br /><br />

      {/* BUTTON */}
      <button onClick={upload} disabled={loading}>
        {loading ? "Scanning..." : "Upload"}
      </button>

      <br /><br />

      {/* RESULT */}
      {result && (
        <div>
          <h2>💰 Total: {result.total} €</h2>
          <h3>🍟 Junk: {result.junk_total} €</h3>

          <h3>🧾 Items:</h3>
          <ul>
            {result.items.map((item: Item, i: number) => (
              <li key={i}>
                {item[0]} — {item[1]} €
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}