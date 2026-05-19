"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppView = "onboarding" | "upload" | "analyzing" | "result" | "recipe" | "settings" | "login";
type AnalyzingPhase = "scanning" | "generating";

type MealComponent = "主菜" | "副菜" | "汁物";

type SubDish = {
  name: string;
  matched_ingredients: string[];
};

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
  fukusai?: SubDish;
  shirumono?: SubDish;
};

type ImageItem = { file: File; dataUrl: string };

type UserSettings = {
  servings: number;
  appliances: string[];
  ng_foods: string;
};

type RecipeIngredient = { name: string; amount: string };
type RecipeData = {
  title: string;
  servings: number;
  ingredients: RecipeIngredient[];
  seasonings: RecipeIngredient[];
  steps: string[];
  hotcook_menu?: string[];
  tips?: string;
};

const MAX_IMAGES = 5;
const GUEST_LIMIT = 5;
const DIFFICULTY_LABEL = { easy: "かんたん", medium: "普通", hard: "本格" } as const;

function getGuestCount(): number {
  return parseInt(localStorage.getItem("snapmeal_guest_count") ?? "0", 10);
}
function incrementGuestCount(): number {
  const next = getGuestCount() + 1;
  localStorage.setItem("snapmeal_guest_count", String(next));
  return next;
}

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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [view, setView] = useState<AppView>("upload");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [tiredMode, setTiredMode] = useState(false);
  const [analyzingPhase, setAnalyzingPhase] = useState<AnalyzingPhase>("scanning");
  const [streamingIngredients, setStreamingIngredients] = useState<string[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [allIngredients, setAllIngredients] = useState<string[]>([]);
  const [activeMealIdx, setActiveMealIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RecipeData | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [selectedAppliance, setSelectedAppliance] = useState<string>("pan");
  const [mealComponents, setMealComponents] = useState<MealComponent[]>(["主菜"]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loginPrompt, setLoginPrompt] = useState<{ show: boolean; reason: "favorite" | "limit" }>({ show: false, reason: "favorite" });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;

  const defaultAppliance = (s: UserSettings) =>
    s.appliances.includes("hotcook") ? "hotcook" : (s.appliances[0] ?? "pan");

  useEffect(() => {
    // ゲストでも使えるようにローカルストレージから設定を読む
    try {
      const stored = localStorage.getItem("snapmeal_settings");
      if (stored) {
        const s: UserSettings = JSON.parse(stored);
        setSettings(s);
        setSelectedAppliance(defaultAppliance(s));
      } else {
        setView("onboarding");
      }
      const savedFavorites = localStorage.getItem("snapmeal_favorites");
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
    } finally {
      setSettingsLoaded(true);
    }

    // ログイン済みの場合はユーザー情報をセット（任意）
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUser(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setUser(session.user);
        // ログイン成功: ゲスト回数リセット・プロンプト閉じる
        localStorage.removeItem("snapmeal_guest_count");
        setLoginPrompt({ show: false, reason: "favorite" });
        setView((v) => v === "login" ? "upload" : v);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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

  // ── Settings ────────────────────────────────────────────────────────────────

  const saveSettings = useCallback((s: UserSettings) => {
    localStorage.setItem("snapmeal_settings", JSON.stringify(s));
    setSettings(s);
    setSelectedAppliance(defaultAppliance(s));
    setView("upload");
  }, []);

  // ── Recipe (Phase C) ────────────────────────────────────────────────────────

  const fetchRecipe = useCallback(async (meal: Meal) => {
    setRecipeLoading(true);
    setRecipe(null);
    setView("recipe");

    // was_selected を記録（ログインユーザーのみ）
    if (sessionId) {
      fetch(`/api/sessions/${sessionId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal_name: meal.name }),
      }).catch(() => { /* サイレント失敗 */ });
    }
    try {
      const res = await fetch("/api/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealName: meal.name,
          matchedIngredients: meal.matched_ingredients,
          genre: meal.genre,
          cookingMethod: meal.cooking_method,
          servings: settings?.servings ?? 2,
          appliances: [selectedAppliance],
          ngFoods: settings?.ng_foods ?? "",
        }),
      });
      const data: RecipeData = await res.json();
      setRecipe(data);
    } catch {
      setView("result");
    } finally {
      setRecipeLoading(false);
    }
  }, [settings, selectedAppliance]);

  // ── Phase B: alternatives (background) ─────────────────────────────────────

  const startAlternatives = useCallback(
    async (ingredients: string[], meal1: Meal, sid: string | null) => {
      try {
        const res = await fetch("/api/alternatives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredients,
            tired_mode: tiredMode,
            meal_1_name: meal1.name,
            meal_1_type: meal1.type,
            session_id: sid,
            meal_components: mealComponents,
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
    [tiredMode, mealComponents]
  );

  // ── Phase A: analyze ────────────────────────────────────────────────────────

  const toggleFavorite = useCallback((meal: Meal) => {
    if (!user) {
      setLoginPrompt({ show: true, reason: "favorite" });
      return;
    }
    setFavorites((prev) => {
      const next = prev.includes(meal.id)
        ? prev.filter((id) => id !== meal.id)
        : [...prev, meal.id];
      localStorage.setItem("snapmeal_favorites", JSON.stringify(next));
      return next;
    });
  }, [user]);

  const startAnalysis = useCallback(async () => {
    if (!images.length) return;

    // ゲストの使用回数チェック
    if (!user) {
      const count = getGuestCount();
      if (count >= GUEST_LIMIT) {
        setLoginPrompt({ show: true, reason: "limit" });
        return;
      }
      incrementGuestCount();
    }

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
          meal_components: mealComponents,
        }),
      });

      let capturedMeal: Meal | null = null;
      let capturedIngredients: string[] = [];
      let capturedSessionId: string | null = null;

      await readSSE(res, (type, data) => {
        if (type === "ingredient") {
          const d = data as { item: string };
          setStreamingIngredients((prev) => [...prev, d.item]);
        } else if (type === "meal") {
          const d = data as { meal: Meal; ingredients: string[] };
          const meal = { ...d.meal, missing_ingredients: [] };
          capturedMeal = meal;
          capturedIngredients = d.ingredients;
          setMeals([meal]);
          setAllIngredients(d.ingredients);
          setActiveMealIdx(0);
          setView("result");
        } else if (type === "session") {
          const d = data as { session_id: string };
          capturedSessionId = d.session_id;
          setSessionId(d.session_id);
          // session_id が揃ったら Phase B 開始
          if (capturedMeal) {
            startAlternatives(capturedIngredients, capturedMeal, capturedSessionId);
          }
        } else if (type === "done") {
          // session イベントが来なかった場合（ゲスト）も Phase B を開始
          if (capturedMeal && !capturedSessionId) {
            startAlternatives(capturedIngredients, capturedMeal, null);
          }
        } else if (type === "error") {
          const d = data as { message: string; code?: string };
          if (d.code === "usage_limit_exceeded") {
            setShowUpgradeModal(true);
            setView("upload");
          } else {
            setError(d.message);
            setView("upload");
          }
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setView("upload");
    }
  }, [images, tiredMode, mealComponents, startAlternatives]);

  // ── Rendering ───────────────────────────────────────────────────────────────

  if (!settingsLoaded) return null;

  if (view === "login") {
    return <LoginView onBack={() => setView("upload")} />;
  }

  if (view === "onboarding") {
    return <OnboardingView onComplete={saveSettings} />;
  }

  if (view === "settings") {
    return (
      <SettingsView
        current={settings ?? { servings: 2, appliances: ["pan"], ng_foods: "" }}
        onSave={(s) => { saveSettings(s); setView("upload"); }}
        onBack={() => setView("upload")}
      />
    );
  }

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
      <>
        <ResultView
          meals={meals}
          activeMealIdx={activeMealIdx}
          onChangeIdx={setActiveMealIdx}
          onBack={() => setView("upload")}
          onSelectMeal={fetchRecipe}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
        {loginPrompt.show && (
          <LoginPromptModal
            reason={loginPrompt.reason}
            onLogin={() => setView("login")}
            onClose={() => setLoginPrompt((p) => ({ ...p, show: false }))}
          />
        )}
      </>
    );
  }

  if (view === "recipe") {
    return (
      <RecipeView
        recipe={recipe}
        loading={recipeLoading}
        onBack={() => setView("result")}
      />
    );
  }

  return (
    <>
      <UploadView
        images={images}
        tiredMode={tiredMode}
        mealComponents={mealComponents}
        ownedAppliances={settings?.appliances ?? []}
        selectedAppliance={selectedAppliance}
        error={error}
        fileInputRef={fileInputRef}
        onAddFiles={addFiles}
        onRemoveImage={removeImage}
        onToggleTired={() => setTiredMode((v) => !v)}
        onToggleMealComponent={(c) =>
          setMealComponents((prev) =>
            prev.includes(c)
              ? prev.length > 1 ? prev.filter((x) => x !== c) : prev
              : [...prev, c]
          )
        }
        onChangeAppliance={setSelectedAppliance}
        onAnalyze={startAnalysis}
        onOpenSettings={() => setView("settings")}
      />
      {loginPrompt.show && (
        <LoginPromptModal
          reason={loginPrompt.reason}
          onLogin={() => setView("login")}
          onClose={() => setLoginPrompt((p) => ({ ...p, show: false }))}
        />
      )}
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}
    </>
  );
}

// ─── Onboarding view ──────────────────────────────────────────────────────────

const APPLIANCE_OPTIONS = [
  { id: "hotcook", label: "ホットクック", icon: "🥘" },
  { id: "pan", label: "フライパン・鍋", icon: "🍳" },
  { id: "microwave", label: "電子レンジ", icon: "📦" },
  { id: "oven", label: "オーブン・グリル", icon: "🔥" },
];

function OnboardingView({ onComplete }: { onComplete: (s: UserSettings) => void }) {
  const [step, setStep] = useState(1);
  const [servings, setServings] = useState(2);
  const [appliances, setAppliances] = useState<string[]>(["pan"]);
  const [ngFoods, setNgFoods] = useState("");

  const toggleAppliance = (id: string) =>
    setAppliances((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Snapmeal へようこそ</h1>
        <p className="text-sm text-gray-500">簡単な設定をしてください（1分で完了）</p>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 justify-center mb-10">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s <= step ? "w-8 bg-primary" : "w-4 bg-gray-200"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="flex-1 flex flex-col">
          <p className="text-lg font-semibold text-gray-800 mb-6">何人分で作りますか？</p>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`py-6 rounded-2xl text-xl font-bold transition ${
                  servings === n
                    ? "bg-primary text-white shadow-lg shadow-orange-200"
                    : "bg-white border-2 border-gray-100 text-gray-700 hover:border-primary"
                }`}
              >
                {n === 4 ? "4人以上" : `${n}人`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full mt-auto pt-8 bg-primary text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-orange-200 hover:opacity-90 transition"
          >
            次へ →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 flex flex-col">
          <p className="text-lg font-semibold text-gray-800 mb-2">お持ちの調理器具は？</p>
          <p className="text-sm text-gray-400 mb-6">複数選択できます</p>
          <div className="space-y-3">
            {APPLIANCE_OPTIONS.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => toggleAppliance(id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition ${
                  appliances.includes(id)
                    ? "border-primary bg-orange-50"
                    : "border-gray-100 bg-white hover:border-gray-200"
                }`}
              >
                <span className="text-2xl">{icon}</span>
                <span className="font-semibold text-gray-800">{label}</span>
                {appliances.includes(id) && (
                  <span className="ml-auto text-primary font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-3 mt-auto pt-8">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-4 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition"
            >
              ← 戻る
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-4 rounded-2xl font-bold text-white bg-primary shadow-lg shadow-orange-200 hover:opacity-90 transition"
            >
              次へ →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex-1 flex flex-col">
          <p className="text-lg font-semibold text-gray-800 mb-1">アレルギーや苦手な食材は？</p>
          <p className="text-sm text-gray-400 mb-6">任意 · スキップしても大丈夫です</p>
          <textarea
            value={ngFoods}
            onChange={(e) => setNgFoods(e.target.value)}
            placeholder="例: 卵、えび、落花生"
            className="w-full border-2 border-gray-100 rounded-2xl p-4 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-white"
            rows={3}
          />
          <div className="flex gap-3 mt-auto pt-8">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-4 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition"
            >
              ← 戻る
            </button>
            <button
              onClick={() => onComplete({ servings, appliances, ng_foods: ngFoods })}
              className="flex-1 py-4 rounded-2xl font-bold text-white bg-primary shadow-lg shadow-orange-200 hover:opacity-90 transition"
            >
              設定完了
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Settings view ────────────────────────────────────────────────────────────

function SettingsView({
  current,
  onSave,
  onBack,
}: {
  current: UserSettings;
  onSave: (s: UserSettings) => void;
  onBack: () => void;
}) {
  const [servings, setServings] = useState(current.servings);
  const [appliances, setAppliances] = useState<string[]>(current.appliances);
  const [ngFoods, setNgFoods] = useState(current.ng_foods);

  const toggleAppliance = (id: string) =>
    setAppliances((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 text-lg p-1">←</button>
        <h2 className="font-bold text-gray-800 text-lg">設定</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
        {/* Servings */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">何人分で作りますか？</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`py-3 rounded-xl font-bold transition text-sm ${
                  servings === n
                    ? "bg-primary text-white shadow-md shadow-orange-200"
                    : "bg-white border-2 border-gray-100 text-gray-700 hover:border-primary"
                }`}
              >
                {n === 4 ? "4人以上" : `${n}人`}
              </button>
            ))}
          </div>
        </div>

        {/* Appliances */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">お持ちの調理器具</p>
          <div className="space-y-2">
            {APPLIANCE_OPTIONS.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => toggleAppliance(id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition ${
                  appliances.includes(id)
                    ? "border-primary bg-orange-50"
                    : "border-gray-100 bg-white hover:border-gray-200"
                }`}
              >
                <span className="text-xl">{icon}</span>
                <span className="font-semibold text-gray-800 text-sm">{label}</span>
                {appliances.includes(id) && (
                  <span className="ml-auto text-primary font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* NG foods */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-1">アレルギー・苦手な食材</p>
          <p className="text-xs text-gray-400 mb-3">任意</p>
          <textarea
            value={ngFoods}
            onChange={(e) => setNgFoods(e.target.value)}
            placeholder="例: 卵、えび、落花生"
            className="w-full border-2 border-gray-100 rounded-2xl p-4 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-white text-sm"
            rows={3}
          />
        </div>
      </div>

      <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100 space-y-3">
        <button
          onClick={() => onSave({ servings, appliances, ng_foods: ngFoods })}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition"
        >
          保存する
        </button>
        <button
          onClick={async () => {
            const supabase = createClient();
            await supabase.auth.signOut();
          }}
          className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
        >
          ログアウト
        </button>
      </div>
    </main>
  );
}

// ─── Upload view ──────────────────────────────────────────────────────────────

const APPLIANCE_LABELS: Record<string, { label: string; icon: string }> = {
  hotcook: { label: "ホットクック", icon: "🥘" },
  pan: { label: "フライパン", icon: "🍳" },
  microwave: { label: "レンジ", icon: "📦" },
  oven: { label: "オーブン", icon: "🔥" },
};

const MEAL_COMPONENT_OPTIONS: { id: MealComponent; icon: string }[] = [
  { id: "主菜", icon: "🍖" },
  { id: "副菜", icon: "🥗" },
  { id: "汁物", icon: "🍵" },
];

function UploadView({
  images,
  tiredMode,
  mealComponents,
  ownedAppliances,
  selectedAppliance,
  error,
  fileInputRef,
  onAddFiles,
  onRemoveImage,
  onToggleTired,
  onToggleMealComponent,
  onChangeAppliance,
  onAnalyze,
  onOpenSettings,
}: {
  images: ImageItem[];
  tiredMode: boolean;
  mealComponents: MealComponent[];
  ownedAppliances: string[];
  selectedAppliance: string;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onToggleTired: () => void;
  onToggleMealComponent: (c: MealComponent) => void;
  onChangeAppliance: (a: string) => void;
  onAnalyze: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Snapmeal</h1>
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition text-gray-500 text-xl"
          aria-label="設定"
        >
          ⚙️
        </button>
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
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
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

      {/* Meal component selector */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">献立の構成は？</p>
        <div className="flex gap-2">
          {MEAL_COMPONENT_OPTIONS.map(({ id, icon }) => (
            <button
              key={id}
              onClick={() => onToggleMealComponent(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                mealComponents.includes(id)
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span>{icon}</span>
              <span>{id}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Appliance selector (only when user owns multiple) */}
      {ownedAppliances.length <= 1 && <div className="mb-2" />}
      {ownedAppliances.length > 1 && (
        <div className="bg-white rounded-2xl p-4 mb-6 border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">今日使う調理器具は？</p>
          <div className="flex gap-2 flex-wrap">
            {ownedAppliances.map((id) => {
              const label = APPLIANCE_LABELS[id] ?? { label: id, icon: "🍴" };
              return (
                <button
                  key={id}
                  onClick={() => onChangeAppliance(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition ${
                    selectedAppliance === id
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <span>{label.icon}</span>
                  <span>{label.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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

// ─── Recipe view ──────────────────────────────────────────────────────────────

function RecipeView({
  recipe,
  loading,
  onBack,
}: {
  recipe: RecipeData | null;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 text-lg p-1">←</button>
        <h2 className="font-bold text-gray-800 text-lg truncate">
          {loading ? "レシピを生成中..." : (recipe?.title ?? "レシピ")}
        </h2>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">レシピを考えています...</p>
        </div>
      ) : recipe ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
            <p className="text-sm text-gray-400">{recipe.servings}人分</p>

            {/* Ingredients */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="font-semibold text-gray-800 mb-3">材料</p>
              <div className="space-y-2">
                {recipe.ingredients.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700">{item.name}</span>
                    <span className="text-gray-400">{item.amount}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Seasonings */}
            {recipe.seasonings?.length > 0 && (
              <div className="bg-white rounded-2xl p-4 border border-gray-100">
                <p className="font-semibold text-gray-800 mb-3">調味料</p>
                <div className="space-y-2">
                  {recipe.seasonings.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700">{item.name}</span>
                      <span className="text-gray-400">{item.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hotcook menu */}
            {recipe.hotcook_menu && recipe.hotcook_menu.length > 0 && (
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                <p className="font-semibold text-orange-700 mb-3">🥘 ホットクック操作</p>
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  {recipe.hotcook_menu.map((step, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span className="bg-white border border-orange-200 text-orange-700 px-2.5 py-1 rounded-lg font-medium whitespace-nowrap">
                        {step}
                      </span>
                      {i < recipe.hotcook_menu!.length - 1 && (
                        <span className="text-orange-300">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Steps */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="font-semibold text-gray-800 mb-4">作り方</p>
              <div className="space-y-4">
                {recipe.steps.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {i + 1}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tips */}
            {recipe.tips && (
              <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                <p className="text-sm text-gray-700">💡 {recipe.tips}</p>
              </div>
            )}

            <p className="text-xs text-gray-400 text-center pb-2">
              ⚠️ 食材の鮮度・賞味期限はご自身でご確認ください
            </p>
          </div>

          <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100">
            <button className="w-full bg-accent text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition">
              👍 作った！
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}

// ─── Result view ──────────────────────────────────────────────────────────────

function ResultView({
  meals,
  activeMealIdx,
  onChangeIdx,
  onBack,
  onSelectMeal,
  favorites,
  onToggleFavorite,
}: {
  meals: Meal[];
  activeMealIdx: number;
  onChangeIdx: (idx: number) => void;
  onBack: () => void;
  onSelectMeal: (meal: Meal) => void;
  favorites: string[];
  onToggleFavorite: (meal: Meal) => void;
}) {
  const meal = meals[activeMealIdx];
  if (!meal) return null;

  const canGoNext = activeMealIdx < meals.length - 1;
  const totalSlots = 3;
  const isFavorite = favorites.includes(meal.id);

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 text-lg p-1">←</button>
        <h2 className="font-bold text-gray-800 text-lg">今夜の献立</h2>
        <button
          onClick={() => onToggleFavorite(meal)}
          className="ml-auto text-2xl transition-transform active:scale-90"
          aria-label={isFavorite ? "お気に入りから削除" : "お気に入りに追加"}
        >
          {isFavorite ? "❤️" : "🤍"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {/* 主菜 */}
        <div>
          <p className="text-xs font-semibold text-primary mb-1">🍖 主菜</p>
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

        {/* 副菜 */}
        {meal.fukusai && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-green-600 mb-1">🥗 副菜</p>
            <p className="font-bold text-gray-900">{meal.fukusai.name}</p>
            {meal.fukusai.matched_ingredients?.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">{meal.fukusai.matched_ingredients.join("・")}</p>
            )}
          </div>
        )}

        {/* 汁物 */}
        {meal.shirumono && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-blue-500 mb-1">🍵 汁物</p>
            <p className="font-bold text-gray-900">{meal.shirumono.name}</p>
            {meal.shirumono.matched_ingredients?.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">{meal.shirumono.matched_ingredients.join("・")}</p>
            )}
          </div>
        )}

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

        <button
          onClick={() => onSelectMeal(meal)}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition"
        >
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

// ─── Login prompt modal ───────────────────────────────────────────────────────

function LoginPromptModal({
  reason,
  onLogin,
  onClose,
}: {
  reason: "favorite" | "limit";
  onLogin: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <p className="text-4xl mb-3">{reason === "favorite" ? "❤️" : "⚡"}</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">
            {reason === "favorite" ? "お気に入りを保存しよう" : "無料利用上限に達しました"}
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            {reason === "favorite"
              ? "ログインするとお気に入りの献立を保存・管理できます。"
              : `ゲストは${GUEST_LIMIT}回まで無料で使えます。ログインすると制限なく使えます。`}
          </p>
        </div>
        <button
          onClick={onLogin}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition mb-3"
        >
          ログインする（無料）
        </button>
        <button
          onClick={onClose}
          className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
        >
          あとで
        </button>
      </div>
    </div>
  );
}

// ─── Login view ───────────────────────────────────────────────────────────────

function LoginView({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <main className="min-h-screen bg-surface flex flex-col items-center justify-center max-w-lg mx-auto px-6">
        <div className="text-center">
          <p className="text-6xl mb-6">📧</p>
          <h2 className="text-xl font-bold text-gray-800 mb-3">メールを送信しました</h2>
          <p className="text-sm text-gray-500 mb-1">
            <span className="font-medium text-gray-700">{email}</span> にログインリンクを送りました。
          </p>
          <p className="text-sm text-gray-400">メール内のリンクをタップしてください。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-6">
      <div className="flex items-center pt-6 pb-2">
        <button onClick={onBack} className="text-gray-500 text-lg p-1">←</button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center">
      <div className="w-full">
        <div className="text-center mb-10">
          <p className="text-6xl mb-4">📸</p>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Snapmeal</h1>
          <p className="text-gray-500 text-sm">冷蔵庫を撮るだけ。30秒で今夜の夕食が決まる。</p>
        </div>

        <form onSubmit={sendMagicLink} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
              className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-orange-100 transition text-base"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 text-center bg-red-50 py-2 px-4 rounded-xl">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "送信中..." : "ログインリンクを送る"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
          パスワード不要。メールのリンクをタップするだけでログインできます。
        </p>
      </div>
      </div>
    </main>
  );
}

// ─── Upgrade modal ────────────────────────────────────────────────────────────

function UpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <p className="text-4xl mb-3">🚀</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">
            今月の利用上限に達しました
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed mb-4">
            Freeプランは月10回まで無料で使えます。<br />
            Proにアップグレードすると月90回まで使えます。
          </p>

          {/* プラン比較 */}
          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-gray-50 rounded-2xl p-4 text-left border-2 border-gray-100">
              <p className="text-xs text-gray-400 font-semibold mb-1">Free</p>
              <p className="text-2xl font-bold text-gray-800 mb-1">¥0</p>
              <p className="text-sm text-gray-500">月10回まで</p>
            </div>
            <div className="flex-1 bg-orange-50 rounded-2xl p-4 text-left border-2 border-primary">
              <p className="text-xs text-primary font-semibold mb-1">Pro ✨</p>
              <p className="text-2xl font-bold text-gray-800 mb-1">¥980<span className="text-sm font-normal text-gray-500">/月</span></p>
              <p className="text-sm text-gray-600">月90回・回数無制限感覚</p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            // Stripe Payment Link（後で設定）
            window.open("https://buy.stripe.com/snapmeal-pro", "_blank");
          }}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-orange-200 hover:opacity-90 transition mb-3"
        >
          Proにアップグレード（¥980/月）
        </button>
        <button
          onClick={onClose}
          className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
        >
          来月まで待つ
        </button>
      </div>
    </div>
  );
}
