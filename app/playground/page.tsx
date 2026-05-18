"use client";

import { useState, useRef } from "react";

type ModelResult = {
  model: string;
  label: string;
  costPerSession: string;
  status: "idle" | "loading" | "done" | "error";
  elapsed?: number;
  ingredients?: string[];
  meal?: {
    name: string;
    reason: string;
    time_minutes: number;
    difficulty: string;
    matched_ingredients: string[];
    missing_ingredients: string[];
  };
  error?: string;
  rawResponse?: string;
};

const MODELS: Pick<ModelResult, "model" | "label" | "costPerSession">[] = [
  { model: "gpt-4o", label: "GPT-4o", costPerSession: "~$0.068" },
  { model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", costPerSession: "~$0.051" },
  { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", costPerSession: "~$0.017" },
];

export default function PlaygroundPage() {
  const [image, setImage] = useState<{ file: File; dataUrl: string } | null>(null);
  const [results, setResults] = useState<ModelResult[]>(
    MODELS.map((m) => ({ ...m, status: "idle" }))
  );
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage({ file, dataUrl: e.target?.result as string });
      setResults(MODELS.map((m) => ({ ...m, status: "idle" })));
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const runAll = async () => {
    if (!image || running) return;
    setRunning(true);
    setResults(MODELS.map((m) => ({ ...m, status: "loading" })));

    await Promise.all(
      MODELS.map(async (m, idx) => {
        const start = Date.now();
        try {
          const res = await fetch("/api/playground", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: m.model, imageDataUrl: image.dataUrl }),
          });
          const data = await res.json();
          const elapsed = (Date.now() - start) / 1000;

          setResults((prev) => {
            const next = [...prev];
            next[idx] = {
              ...m,
              status: res.ok ? "done" : "error",
              elapsed,
              ingredients: data.ingredients,
              meal: data.meal,
              error: data.error,
              rawResponse: data.rawResponse,
            };
            return next;
          });
        } catch (err) {
          setResults((prev) => {
            const next = [...prev];
            next[idx] = {
              ...m,
              status: "error",
              elapsed: (Date.now() - start) / 1000,
              error: String(err),
            };
            return next;
          });
        }
      })
    );

    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">🧪 モデル比較プレイグラウンド</h1>
          <p className="text-gray-500 text-sm mt-1">
            冷蔵庫の写真をアップロードして、3モデルの食材認識と献立提案を比較します
          </p>
        </div>

        {/* Upload area */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center mb-6 bg-white cursor-pointer hover:border-primary transition"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          {image ? (
            <div className="flex items-center justify-center gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt="uploaded"
                className="h-48 w-auto rounded-xl object-cover shadow"
              />
              <div className="text-left">
                <p className="font-semibold text-gray-700">{image.file.name}</p>
                <p className="text-sm text-gray-400">
                  {(image.file.size / 1024).toFixed(0)} KB
                </p>
                <p className="text-sm text-primary mt-2">クリックして変更</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-4xl mb-3">📸</p>
              <p className="text-gray-600 font-medium">冷蔵庫の写真をドラッグ&ドロップ</p>
              <p className="text-gray-400 text-sm mt-1">またはクリックして選択（JPG / PNG / HEIC）</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {/* Run button */}
        <button
          onClick={runAll}
          disabled={!image || running}
          className="w-full bg-primary text-white py-3 rounded-2xl font-semibold text-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed mb-8"
        >
          {running ? "⏳ 解析中..." : "▶ 全モデルで解析する"}
        </button>

        {/* Results grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {results.map((r) => (
            <ResultCard key={r.model} result={r} />
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          ※ APIキーが未設定のモデルはエラーになります。
          <code className="bg-gray-100 px-1 rounded">.env.local</code> を確認してください。
        </p>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: ModelResult }) {
  const [showRaw, setShowRaw] = useState(false);

  const statusColor = {
    idle: "bg-gray-100 text-gray-500",
    loading: "bg-yellow-50 text-yellow-600",
    done: "bg-green-50 text-green-700",
    error: "bg-red-50 text-red-600",
  }[result.status];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 ${statusColor}`}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-base">{result.label}</span>
          <span className="text-xs font-mono">{result.costPerSession}/回</span>
        </div>
        {result.elapsed && (
          <div className="text-xs mt-0.5 opacity-80">⏱ {result.elapsed.toFixed(1)}秒</div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 min-h-[280px]">
        {result.status === "idle" && (
          <p className="text-gray-400 text-sm text-center mt-8">解析待ち</p>
        )}

        {result.status === "loading" && (
          <div className="flex flex-col items-center justify-center mt-8 gap-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">解析中...</p>
          </div>
        )}

        {result.status === "error" && (
          <div className="mt-4">
            <p className="text-red-600 font-medium text-sm mb-2">エラー</p>
            <p className="text-xs text-red-400 bg-red-50 rounded p-2 font-mono break-all">
              {result.error}
            </p>
          </div>
        )}

        {result.status === "done" && (
          <>
            {/* Ingredients */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                認識した食材（{result.ingredients?.length ?? 0}種）
              </p>
              <div className="flex flex-wrap gap-1">
                {result.ingredients?.map((ing) => (
                  <span key={ing} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                    {ing}
                  </span>
                ))}
              </div>
            </div>

            {/* Meal proposal */}
            {result.meal && (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  献立提案
                </p>
                <p className="font-bold text-gray-800 text-lg">{result.meal.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{result.meal.reason}</p>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>⏱ {result.meal.time_minutes}分</span>
                  <span>
                    ★{" "}
                    {{ easy: "簡単", medium: "普通", hard: "本格" }[result.meal.difficulty] ??
                      result.meal.difficulty}
                  </span>
                </div>
                {result.meal.missing_ingredients?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-orange-600">
                      🛒 買い足し: {result.meal.missing_ingredients.join("・")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Raw toggle */}
            {result.rawResponse && (
              <div className="mt-3 border-t pt-3">
                <button
                  className="text-xs text-gray-400 hover:text-gray-600"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? "▲ 生レスポンスを隠す" : "▼ 生レスポンスを見る"}
                </button>
                {showRaw && (
                  <pre className="text-xs mt-2 bg-gray-50 rounded p-2 overflow-auto max-h-48 font-mono">
                    {result.rawResponse}
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
