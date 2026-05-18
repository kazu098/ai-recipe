"use client";

import { useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppView = "upload" | "analyzing" | "result";
type AnalyzingPhase = "scanning" | "generating";

type Meal = {
  id: string;
  type: string;
  name: string;
  reason: string;
  time_minutes: number;
  difficulty: "easy" | "medium" | "hard";
  matched_ingredients: string[];
  missing_ingredients: string[];
  genre: string;
  main_ingredient: string;
  cooking_method: string;
};

type ImageItem = { file: File; dataUrl: string };

const MAX_IMAGES = 5;
const DIFFICULTY_LABEL = { easy: "かんたん", medium: "普通", hard: "本格" } as const;

// ─── Image helpers ─────────────────────────────────────────────────────────────

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.readAsDataURL(file);
  });
}

async function compressImage(dataUrl: string, maxPx = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// ─── SSE reader ───────────────────────────────────────────────────────────────

async function readSSE(
  response: Response,
  onEvent: (type: string, data: unknown) => void
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const message of messages) {
      let type = "message";
      let data = "";
      for (const line of message.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (data) onEvent(type, JSON.parse(data));
    }
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [view, setView] = useState<AppView>("upload");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [tiredMode, setTiredMode] = useState(false);
  const [analyzingPhase, setAnalyzingPhase] = useState<AnalyzingPhase>("scanning");
  const [streamingIngredients, setStreamingIngredients] = useState<string[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [allIngredients, setAllIngredients] = useState<string[]>([]);
  const [activeMealIdx, setActiveMealIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;

  // ── Image handling ──────────────────────────────────────────────────────────

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, MAX_IMAGES - images.length);

    for (const file of imageFiles) {
      const raw = await readAsDataUrl(file);
      const compressed = await compressImage(raw);
      setImages((prev) =>
        prev.length < MAX_IMAGES ? [...prev, { file, dataUrl: compressed }] : prev
      );
    }
  }, [images.length]);

  const removeImage = (idx: number) =>
    setImages((prev) => prev.filter((_, i) => i !== idx));

  // ── Phase B: alternatives (background) ─────────────────────────────────────

  const startAlternatives = useCallback(
    async (ingredients: string[], meal1: Meal) => {
      try {
        const res = await fetch("/api/alternatives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredients,
            tired_mode: tiredMode,
            meal_1_name: meal1.name,
            meal_1_type: meal1.type,
          }),
        });
        await readSSE(res, (type, data) => {
          if (type === "meal") {
            const d = data as { meal: Meal };
            setMeals((prev) => [...prev, { ...d.meal, missing_ingredients: [] }]);
          }
        });
      } catch {
        // Phase B の失敗はサイレントに無視（1案目は既に表示済み）
      }
    },
    [tiredMode]
  );

  // ── Phase A: analyze ────────────────────────────────────────────────────────

  const startAnalysis = useCallback(async () => {
    if (!images.length) return;
    setView("analyzing");
    setAnalyzingPhase("scanning");
    setStreamingIngredients([]);
    setMeals([]);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrls: images.map((i) => i.dataUrl),
          tired_mode: tiredMode,
          meal_time: "夕食",
        }),
      });

      await readSSE(res, (type, data) => {
        if (type === "ingredient") {
          const d = data as { item: string };
          setStreamingIngredients((prev) => [...prev, d.item]);
        } else if (type === "meal") {
          const d = data as { meal: Meal; ingredients: string[] };
          const meal = { ...d.meal, missing_ingredients: [] };
          setMeals([meal]);
          setAllIngredients(d.ingredients);
          setActiveMealIdx(0);
          setView("result");
          // Phase B をバックグラウンドで開始
          startAlternatives(d.ingredients, meal);
        } else if (type === "status") {
          // フォールバック中などの状態メッセージ（現在は無視）
        } else if (type === "error") {
          const d = data as { message: string };
          setError(d.message);
          setView("upload");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setView("upload");
    }
  }, [images, tiredMode, startAlternatives]);

  // ── Rendering ───────────────────────────────────────────────────────────────

  if (view === "analyzing") {
    return (
      <AnalyzingView
        phase={analyzingPhase}
        ingredients={streamingIngredients}
      />
    );
  }

  if (view === "result") {
    return (
      <ResultView
        meals={meals}
        activeMealIdx={activeMealIdx}
        onChangeIdx={setActiveMealIdx}
        onBack={() => setView("upload")}
      />
    );
  }

  return (
    <UploadView
      images={images}
      tiredMode={tiredMode}
      error={error}
      fileInputRef={fileInputRef}
      onAddFiles={addFiles}
      onRemoveImage={removeImage}
      onToggleTired={() => setTiredMode((v) => !v)}
      onAnalyze={startAnalysis}
    />
  );
}

// ─── Upload view ──────────────────────────────────────────────────────────────

function UploadView({
  images,
  tiredMode,
  error,
  fileInputRef,
  onAddFiles,
  onRemoveImage,
  onToggleTired,
  onAnalyze,
}: {
  images: ImageItem[];
  tiredMode: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onToggleTired: () => void;
  onAnalyze: () => void;
}) {
  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Snapmeal</h1>
      </div>

      {/* Greeting */}
      <div className="mb-6">
        <p className="text-lg font-semibold text-gray-800">今夜の献立、決めましょう</p>
        <p className="text-sm text-gray-500 mt-0.5">冷蔵庫の写真を撮ってください</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-2xl px-4 py-3 border border-red-100">
          {error}
        </div>
      )}

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-gray-200 rounded-3xl p-6 mb-4 bg-white cursor-pointer active:bg-gray-50 transition"
        onDrop={(e) => { e.preventDefault(); onAddFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => images.length < MAX_IMAGES && fileInputRef.current?.click()}
      >
        {images.length === 0 ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="w-20 h-20 rounded-full bg-orange-50 flex items-center justify-center">
              <span className="text-4xl">📷</span>
            </div>
            <p className="font-semibold text-gray-700">冷蔵庫を撮影する</p>
            <p className="text-sm text-gray-400">またはギャラリーから選ぶ</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt="" className="w-20 h-20 object-cover rounded-2xl shadow-sm" />
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  onClick={(e) => { e.stopPropagation(); onRemoveImage(i); }}
                >×</button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-2xl flex items-center justify-center text-gray-400 text-2xl hover:border-primary hover:text-primary transition">
                +
              </div>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && onAddFiles(e.target.files)}
      />

      <p className="text-xs text-gray-400 text-center mb-6">
        {images.length}/{MAX_IMAGES}枚
        {images.length > 0 && ` · 複数の角度から撮ると精度が上がります`}
      </p>

      {/* Tired mode toggle */}
      <div className="bg-white rounded-2xl p-4 mb-6 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">今日の余力は？</p>
        <div className="flex gap-2">
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
              tiredMode
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            onClick={() => !tiredMode && onToggleTired()}
          >
            ⚡ 疲れた
          </button>
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
              !tiredMode
                ? "bg-accent text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            onClick={() => tiredMode && onToggleTired()}
          >
            🍳 余力あり
          </button>
        </div>
      </div>

      {/* Analyze button */}
      <button
        onClick={onAnalyze}
        disabled={images.length === 0}
        className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-orange-200 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        解析する
      </button>
    </main>
  );
}

// ─── Analyzing view ───────────────────────────────────────────────────────────

function AnalyzingView({
  phase,
  ingredients,
}: {
  phase: AnalyzingPhase;
  ingredients: string[];
}) {
  return (
    <main className="min-h-screen bg-surface flex flex-col items-center justify-center max-w-lg mx-auto px-6">
      <div className="w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-lg font-semibold text-gray-800">
            {phase === "scanning" ? "食材をスキャン中..." : "🍳 献立を考えています..."}
          </p>
        </div>

        {ingredients.length > 0 && (
          <div className="space-y-2">
            {ingredients.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-gray-700 animate-[fadeIn_0.3s_ease]"
              >
                <span className="text-accent font-bold">✓</span>
                <span className="text-base">{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Result view ──────────────────────────────────────────────────────────────

function ResultView({
  meals,
  activeMealIdx,
  onChangeIdx,
  onBack,
}: {
  meals: Meal[];
  activeMealIdx: number;
  onChangeIdx: (idx: number) => void;
  onBack: () => void;
}) {
  const meal = meals[activeMealIdx];
  if (!meal) return null;

  const canGoNext = activeMealIdx < meals.length - 1;
  const totalSlots = 3;

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 text-lg p-1">←</button>
        <h2 className="font-bold text-gray-800 text-lg">今夜の献立</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {/* Meal name */}
        <div>
          <p className="text-2xl font-bold text-gray-900">{meal.name}</p>
          <p className="text-gray-500 text-sm mt-1">{meal.reason}</p>
          <div className="flex gap-3 mt-2">
            <span className="text-sm text-gray-500">⏱ {meal.time_minutes}分</span>
            <span className="text-sm text-gray-500">
              ★ {DIFFICULTY_LABEL[meal.difficulty] ?? meal.difficulty}
            </span>
            <span className="text-sm text-gray-500">{meal.genre}</span>
          </div>
        </div>

        {/* Available ingredients */}
        {meal.matched_ingredients?.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-sm font-semibold text-accent mb-2">✅ 今ある食材で作れる</p>
            <p className="text-sm text-gray-600">{meal.matched_ingredients.join("・")}</p>
          </div>
        )}

        {/* Missing ingredients */}
        {meal.missing_ingredients?.length > 0 && (
          <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
            <p className="text-sm font-semibold text-orange-600 mb-2">
              🛒 買い足すもの（{meal.missing_ingredients.length}点）
            </p>
            <p className="text-sm text-orange-700">{meal.missing_ingredients.join("・")}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100 space-y-3">
        {/* Dot indicators */}
        <div className="flex justify-center gap-2 mb-4">
          {Array.from({ length: totalSlots }).map((_, i) => {
            const hasMeal = i < meals.length;
            const isActive = i === activeMealIdx;
            return (
              <button
                key={i}
                onClick={() => hasMeal && onChangeIdx(i)}
                disabled={!hasMeal}
                className={`rounded-full transition-all ${
                  isActive
                    ? "w-6 h-2.5 bg-primary"
                    : hasMeal
                    ? "w-2.5 h-2.5 bg-gray-300 hover:bg-gray-400"
                    : "w-2.5 h-2.5 bg-gray-100 cursor-not-allowed"
                }`}
              />
            );
          })}
        </div>

        <button className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition">
          この献立で作る
        </button>

        <button
          onClick={() => canGoNext ? onChangeIdx(activeMealIdx + 1) : null}
          disabled={!canGoNext}
          className="w-full bg-gray-100 text-gray-700 py-3.5 rounded-2xl font-semibold text-base hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {meals.length < totalSlots && !canGoNext
            ? "別の献立を準備中..."
            : "別の献立を見る"}
        </button>
      </div>
    </main>
  );
}
