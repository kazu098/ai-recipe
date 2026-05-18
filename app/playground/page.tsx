"use client";

import { useState, useRef } from "react";

type ImageItem = { file: File; dataUrl: string };

type Meal = {
  name: string;
  reason: string;
  time_minutes: number;
  difficulty: string;
  matched_ingredients: string[];
  missing_ingredients: string[];
};

type ModelResult = {
  model: string;
  label: string;
  costPerSession: string;
  status: "idle" | "streaming" | "done" | "error";
  streamingText: string;
  timeToFirstToken?: number;
  totalTime?: number;
  ingredients?: string[];
  meal?: Meal;
  error?: string;
  showRaw: boolean;
};

const MODELS: Pick<ModelResult, "model" | "label" | "costPerSession">[] = [
  { model: "gpt-4o", label: "GPT-4o", costPerSession: "~$0.068" },
  { model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", costPerSession: "~$0.051" },
  { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⭐", costPerSession: "~$0.017" },
];

const MAX_IMAGES = 5;

function makeInitialResults(): ModelResult[] {
  return MODELS.map((m) => ({ ...m, status: "idle", streamingText: "", showRaw: false }));
}

async function runModelStream(
  model: string,
  imageDataUrls: string[],
  onChunk: (text: string, isFirst: boolean) => void,
  onDone: (data: { ingredients: string[]; meal: Meal; rawResponse: string }) => void,
  onError: (message: string) => void
) {
  const res = await fetch("/api/playground", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, imageDataUrls }),
  });

  if (!res.body) { onError("レスポンスボディなし"); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstChunk = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const message of messages) {
      let eventType = "message";
      let eventData = "";

      for (const line of message.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) eventData = line.slice(6);
      }

      if (!eventData) continue;
      const data = JSON.parse(eventData);

      if (eventType === "chunk") {
        onChunk(data.text, firstChunk);
        firstChunk = false;
      } else if (eventType === "done") {
        onDone(data);
      } else if (eventType === "error") {
        onError(data.message);
      }
    }
  }
}

export default function PlaygroundPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [results, setResults] = useState<ModelResult[]>(makeInitialResults());
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const toAdd = imageFiles.slice(0, MAX_IMAGES - images.length);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) =>
        setImages((prev) =>
          prev.length < MAX_IMAGES ? [...prev, { file, dataUrl: e.target?.result as string }] : prev
        );
      reader.readAsDataURL(file);
    });
    setResults(makeInitialResults());
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setResults(makeInitialResults());
  };

  const runAll = async () => {
    if (images.length === 0 || running) return;
    setRunning(true);
    setResults(MODELS.map((m) => ({ ...m, status: "streaming", streamingText: "", showRaw: false })));

    const imageDataUrls = images.map((img) => img.dataUrl);

    await Promise.all(
      MODELS.map(async (m, idx) => {
        const start = Date.now();
        let timeToFirstToken: number | undefined;

        try {
          await runModelStream(
            m.model,
            imageDataUrls,
            (text, isFirst) => {
              if (isFirst) timeToFirstToken = (Date.now() - start) / 1000;
              setResults((prev) => {
                const next = [...prev];
                next[idx] = { ...next[idx], streamingText: next[idx].streamingText + text };
                return next;
              });
            },
            (data) => {
              setResults((prev) => {
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  status: "done",
                  totalTime: (Date.now() - start) / 1000,
                  timeToFirstToken,
                  ingredients: data.ingredients,
                  meal: data.meal,
                };
                return next;
              });
            },
            (message) => {
              setResults((prev) => {
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  status: "error",
                  totalTime: (Date.now() - start) / 1000,
                  error: message,
                };
                return next;
              });
            }
          );
        } catch (err) {
          setResults((prev) => {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              status: "error",
              totalTime: (Date.now() - start) / 1000,
              error: String(err),
            };
            return next;
          });
        }
      })
    );

    setRunning(false);
  };

  const toggleRaw = (idx: number) => {
    setResults((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], showRaw: !next[idx].showRaw };
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">🧪 モデル比較プレイグラウンド</h1>
          <p className="text-gray-500 text-sm mt-1">
            冷蔵庫の写真を最大5枚アップロードして、3モデルの食材認識と献立提案を比較します（SSEストリーミング）
          </p>
        </div>

        {/* Upload area */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-2xl p-6 mb-4 bg-white cursor-pointer hover:border-primary transition"
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => images.length < MAX_IMAGES && fileInputRef.current?.click()}
        >
          {images.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-4xl mb-3">📸</p>
              <p className="text-gray-600 font-medium">冷蔵庫の写真をドラッグ&ドロップ</p>
              <p className="text-gray-400 text-sm mt-1">最大5枚まで / クリックして選択</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 items-center">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt="" className="h-24 w-24 object-cover rounded-xl shadow" />
                  <button
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                  >×</button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <div className="h-24 w-24 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-primary hover:text-primary transition">
                  <span className="text-2xl">+</span>
                  <span className="text-xs mt-1">追加</span>
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        <p className="text-xs text-gray-400 mb-4">
          {images.length}/{MAX_IMAGES}枚
          {images.length > 0 && ` · 合計 ${(images.reduce((s, img) => s + img.file.size, 0) / 1024).toFixed(0)} KB`}
        </p>

        <button
          onClick={runAll}
          disabled={images.length === 0 || running}
          className="w-full bg-primary text-white py-3 rounded-2xl font-semibold text-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed mb-8"
        >
          {running ? "⏳ ストリーミング中..." : `▶ ${images.length}枚の写真を全モデルで解析する`}
        </button>

        {/* Results grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {results.map((r, idx) => (
            <ResultCard key={r.model} result={r} onToggleRaw={() => toggleRaw(idx)} />
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          ⭐ = Primary採用モデル &nbsp;|&nbsp; ⚡ = 初トークン到達時間（ストリーミング体感速度の指標）
        </p>
      </div>
    </div>
  );
}

function ResultCard({ result, onToggleRaw }: { result: ModelResult; onToggleRaw: () => void }) {
  const statusBg = {
    idle: "bg-gray-100 text-gray-500",
    streaming: "bg-yellow-50 text-yellow-700",
    done: "bg-green-50 text-green-700",
    error: "bg-red-50 text-red-600",
  }[result.status];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
      {/* Header */}
      <div className={`px-4 py-3 ${statusBg}`}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-base">{result.label}</span>
          <span className="text-xs font-mono">{result.costPerSession}/回</span>
        </div>
        <div className="flex gap-3 mt-0.5 text-xs opacity-80">
          {result.timeToFirstToken !== undefined && (
            <span>⚡ 初トークン {result.timeToFirstToken.toFixed(1)}s</span>
          )}
          {result.totalTime !== undefined && (
            <span>⏱ 合計 {result.totalTime.toFixed(1)}s</span>
          )}
          {result.status === "streaming" && !result.timeToFirstToken && (
            <span className="animate-pulse">接続中...</span>
          )}
          {result.status === "streaming" && result.timeToFirstToken !== undefined && (
            <span className="animate-pulse">生成中...</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col min-h-[320px]">
        {result.status === "idle" && (
          <p className="text-gray-400 text-sm text-center mt-10">解析待ち</p>
        )}

        {result.status === "streaming" && (
          <div className="flex flex-col gap-2 flex-1">
            <p className="text-xs text-gray-500 font-medium">ストリーミング中:</p>
            <pre className="text-xs bg-gray-50 rounded-xl p-3 font-mono overflow-auto flex-1 max-h-64 whitespace-pre-wrap break-all">
              {result.streamingText || <span className="animate-pulse text-gray-300">▍</span>}
            </pre>
          </div>
        )}

        {result.status === "error" && (
          <div className="mt-4 flex-1">
            <p className="text-red-600 font-medium text-sm mb-2">エラー</p>
            <p className="text-xs text-red-400 bg-red-50 rounded p-2 font-mono break-all">
              {result.error}
            </p>
          </div>
        )}

        {result.status === "done" && (
          <div className="flex-1 flex flex-col">
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

            {/* Meal */}
            {result.meal && (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">献立提案</p>
                <p className="font-bold text-gray-800 text-lg">{result.meal.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{result.meal.reason}</p>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>⏱ {result.meal.time_minutes}分</span>
                  <span>
                    ★ {{ easy: "簡単", medium: "普通", hard: "本格" }[result.meal.difficulty] ?? result.meal.difficulty}
                  </span>
                </div>
                {result.meal.missing_ingredients?.length > 0 && (
                  <p className="text-xs text-orange-600 mt-2">
                    🛒 買い足し: {result.meal.missing_ingredients.join("・")}
                  </p>
                )}
              </div>
            )}

            {/* Raw toggle */}
            <div className="mt-auto pt-3 border-t">
              <button className="text-xs text-gray-400 hover:text-gray-600" onClick={onToggleRaw}>
                {result.showRaw ? "▲ 生レスポンスを隠す" : "▼ 生レスポンスを見る"}
              </button>
              {result.showRaw && (
                <pre className="text-xs mt-2 bg-gray-50 rounded p-2 overflow-auto max-h-40 font-mono whitespace-pre-wrap break-all">
                  {result.streamingText}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
