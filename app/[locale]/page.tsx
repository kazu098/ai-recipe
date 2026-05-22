"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import {
  MEAL_PATTERNS,
  DEFAULT_PATTERN,
  getActiveComponents,
  getComponentLabel,
  type MealPattern,
  type ComponentRole,
} from "@/lib/meal-patterns";
import { Settings, ArrowLeft, Camera, Heart, Zap, ChefHat, History, ChevronRight } from "lucide-react";
import { trackEvent, EVENTS } from "@/lib/analytics";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppView = "onboarding" | "upload" | "recognizing" | "ingredient-confirm" | "analyzing" | "result" | "recipe" | "settings" | "login" | "history";
type AnalyzingPhase = "scanning" | "generating";

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
  side?: SubDish;
  soup?: SubDish;
};

type ImageItem = { file: File; dataUrl: string };

type UserSettings = {
  servings: number;
  appliances: string[];
  ng_foods: string;
  has_children?: boolean;
  children_age_note?: string;
  taste_preference?: "light" | "normal" | "rich";
  cooking_policy?: string;
};

type RecipeIngredient = { name: string; amount: string };
type SubRecipe = {
  title: string;
  ingredients: RecipeIngredient[];
  seasonings: RecipeIngredient[];
  steps: string[];
};
type HotcookGuide = {
  category: string;
  category_description: string;
  menu_selection: {
    primary_path: string;
    auto_menu_examples: string[];
    manual_fallback: {
      mode: string;
      stir: boolean;
      time_min_min: number;
      time_max_min: number;
      time_condition: string;
    };
  };
  water_note: string;
  stir_note: string;
  time_note: string;
  safety_notes: string[];
  capacity_warning: string;
};
type RecipeData = {
  title: string;
  servings: number;
  ingredients: RecipeIngredient[];
  seasonings: RecipeIngredient[];
  steps: string[];
  substitutions?: string[];
  hotcook?: HotcookGuide;
  tips?: string;
  side_recipe?: SubRecipe;
  soup_recipe?: SubRecipe;
};

const MAX_IMAGES = 5;
const GUEST_LIMIT = 5;

function getGuestCount(): number {
  return parseInt(localStorage.getItem("snapmeal_guest_count") ?? "0", 10);
}
function incrementGuestCount(): number {
  const next = getGuestCount() + 1;
  localStorage.setItem("snapmeal_guest_count", String(next));
  return next;
}

// ─── Image helpers ─────────────────────────────────────────────────────────────

function isHeic(file: File): boolean {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeic(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
  const jpegName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
  return new File([jpegBlob], jpegName, { type: "image/jpeg" });
}

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
  const [selectedPattern, setSelectedPattern] = useState<MealPattern>(DEFAULT_PATTERN);
  const [enabledRoles, setEnabledRoles] = useState<ComponentRole[]>([]);
  const [userRequest, setUserRequest] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loginPrompt, setLoginPrompt] = useState<{ show: boolean; reason: "favorite" | "limit" }>({ show: false, reason: "favorite" });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [confirmedIngredients, setConfirmedIngredients] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;
  const locale = useLocale() as "ja" | "en";
  const tUpload = useTranslations("upload");

  const defaultAppliance = (s: UserSettings) =>
    s.appliances.includes("hotcook") ? "hotcook" : (s.appliances[0] ?? "pan");

  useEffect(() => {
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
      if (savedFavorites) {
        const parsed = JSON.parse(savedFavorites) as string[];
        setFavorites(parsed);
      }
    } finally {
      setSettingsLoaded(true);
    }

    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUser(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setUser(session.user);
        localStorage.removeItem("snapmeal_guest_count");
        setLoginPrompt({ show: false, reason: "favorite" });
        setView((v) => v === "login" ? "upload" : v);
        trackEvent(EVENTS.LOGIN_COMPLETED);
        // profiles 行がなければ自動作成
        supabase.from("profiles").upsert(
          { id: session.user.id, email: session.user.email ?? "" },
          { onConflict: "id", ignoreDuplicates: true }
        );
        // DBからお気に入りを読み込み（localStorage とマージ）
        fetch("/api/favorites")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d.favorites)) {
              setFavorites((prev) => {
                const merged = Array.from(new Set([...prev, ...d.favorites as string[]]));
                localStorage.setItem("snapmeal_favorites", JSON.stringify(merged));
                return merged;
              });
            }
          })
          .catch(() => {});
        // DBから家庭設定を読み込み（DBが優先、なければ localStorage を DB に保存）
        fetch("/api/settings")
          .then((r) => r.json())
          .then((d) => {
            if (d.settings && Object.keys(d.settings).length > 0) {
              const s = d.settings as UserSettings;
              setSettings(s);
              setSelectedAppliance(
                s.appliances?.includes("hotcook") ? "hotcook" : (s.appliances?.[0] ?? "pan")
              );
              localStorage.setItem("snapmeal_settings", JSON.stringify(s));
            } else {
              // DB未登録 → localStorage の設定を DB に保存
              const stored = localStorage.getItem("snapmeal_settings");
              if (stored) {
                fetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ settings: JSON.parse(stored) }),
                }).catch(() => {});
              }
            }
          })
          .catch(() => {});
      } else if (event === "INITIAL_SESSION" && session) {
        // Google OAuth のリダイレクト後はこのイベントが発火する（SIGNED_IN は発火しない）。
        // プロフィール作成・DB同期を行い、ログイン状態を確実に反映させる。
        setUser(session.user);
        setLoginPrompt({ show: false, reason: "favorite" });
        supabase.from("profiles").upsert(
          { id: session.user.id, email: session.user.email ?? "" },
          { onConflict: "id", ignoreDuplicates: true }
        );
        fetch("/api/favorites")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d.favorites)) {
              setFavorites((prev) => {
                const merged = Array.from(new Set([...prev, ...d.favorites as string[]]));
                localStorage.setItem("snapmeal_favorites", JSON.stringify(merged));
                return merged;
              });
            }
          })
          .catch(() => {});
        fetch("/api/settings")
          .then((r) => r.json())
          .then((d) => {
            if (d.settings && Object.keys(d.settings).length > 0) {
              const s = d.settings as UserSettings;
              setSettings(s);
              setSelectedAppliance(
                s.appliances?.includes("hotcook") ? "hotcook" : (s.appliances?.[0] ?? "pan")
              );
              localStorage.setItem("snapmeal_settings", JSON.stringify(s));
            } else {
              const stored = localStorage.getItem("snapmeal_settings");
              if (stored) {
                fetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ settings: JSON.parse(stored) }),
                }).catch(() => {});
              }
            }
          })
          .catch(() => {});
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Analytics side-effects ──────────────────────────────────────────────────
  useEffect(() => {
    if (loginPrompt.show) {
      trackEvent(EVENTS.LOGIN_PROMPTED, { reason: loginPrompt.reason });
    }
  }, [loginPrompt.show]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showUpgradeModal) {
      trackEvent(EVENTS.UPGRADE_MODAL_SHOWN);
    }
  }, [showUpgradeModal]);

  // ── Image handling ──────────────────────────────────────────────────────────

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || isHeic(f))
      .slice(0, MAX_IMAGES - images.length);

    const results = await Promise.all(
      candidates.map(async (file) => {
        const converted = await convertHeicToJpeg(file);
        const raw = await readAsDataUrl(converted);
        const dataUrl = await compressImage(raw);
        return { file: converted, dataUrl };
      })
    );

    setImages((prev) => [...prev, ...results].slice(0, MAX_IMAGES));
    if (results.length > 0) {
      trackEvent(EVENTS.PHOTO_UPLOADED, { count: results.length });
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
    // ログイン済みなら DB にも保存
    if (user) {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: s }),
      }).catch(() => {});
    }
  }, [user]);

  // ── Recipe (Phase C) ────────────────────────────────────────────────────────

  const fetchRecipe = useCallback(async (meal: Meal) => {
    setRecipeLoading(true);
    setRecipe(null);
    setView("recipe");
    trackEvent(EVENTS.MEAL_SELECTED, {
      meal_name: meal.name,
      genre: meal.genre,
      difficulty: meal.difficulty,
      time_minutes: meal.time_minutes,
      cooking_method: meal.cooking_method,
      meal_index: activeMealIdx,
      appliance: selectedAppliance,
      pattern: selectedPattern.id,
    });

    if (sessionId) {
      fetch(`/api/sessions/${sessionId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal_name: meal.name }),
      }).catch(() => { /* silent */ });
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
          side: meal.side
            ? { ...meal.side, label: getComponentLabel(selectedPattern, "side", locale) }
            : null,
          soup: meal.soup
            ? { ...meal.soup, label: getComponentLabel(selectedPattern, "soup", locale) }
            : null,
          locale,
          tiredMode,
        }),
      });
      if (!res.ok) throw new Error("recipe fetch failed");
      const data: RecipeData = await res.json();
      if (!data.ingredients) throw new Error("invalid recipe response");
      setRecipe(data);
    } catch {
      setView("result");
    } finally {
      setRecipeLoading(false);
    }
  }, [settings, selectedAppliance, selectedPattern, locale, sessionId, tiredMode]);

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
            meal_components: getActiveComponents(selectedPattern, enabledRoles, locale),
            locale,
            appliances: settings?.appliances ?? [],
            user_request: userRequest,
          }),
        });
        await readSSE(res, (type, data) => {
          if (type === "meal") {
            const d = data as { meal: Meal };
            setMeals((prev) => [...prev, d.meal]);
          }
        });
      } catch {
        // Phase B failure is silent — first suggestion already shown
      }
    },
    [tiredMode, selectedPattern, enabledRoles, locale, settings, userRequest]
  );

  // ── Phase A: analyze ────────────────────────────────────────────────────────

  const toggleFavorite = useCallback((meal: Meal) => {
    if (!user) {
      setLoginPrompt({ show: true, reason: "favorite" });
      return;
    }
    setFavorites((prev) => {
      const isFav = prev.includes(meal.name);
      const next = isFav ? prev.filter((n) => n !== meal.name) : [...prev, meal.name];
      localStorage.setItem("snapmeal_favorites", JSON.stringify(next));
      if (isFav) {
        fetch("/api/favorites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meal_name: meal.name }) }).catch(() => {});
      } else {
        fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meal_name: meal.name, genre: meal.genre, reason: meal.reason, time_minutes: meal.time_minutes, difficulty: meal.difficulty }) }).catch(() => {});
      }
      return next;
    });
  }, [user]);

  // Phase A-1: 画像認識のみ → 食材確認画面へ
  const startRecognition = useCallback(async () => {
    if (!images.length) return;

    if (!user) {
      const count = getGuestCount();
      if (count >= GUEST_LIMIT) {
        setLoginPrompt({ show: true, reason: "limit" });
        trackEvent(EVENTS.GUEST_LIMIT_HIT);
        return;
      }
    }

    trackEvent(EVENTS.ANALYSIS_STARTED, {
      tired_mode: tiredMode,
      pattern: selectedPattern.id,
      image_count: images.length,
    });
    setView("recognizing");
    setStreamingIngredients([]);
    setMeals([]);
    setError(null);

    try {
      const res = await fetch("/api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrls: images.map((i) => i.dataUrl) }),
      });
      const json = await res.json() as { ingredients?: string[]; error?: string };
      if (!res.ok || !json.ingredients) {
        setError(json.error ?? tUpload("error"));
        setView("upload");
        return;
      }
      setConfirmedIngredients(json.ingredients);
      setView("ingredient-confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : tUpload("error"));
      setView("upload");
    }
  }, [images, user, tUpload]);

  // Phase A-2: 確定した食材リストで献立生成
  const startAnalysis = useCallback(async (ingredientsToUse?: string[]) => {
    const useOverride = ingredientsToUse && ingredientsToUse.length > 0;
    if (!useOverride && !images.length) return;

    if (!user) {
      const count = getGuestCount();
      if (count >= GUEST_LIMIT) {
        setLoginPrompt({ show: true, reason: "limit" });
        return;
      }
      incrementGuestCount();
    }

    setView("analyzing");
    setAnalyzingPhase(useOverride ? "generating" : "scanning");
    setStreamingIngredients(useOverride ? ingredientsToUse! : []);
    setMeals([]);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        tired_mode: tiredMode,
        meal_time: locale === "ja" ? "夕食" : "dinner",
        meal_components: getActiveComponents(selectedPattern, enabledRoles, locale),
        locale,
        appliances: settings?.appliances ?? [],
        user_request: userRequest,
        household_profile: {
          has_children: settings?.has_children,
          children_age_note: settings?.children_age_note,
          taste_preference: settings?.taste_preference,
          cooking_policy: settings?.cooking_policy,
          ng_foods: settings?.ng_foods,
        },
      };
      if (useOverride) {
        body.ingredients_override = ingredientsToUse;
      } else {
        body.imageDataUrls = images.map((i) => i.dataUrl);
      }
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let capturedMeal: Meal | null = null;
      let capturedIngredients: string[] = [];
      let capturedSessionId: string | null = null;

      await readSSE(res, (type, data) => {
        if (type === "ingredient") {
          if (useOverride) return; // 確認済み食材は再スキャン不要
          const d = data as { item: string };
          setStreamingIngredients((prev) => [...prev, d.item]);
        } else if (type === "meal") {
          const d = data as { meal: Meal; ingredients: string[] };
          const meal = d.meal;
          capturedMeal = meal;
          capturedIngredients = d.ingredients;
          setMeals([meal]);
          setAllIngredients(d.ingredients);
          setActiveMealIdx(0);
          setView("result");
          trackEvent(EVENTS.MEAL_SUGGESTED, {
            meal_name: meal.name,
            genre: meal.genre,
            difficulty: meal.difficulty,
            tired_mode: tiredMode,
            pattern: selectedPattern.id,
          });
        } else if (type === "session") {
          const d = data as { session_id: string };
          capturedSessionId = d.session_id;
          setSessionId(d.session_id);
          if (capturedMeal) {
            startAlternatives(capturedIngredients, capturedMeal, capturedSessionId);
          }
        } else if (type === "done") {
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
      setError(err instanceof Error ? err.message : tUpload("error"));
      setView("upload");
    }
  }, [images, tiredMode, selectedPattern, enabledRoles, locale, settings, userRequest, user, startAlternatives, tUpload]);

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
        onLogin={() => setView("login")}
        user={user}
        locale={locale}
      />
    );
  }

  if (view === "recognizing") {
    return <RecognizingView />;
  }

  if (view === "ingredient-confirm") {
    return (
      <IngredientConfirmView
        ingredients={confirmedIngredients}
        images={images}
        onConfirm={(edited) => {
          setConfirmedIngredients(edited);
          startAnalysis(edited);
        }}
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
          onChangeIdx={(idx) => {
            if (idx > activeMealIdx) {
              trackEvent(EVENTS.ALTERNATIVE_VIEWED, { meal_index: idx, pattern: selectedPattern.id });
            }
            setActiveMealIdx(idx);
          }}
          onBack={() => setView("upload")}
          onSelectMeal={fetchRecipe}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          selectedPattern={selectedPattern}
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
        onHome={() => setView("upload")}
        selectedPattern={selectedPattern}
        sessionId={sessionId}
        user={user}
      />
    );
  }

  if (view === "history") {
    return (
      <HistoryView
        onBack={() => setView("upload")}
        onLogin={() => setView("login")}
        user={user}
      />
    );
  }

  return (
    <>
      <UploadView
        images={images}
        tiredMode={tiredMode}
        selectedPattern={selectedPattern}
        enabledRoles={enabledRoles}
        ownedAppliances={settings?.appliances ?? []}
        selectedAppliance={selectedAppliance}
        error={error}
        fileInputRef={fileInputRef}
        onAddFiles={addFiles}
        onRemoveImage={removeImage}
        onToggleTired={() => setTiredMode((v) => !v)}
        onSelectPattern={(p) => {
          setSelectedPattern(p);
          setEnabledRoles([]);
        }}
        onToggleRole={(role) =>
          setEnabledRoles((prev) =>
            prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
          )
        }
        onChangeAppliance={setSelectedAppliance}
        userRequest={userRequest}
        onChangeUserRequest={setUserRequest}
        onAnalyze={startRecognition}
        onOpenSettings={() => setView("settings")}
        onOpenHistory={() => setView("history")}
      />
      {loginPrompt.show && (
        <LoginPromptModal
          reason={loginPrompt.reason}
          onLogin={() => setView("login")}
          onClose={() => setLoginPrompt((p) => ({ ...p, show: false }))}
        />
      )}
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} locale={locale} />
      )}
    </>
  );
}

// ─── Language switcher ────────────────────────────────────────────────────────

function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("settings");

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => router.replace(pathname, { locale: "ja" })}
        className={`px-2.5 py-1 rounded-lg text-sm font-semibold transition ${
          locale === "ja" ? "bg-primary text-white" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        {t("lang_ja")}
      </button>
      <span className="text-gray-200 text-sm">|</span>
      <button
        onClick={() => router.replace(pathname, { locale: "en" })}
        className={`px-2.5 py-1 rounded-lg text-sm font-semibold transition ${
          locale === "en" ? "bg-primary text-white" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        English
      </button>
    </div>
  );
}

// ─── Onboarding view ──────────────────────────────────────────────────────────

function OnboardingView({ onComplete }: { onComplete: (s: UserSettings) => void }) {
  const t = useTranslations("onboarding");
  const [step, setStep] = useState(1);
  const [servings, setServings] = useState(2);
  const [appliances, setAppliances] = useState<string[]>(["pan"]);
  const [ngFoods, setNgFoods] = useState("");

  const applianceOptions = [
    { id: "hotcook", label: t("hotcook"), icon: "🥘" },
    { id: "pan", label: t("pan"), icon: "🍳" },
    { id: "microwave", label: t("microwave"), icon: "📦" },
    { id: "oven", label: t("oven"), icon: "🔥" },
  ];

  const toggleAppliance = (id: string) =>
    setAppliances((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t("title")}</h1>
        <p className="text-sm text-gray-500">{t("subtitle")}</p>
      </div>

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
          <p className="text-lg font-semibold text-gray-800 mb-6">{t("servings_q")}</p>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`py-6 rounded-2xl text-xl font-bold transition ${
                  servings === n
                    ? "bg-primary text-white shadow-lg shadow-green-200"
                    : "bg-white border-2 border-gray-100 text-gray-700 hover:border-primary"
                }`}
              >
                {n === 4 ? t("4plus") : t("n_people", { n })}
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full mt-auto pt-4 bg-primary text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-green-200 hover:opacity-90 transition"
          >
            {t("next")}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 flex flex-col">
          <p className="text-lg font-semibold text-gray-800 mb-2">{t("appliances_q")}</p>
          <p className="text-sm text-gray-400 mb-6">{t("appliances_hint")}</p>
          <div className="space-y-3">
            {applianceOptions.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => toggleAppliance(id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition ${
                  appliances.includes(id)
                    ? "border-primary bg-green-50"
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
          <div className="flex gap-3 mt-auto pt-4">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-4 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition"
            >
              {t("back")}
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-4 rounded-2xl font-bold text-white bg-primary shadow-lg shadow-green-200 hover:opacity-90 transition"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex-1 flex flex-col">
          <p className="text-lg font-semibold text-gray-800 mb-1">{t("ng_q")}</p>
          <p className="text-sm text-gray-400 mb-6">{t("ng_hint")}</p>
          <textarea
            value={ngFoods}
            onChange={(e) => setNgFoods(e.target.value)}
            placeholder={t("ng_placeholder")}
            className="w-full border-2 border-gray-100 rounded-2xl p-4 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-white"
            rows={3}
          />
          <div className="flex gap-3 mt-auto pt-4">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-4 rounded-2xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition"
            >
              {t("back")}
            </button>
            <button
              onClick={() => onComplete({ servings, appliances, ng_foods: ngFoods })}
              className="flex-1 py-4 rounded-2xl font-bold text-white bg-primary shadow-lg shadow-green-200 hover:opacity-90 transition"
            >
              {t("complete")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Shopping list components ─────────────────────────────────────────────────

function ShoppingListSimple({ items }: { items: string[] }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    const text = `【買い物リスト】\n${items.map((i) => `・${i}`).join("\n")}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-orange-600">
          買い足す食材 ({items.length}品)
        </p>
        <button
          onClick={copyToClipboard}
          className="text-xs text-orange-500 border border-orange-200 bg-white px-2 py-1 rounded-lg hover:bg-orange-50 transition"
        >
          {copied ? "コピー済み ✓" : "コピー"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span key={i} className="text-xs bg-white border border-orange-200 text-orange-700 px-2.5 py-1 rounded-full">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ShoppingListFull({
  ingredients,
  seasonings,
  title,
}: {
  ingredients: { name: string; amount: string }[];
  seasonings: { name: string; amount: string }[];
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!ingredients.length && !seasonings.length) return null;

  const copyToClipboard = () => {
    const lines = [`【${title} 買い物リスト】`, ""];
    if (ingredients.length) {
      lines.push("■ 食材（必須）");
      ingredients.forEach((i) => lines.push(`・${i.name}　${i.amount}`));
    }
    if (seasonings.length) {
      lines.push("", "■ 調味料（確認）");
      seasonings.forEach((s) => lines.push(`・${s.name}　${s.amount}`));
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-gray-800">買い物リスト</p>
        <button
          onClick={copyToClipboard}
          className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50 transition"
        >
          {copied ? "コピー済み ✓" : "コピー"}
        </button>
      </div>
      {ingredients.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">食材（必須）</p>
          <div className="space-y-1.5">
            {ingredients.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-700">・{item.name}</span>
                <span className="text-gray-400">{item.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {seasonings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">調味料（確認）</p>
          <div className="space-y-1.5">
            {seasonings.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-400">・{item.name}</span>
                <span className="text-gray-400">{item.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History view ─────────────────────────────────────────────────────────────

type HistorySession = {
  id: string;
  created_at: string;
  tired_mode: boolean;
  detected_ingredients: string[] | null;
  meals: Array<{
    id: string;
    meal_name: string;
    genre: string | null;
    was_selected: boolean;
    was_cooked: boolean;
  }>;
};

function HistoryView({
  onBack,
  onLogin,
  user,
}: {
  onBack: () => void;
  onLogin: () => void;
  user: import("@supabase/supabase-js").User | null;
}) {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric", weekday: "short" });
  };

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="bg-primary-dark px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold text-white">献立履歴</h1>
      </div>

      <div className="flex-1 px-4 py-4">
        {!user ? (
          <div className="flex flex-col items-center gap-4 mt-16 text-center">
            <History size={48} className="text-gray-300" />
            <p className="text-gray-500 text-sm">履歴を見るにはログインが必要です</p>
            <button
              onClick={onLogin}
              className="bg-primary text-white px-6 py-2.5 rounded-full font-semibold text-sm"
            >
              ログイン
            </button>
          </div>
        ) : loading ? (
          <div className="flex justify-center mt-16">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 mt-16 text-center">
            <History size={48} className="text-gray-300" />
            <p className="text-gray-500 text-sm">まだ履歴がありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const selected = session.meals.find((m) => m.was_selected);
              const ingredientPreview = (session.detected_ingredients ?? []).slice(0, 4).join("・");
              return (
                <div key={session.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-1">{formatDate(session.created_at)}</p>
                      {selected ? (
                        <p className="font-semibold text-gray-800 text-sm truncate">{selected.meal_name}</p>
                      ) : (
                        <p className="text-gray-400 text-sm italic">献立未選択</p>
                      )}
                      {ingredientPreview && (
                        <p className="text-xs text-gray-400 mt-1 truncate">{ingredientPreview}{(session.detected_ingredients?.length ?? 0) > 4 ? " …" : ""}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {session.tired_mode && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">時短</span>
                      )}
                      {selected?.was_cooked && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">作った</span>
                      )}
                    </div>
                  </div>
                  {session.meals.length > 1 && (
                    <div className="mt-2 pt-2 border-t border-gray-50 flex flex-wrap gap-1">
                      {session.meals.filter((m) => !m.was_selected).slice(0, 3).map((m) => (
                        <span key={m.id} className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{m.meal_name}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Settings view ────────────────────────────────────────────────────────────

function SettingsView({
  current,
  onSave,
  onBack,
  onLogin,
  user,
  locale,
}: {
  current: UserSettings;
  onSave: (s: UserSettings) => void;
  onBack: () => void;
  onLogin: () => void;
  user: import("@supabase/supabase-js").User | null;
  locale: string;
}) {
  const t = useTranslations("settings");
  const [portalLoading, setPortalLoading] = useState(false);
  const [servings, setServings] = useState(current.servings);
  const [appliances, setAppliances] = useState<string[]>(current.appliances);
  const [ngFoods, setNgFoods] = useState(current.ng_foods);
  const [hasChildren, setHasChildren] = useState<boolean>(current.has_children ?? false);
  const [childrenAgeNote, setChildrenAgeNote] = useState(current.children_age_note ?? "");
  const [tastePreference, setTastePreference] = useState<"light" | "normal" | "rich">(current.taste_preference ?? "normal");
  const [cookingPolicy, setCookingPolicy] = useState(current.cooking_policy ?? "");
  const [planInfo, setPlanInfo] = useState<{ plan: string; stripe_customer_id: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("plan, stripe_customer_id")
      .eq("id", user.id)
      .single()
      .then(({ data }) => setPlanInfo(data));
  }, [user]);

  const applianceOptions = [
    { id: "hotcook", label: t("hotcook"), icon: "🥘" },
    { id: "pan", label: t("pan"), icon: "🍳" },
    { id: "microwave", label: t("microwave"), icon: "📦" },
    { id: "oven", label: t("oven"), icon: "🔥" },
  ];

  const toggleAppliance = (id: string) =>
    setAppliances((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 p-1 hover:text-gray-700 transition"><ArrowLeft size={20} /></button>
        <h2 className="font-bold text-gray-800 text-lg">{t("title")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">{t("servings_q")}</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={`py-3 rounded-xl font-bold transition text-sm ${
                  servings === n
                    ? "bg-primary text-white shadow-md shadow-green-200"
                    : "bg-white border-2 border-gray-100 text-gray-700 hover:border-primary"
                }`}
              >
                {n === 4 ? t("4plus") : t("n_people", { n })}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">{t("appliances_q")}</p>
          <div className="space-y-2">
            {applianceOptions.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => toggleAppliance(id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition ${
                  appliances.includes(id)
                    ? "border-primary bg-green-50"
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

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-1">{t("ng_q")}</p>
          <p className="text-xs text-gray-400 mb-3">{t("ng_hint")}</p>
          <textarea
            value={ngFoods}
            onChange={(e) => setNgFoods(e.target.value)}
            placeholder={t("ng_placeholder")}
            className="w-full border-2 border-gray-100 rounded-2xl p-4 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-white text-sm"
            rows={3}
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">お子さまはいますか？</p>
          <div className="flex gap-2">
            {([false, true] as const).map((val) => (
              <button
                key={String(val)}
                onClick={() => setHasChildren(val)}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold transition border-2 ${
                  hasChildren === val
                    ? "border-primary bg-green-50 text-primary"
                    : "border-gray-100 bg-white text-gray-600 hover:border-gray-200"
                }`}
              >
                {val ? "いる" : "いない"}
              </button>
            ))}
          </div>
          {hasChildren && (
            <input
              type="text"
              value={childrenAgeNote}
              onChange={(e) => setChildrenAgeNote(e.target.value)}
              placeholder="年齢メモ（例：3歳・7歳）"
              className="mt-2 w-full border-2 border-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary bg-white"
            />
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">味の好み</p>
          <div className="flex gap-2">
            {(["light", "normal", "rich"] as const).map((v) => {
              const label = v === "light" ? "薄味" : v === "normal" ? "普通" : "濃いめ";
              return (
                <button
                  key={v}
                  onClick={() => setTastePreference(v)}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition border-2 ${
                    tastePreference === v
                      ? "border-primary bg-green-50 text-primary"
                      : "border-gray-100 bg-white text-gray-600 hover:border-gray-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-1">料理方針メモ</p>
          <p className="text-xs text-gray-400 mb-3">例：時短優先、辛味なし、魚料理が得意</p>
          <textarea
            value={cookingPolicy}
            onChange={(e) => setCookingPolicy(e.target.value)}
            placeholder="自由にメモしてください"
            className="w-full border-2 border-gray-100 rounded-2xl p-4 text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-white text-sm"
            rows={2}
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">{t("language")}</p>
          <LanguageSwitcher />
        </div>

        {user && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">{t("current_plan")}</p>
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="font-bold text-gray-800 text-sm">
                  {planInfo?.plan === "pro" ? t("plan_pro") : t("plan_free")}
                </p>
                {planInfo?.plan === "pro" && (
                  <p className="text-xs text-green-600 mt-0.5">¥980 / {locale === "ja" ? "月" : "mo"}</p>
                )}
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                planInfo?.plan === "pro"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {planInfo?.plan === "pro" ? "Pro" : "Free"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100 space-y-3">
        <button
          onClick={() => onSave({
            servings, appliances, ng_foods: ngFoods,
            has_children: hasChildren,
            children_age_note: childrenAgeNote,
            taste_preference: tastePreference,
            cooking_policy: cookingPolicy,
          })}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition"
        >
          {t("save")}
        </button>
        {user && planInfo?.stripe_customer_id && (
          <button
            onClick={async () => {
              setPortalLoading(true);
              try {
                const res = await fetch("/api/stripe/portal", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ locale }),
                });
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              } finally {
                setPortalLoading(false);
              }
            }}
            disabled={portalLoading}
            className="w-full text-primary text-sm py-2 hover:opacity-70 transition disabled:opacity-40"
          >
            {portalLoading ? "..." : t("manage_plan")}
          </button>
        )}
        {user ? (
          <button
            onClick={async () => {
              const supabase = createClient();
              await supabase.auth.signOut();
              onBack();
            }}
            className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
          >
            {t("logout")}
          </button>
        ) : (
          <button
            onClick={onLogin}
            className="w-full text-primary text-sm py-2 hover:opacity-70 transition"
          >
            {t("login_cta")}
          </button>
        )}
      </div>
    </main>
  );
}

// ─── Upload view ──────────────────────────────────────────────────────────────

function UploadView({
  images,
  tiredMode,
  selectedPattern,
  enabledRoles,
  ownedAppliances,
  selectedAppliance,
  error,
  fileInputRef,
  onAddFiles,
  onRemoveImage,
  onToggleTired,
  onSelectPattern,
  onToggleRole,
  onChangeAppliance,
  userRequest,
  onChangeUserRequest,
  onAnalyze,
  onOpenSettings,
  onOpenHistory,
}: {
  images: ImageItem[];
  tiredMode: boolean;
  selectedPattern: MealPattern;
  enabledRoles: ComponentRole[];
  ownedAppliances: string[];
  selectedAppliance: string;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onToggleTired: () => void;
  onSelectPattern: (p: MealPattern) => void;
  onToggleRole: (role: ComponentRole) => void;
  onChangeAppliance: (a: string) => void;
  userRequest: string;
  onChangeUserRequest: (v: string) => void;
  onAnalyze: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}) {
  const t = useTranslations("upload");
  const locale = useLocale() as "ja" | "en";

  const applianceShortLabels: Record<string, { label: string; icon: string }> = {
    hotcook: { label: t("hotcook"), icon: "🥘" },
    pan: { label: t("pan"), icon: "🍳" },
    microwave: { label: t("microwave"), icon: "📦" },
    oven: { label: t("oven"), icon: "🔥" },
  };

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="bg-primary-dark px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-white tracking-tight">Snapmeal</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenHistory}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition text-white"
            aria-label="History"
          >
            <History size={18} />
          </button>
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition text-white"
            aria-label="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col flex-1">

      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-2xl px-4 py-3 border border-red-100">
          {error}
        </div>
      )}

      <div
        className="border-2 border-dashed border-gray-200 rounded-3xl p-6 mb-4 bg-white cursor-pointer active:bg-gray-50 transition"
        onDrop={(e) => { e.preventDefault(); onAddFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => images.length < MAX_IMAGES && fileInputRef.current?.click()}
      >
        {images.length === 0 ? (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center">
              <Camera size={36} className="text-primary" />
            </div>
            <p className="font-semibold text-gray-700">{t("photo_cta")}</p>
            <p className="text-sm text-gray-400">{t("gallery")}</p>
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
        accept="image/*,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && onAddFiles(e.target.files)}
      />

      <p className="text-xs text-gray-400 text-center mb-6">
        {t(images.length > 0 ? "count_with_tip" : "count_only", {
          count: images.length,
          max: MAX_IMAGES,
        })}
      </p>

      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">{t("energy_q")}</p>
        <div className="flex gap-2">
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
              tiredMode ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            onClick={() => !tiredMode && onToggleTired()}
          >
            <Zap size={14} />{t("tired")}
          </button>
          <button
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-1.5 ${
              !tiredMode ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            onClick={() => tiredMode && onToggleTired()}
          >
            <ChefHat size={14} />{t("energized")}
          </button>
        </div>
      </div>

      {/* Meal pattern selector */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">{t("style_q")}</p>
        <div className="grid grid-cols-3 gap-2">
          {MEAL_PATTERNS.map((pattern) => (
            <button
              key={pattern.id}
              onClick={() => onSelectPattern(pattern)}
              className={`flex flex-col items-center py-2.5 px-1 rounded-xl text-sm font-semibold transition ${
                selectedPattern.id === pattern.id
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span className="text-lg">{pattern.emoji}</span>
              <span className="text-xs mt-0.5">{pattern.label[locale]}</span>
            </button>
          ))}
        </div>

        {selectedPattern.components.filter((c) => c.optional).length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-2">{t("add_q")}</p>
            <div className="flex gap-2">
              {selectedPattern.components.filter((c) => c.optional).map((comp) => (
                <button
                  key={comp.role}
                  onClick={() => onToggleRole(comp.role)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold transition ${
                    enabledRoles.includes(comp.role)
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {comp.label[locale]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {ownedAppliances.length > 1 && (
        <div className="bg-white rounded-2xl p-4 mb-6 border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">{t("appliance_q")}</p>
          <div className="flex gap-2 flex-wrap">
            {ownedAppliances.map((id) => {
              const meta = applianceShortLabels[id] ?? { label: id, icon: "🍴" };
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
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {ownedAppliances.length <= 1 && <div className="mb-2" />}

      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-2">{t("request_q")}</p>
        <textarea
          value={userRequest}
          onChange={(e) => onChangeUserRequest(e.target.value)}
          placeholder={t("request_placeholder")}
          rows={2}
          className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary resize-none bg-gray-50"
        />
      </div>

      <button
        onClick={onAnalyze}
        disabled={images.length === 0}
        className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-green-200 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {t("analyze")}
      </button>
      </div>
    </main>
  );
}

// ─── Recognizing view ────────────────────────────────────────────────────────

function RecognizingView() {
  return (
    <main className="min-h-screen bg-surface flex flex-col items-center justify-center max-w-lg mx-auto px-6">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-lg font-semibold text-gray-800">食材を認識中...</p>
        <p className="text-sm text-muted">冷蔵庫の画像を解析しています</p>
      </div>
    </main>
  );
}

// ─── Ingredient confirm view ──────────────────────────────────────────────────

function IngredientConfirmView({
  ingredients,
  images,
  onConfirm,
  onBack,
}: {
  ingredients: string[];
  images: ImageItem[];
  onConfirm: (edited: string[]) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<string[]>(ingredients);
  const [input, setInput] = useState("");
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  const addItem = () => {
    const trimmed = input.trim();
    if (trimmed && !items.includes(trimmed)) {
      setItems((prev) => [...prev, trimmed]);
    }
    setInput("");
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-4 py-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-gray-100 transition">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">認識した食材</h1>
          <p className="text-xs text-muted">画像を確認しながら追加・削除できます</p>
        </div>
      </div>

      {/* 撮影画像サムネイル */}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setExpandedImg(img.dataUrl)}
              className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-gray-200 hover:border-primary transition"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.dataUrl}
                alt={`冷蔵庫 ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* 食材タグ */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">
          認識した食材
          <span className="ml-2 text-xs font-normal text-muted">（タップで削除）</span>
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">食材が認識されませんでした</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => removeItem(i)}
                className="inline-flex items-center gap-1 bg-green-50 text-green-800 border border-green-200 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition group"
              >
                {item}
                <span className="text-green-400 group-hover:text-red-400 transition leading-none">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 食材追加 */}
      <div className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-2">食材を追加</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="例: 豚バラ肉、卵..."
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary bg-gray-50"
          />
          <button
            onClick={addItem}
            disabled={!input.trim()}
            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition"
          >
            追加
          </button>
        </div>
      </div>

      {/* 確定ボタン */}
      <button
        onClick={() => onConfirm(items)}
        disabled={items.length === 0}
        className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-green-200 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        この食材で献立を作る
      </button>

      {/* 画像拡大モーダル */}
      {expandedImg && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedImg(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedImg}
            alt="冷蔵庫の写真"
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl leading-none"
            onClick={() => setExpandedImg(null)}
          >
            ×
          </button>
        </div>
      )}
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
  const t = useTranslations("analyzing");

  return (
    <main className="min-h-screen bg-surface flex flex-col items-center justify-center max-w-lg mx-auto px-6">
      <div className="w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-lg font-semibold text-gray-800">
            {phase === "scanning" ? t("scanning") : t("generating")}
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

// ─── Hotcook menu section ─────────────────────────────────────────────────────

function HotcookMenuSection({ guide }: { guide: HotcookGuide }) {
  const m = guide.menu_selection;
  // primary_path の末尾に「料理を選ぶ → スタート」を追加
  const pathSteps = [...m.primary_path.split(/\s*→\s*/), "料理を選ぶ", "スタート"];
  const fb = m.manual_fallback;
  const examples = m.auto_menu_examples.slice(0, 4);

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🥘</span>
        <p className="font-semibold text-green-900 text-sm">メニュー選択</p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {pathSteps.map((step, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`border text-xs px-2.5 py-1 rounded-lg font-medium whitespace-nowrap shadow-sm ${
              step === "スタート"
                ? "bg-green-500 border-green-400 text-white"
                : step === "料理を選ぶ"
                  ? "bg-green-100 border-green-300 text-green-800"
                  : "bg-white border-green-200 text-green-800"
            }`}>
              {step}
            </span>
            {i < pathSteps.length - 1 && (
              <span className="text-green-400 text-xs font-bold">→</span>
            )}
          </span>
        ))}
      </div>

      {examples.length > 0 && (
        <p className="text-xs text-green-700">
          例：{examples.map((ex, i) => (
            <span key={i}>
              {i > 0 && "・"}
              <span className="font-medium">{ex}</span>
            </span>
          ))} など
        </p>
      )}

      <div className="bg-white/70 rounded-xl px-3 py-2.5 border border-green-100">
        <p className="text-xs text-green-700 leading-relaxed">
          <span className="font-semibold">※機種によって表示が違う場合は、</span>
          <br />
          <span className="font-medium">{fb.mode}</span>
          {" → "}
          <span className="font-medium">約{fb.time_min_min === fb.time_max_min ? `${fb.time_min_min}分` : `${fb.time_min_min}〜${fb.time_max_min}分`}</span>
          <br />
          でも作れます。
        </p>
      </div>
    </div>
  );
}

// ─── Sub recipe card ──────────────────────────────────────────────────────────

function HotcookGuideCard({ guide }: { guide: HotcookGuide }) {
  const m = guide.menu_selection;
  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-green-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🍲</span>
          <p className="text-xs font-semibold text-green-700">ホットクック調理ガイド</p>
        </div>
        <p className="font-bold text-green-900 text-base">{guide.category}</p>
        <p className="text-xs text-green-700/70 mt-0.5">{guide.category_description}</p>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-green-800 mb-1.5">📱 実機での操作</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {m.primary_path.split(/\s*→\s*/).map((step, i, arr) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="bg-white border border-green-200 text-green-800 text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap">
                  {step}
                </span>
                {i < arr.length - 1 && <span className="text-green-300 text-xs">→</span>}
              </span>
            ))}
          </div>
        </div>

        {m.auto_menu_examples.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-green-800 mb-1.5">💡 この自動メニューが使えます</p>
            <div className="flex flex-wrap gap-1.5">
              {m.auto_menu_examples.slice(0, 4).map((ex, i) => (
                <span
                  key={i}
                  className="bg-white border border-green-200 text-green-700 text-xs px-2 py-0.5 rounded-full"
                >
                  {ex}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white/60 rounded-xl p-2.5 border border-green-100">
          <p className="text-xs font-semibold text-green-800 mb-1">🛠 自動メニューがない場合の手動設定</p>
          <p className="text-sm text-green-900 leading-relaxed">{m.manual_fallback.mode}</p>
          <p className="text-xs text-green-700 mt-0.5">
            沸とう後 <span className="font-bold">{m.manual_fallback.time_min_min}〜{m.manual_fallback.time_max_min}分</span>
            （{m.manual_fallback.time_condition}）
          </p>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs font-semibold text-green-800 mb-1.5">⚠ 調理ポイント</p>
        <div className="space-y-1.5">
          <div className="flex gap-2 text-xs text-gray-700">
            <span className="flex-shrink-0">💧</span>
            <span className="leading-relaxed">{guide.water_note}</span>
          </div>
          <div className="flex gap-2 text-xs text-gray-700">
            <span className="flex-shrink-0">🔄</span>
            <span className="leading-relaxed">{guide.stir_note}</span>
          </div>
          <div className="flex gap-2 text-xs text-gray-700">
            <span className="flex-shrink-0">⏱</span>
            <span className="leading-relaxed">{guide.time_note}</span>
          </div>
          <div className="flex gap-2 text-xs text-gray-700">
            <span className="flex-shrink-0">📏</span>
            <span className="leading-relaxed">{guide.capacity_warning}</span>
          </div>
          {guide.safety_notes.map((note, i) => (
            <div key={i} className="flex gap-2 text-xs text-amber-700">
              <span className="flex-shrink-0">⚠</span>
              <span className="leading-relaxed">{note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 「A」→「B」→「C」のようなホットクック操作ナビを緑ボタンチップに変換
function renderStepText(text: string): React.ReactNode {
  const navPattern = /「[^」]+」(?:→「[^」]+」)+/g;
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasMatch = false;

  while ((match = navPattern.exec(text)) !== null) {
    hasMatch = true;
    if (match.index > lastIndex) {
      result.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const buttons = match[0].match(/「[^」]+」/g)?.map((s) => s.slice(1, -1)) ?? [];
    result.push(
      <span key={`nav-${match.index}`} className="inline-flex items-center flex-wrap gap-1 align-middle">
        {buttons.map((btn, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="bg-green-50 text-green-800 border border-green-200 text-xs px-2 py-0.5 rounded font-medium leading-5 whitespace-nowrap">
              {btn}
            </span>
            {i < buttons.length - 1 && (
              <span className="text-green-600 text-xs font-bold">→</span>
            )}
          </span>
        ))}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (!hasMatch) return text;
  if (lastIndex < text.length) {
    result.push(<span key="t-end">{text.slice(lastIndex)}</span>);
  }
  return <>{result}</>;
}

function SubRecipeCard({
  label,
  icon,
  sub,
}: {
  label: string;
  icon: string;
  sub: SubRecipe;
}) {
  const t = useTranslations("recipe");
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-semibold text-gray-400 mb-1">{icon} {label}</p>
        <p className="font-bold text-gray-900">{sub.title}</p>
      </div>
      <div className="px-4 pb-2">
        {sub.ingredients?.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">{t("ingredients")}</p>
            <div className="space-y-1">
              {sub.ingredients.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.name}</span>
                  <span className="text-gray-400">{item.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {sub.seasonings?.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">{t("seasonings")}</p>
            <div className="space-y-1">
              {sub.seasonings.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.name}</span>
                  <span className="text-gray-400">{item.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {sub.steps?.length > 0 && (
          <div className="pb-2">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">{t("steps")}</p>
            <div className="space-y-2">
              {sub.steps.map((step, i) => (
                <div key={i} className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">{renderStepText(step)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recipe view ──────────────────────────────────────────────────────────────

function RecipeView({
  recipe,
  loading,
  onBack,
  onHome,
  selectedPattern,
  sessionId,
  user,
}: {
  recipe: RecipeData | null;
  loading: boolean;
  onBack: () => void;
  onHome: () => void;
  selectedPattern: MealPattern;
  sessionId: string | null;
  user: import("@supabase/supabase-js").User | null;
}) {
  const t = useTranslations("recipe");
  const locale = useLocale() as "ja" | "en";
  const hasSubDishes = recipe?.side_recipe || recipe?.soup_recipe;
  const mainLabel = getComponentLabel(selectedPattern, "main", locale);
  const sideLabel = getComponentLabel(selectedPattern, "side", locale);
  const soupLabel = getComponentLabel(selectedPattern, "soup", locale);

  const [wasCooked, setWasCooked] = useState<boolean | null>(null);
  const [reaction, setReaction] = useState<"liked" | "disliked" | null>(null);
  const [reactionMemo, setReactionMemo] = useState("");
  const [nextTimeMemo, setNextTimeMemo] = useState("");
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  const saveFeedbackData = (updates: {
    wasCooked?: boolean | null;
    reaction?: "liked" | "disliked" | null;
    reactionMemo?: string;
    nextTimeMemo?: string;
  }) => {
    if (!user || !sessionId || !recipe) return;
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        meal_name: recipe.title,
        was_cooked: updates.wasCooked ?? wasCooked ?? undefined,
        family_reaction: updates.reaction !== undefined ? updates.reaction : reaction,
        reaction_memo: updates.reactionMemo ?? reactionMemo,
        next_time_memo: updates.nextTimeMemo ?? nextTimeMemo,
      }),
    }).catch(() => {});
    setFeedbackSaved(true);
  };

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 p-1 hover:text-gray-700 transition"><ArrowLeft size={20} /></button>
        <h2 className="font-bold text-gray-800 text-lg truncate">
          {loading ? t("generating_title") : (recipe?.title ?? t("default_title"))}
        </h2>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">{t("thinking")}</p>
        </div>
      ) : recipe ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
            <p className="text-sm text-gray-400">{t("servings", { count: recipe.servings })}</p>

            {hasSubDishes && (
              <p className="text-xs font-semibold text-primary">🍖 {mainLabel}</p>
            )}

            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="font-semibold text-gray-800 mb-3">{t("ingredients")}</p>
              <div className="space-y-2">
                {(recipe.ingredients ?? []).map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700">{item.name}</span>
                    <span className="text-gray-400">{item.amount}</span>
                  </div>
                ))}
              </div>
            </div>

            {recipe.seasonings?.length > 0 && (
              <div className="bg-white rounded-2xl p-4 border border-gray-100">
                <p className="font-semibold text-gray-800 mb-3">{t("seasonings")}</p>
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

            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <p className="font-semibold text-gray-800 mb-4">{t("steps")}</p>
              <div className="space-y-4">
                {recipe.steps.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {i + 1}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">{renderStepText(step)}</p>
                  </div>
                ))}
              </div>
            </div>

            {recipe.hotcook && (
              <HotcookMenuSection guide={recipe.hotcook} />
            )}

            {recipe.substitutions && recipe.substitutions.length > 0 && (
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
                <p className="font-semibold text-gray-800 mb-3">🔄 代用メモ</p>
                <div className="space-y-2">
                  {recipe.substitutions.map((note, i) => (
                    <div key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="flex-shrink-0 text-amber-500">•</span>
                      <span className="leading-relaxed">{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recipe.tips && (
              <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                <p className="font-semibold text-gray-800 mb-2">💡 仕上げのコツ</p>
                <p className="text-sm text-gray-700 leading-relaxed">{recipe.tips}</p>
              </div>
            )}

            {recipe.side_recipe && (
              <SubRecipeCard label={sideLabel} icon="🥗" sub={recipe.side_recipe} />
            )}

            {recipe.soup_recipe && (
              <SubRecipeCard label={soupLabel} icon="🍵" sub={recipe.soup_recipe} />
            )}

            <ShoppingListFull
              ingredients={recipe.ingredients ?? []}
              seasonings={recipe.seasonings ?? []}
              title={recipe.title}
            />

            <p className="text-xs text-gray-400 text-center pb-2">{t("safety")}</p>
          </div>

          <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const next = wasCooked === true ? null : true;
                  setWasCooked(next);
                  saveFeedbackData({ wasCooked: next ?? undefined });
                  if (next === true) trackEvent(EVENTS.RECIPE_COOKED, { meal_name: recipe.title });
                }}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition ${wasCooked === true ? "bg-accent text-white shadow-lg shadow-green-200" : "bg-gray-100 text-gray-600 hover:bg-green-50"}`}
              >
                作った
              </button>
              <button
                onClick={() => {
                  const next = wasCooked === false ? null : false;
                  setWasCooked(next);
                  saveFeedbackData({ wasCooked: next ?? undefined });
                }}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition ${wasCooked === false ? "bg-gray-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                作らなかった
              </button>
            </div>

            {wasCooked === true && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const next = reaction === "liked" ? null : "liked";
                      setReaction(next);
                      saveFeedbackData({ reaction: next });
                    }}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${reaction === "liked" ? "bg-yellow-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-yellow-50"}`}
                  >
                    家族がよく食べた
                  </button>
                  <button
                    onClick={() => {
                      const next = reaction === "disliked" ? null : "disliked";
                      setReaction(next);
                      saveFeedbackData({ reaction: next });
                    }}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${reaction === "disliked" ? "bg-blue-400 text-white" : "bg-gray-100 text-gray-600 hover:bg-blue-50"}`}
                  >
                    あまり食べなかった
                  </button>
                </div>
                <textarea
                  value={reactionMemo}
                  onChange={(e) => setReactionMemo(e.target.value)}
                  onBlur={() => saveFeedbackData({ reactionMemo })}
                  placeholder="家族の反応メモ（任意）"
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <textarea
                  value={nextTimeMemo}
                  onChange={(e) => setNextTimeMemo(e.target.value)}
                  onBlur={() => saveFeedbackData({ nextTimeMemo })}
                  placeholder="次回へのメモ（例：塩を少し減らす）"
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {feedbackSaved && (
                  <p className="text-xs text-gray-400 text-center">保存しました</p>
                )}
              </div>
            )}

            <button
              onClick={onHome}
              className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center gap-2"
            >
              <Camera size={16} />
              もう一度撮る
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
  selectedPattern,
}: {
  meals: Meal[];
  activeMealIdx: number;
  onChangeIdx: (idx: number) => void;
  onBack: () => void;
  onSelectMeal: (meal: Meal) => void;
  favorites: string[];
  onToggleFavorite: (meal: Meal) => void;
  selectedPattern: MealPattern;
}) {
  const t = useTranslations("result");
  const locale = useLocale() as "ja" | "en";
  const meal = meals[activeMealIdx];
  if (!meal) return null;

  const canGoNext = activeMealIdx < meals.length - 1;
  const canGoPrev = activeMealIdx > 0;
  const totalSlots = 3;
  const isFavorite = favorites.includes(meal.name);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && canGoNext) onChangeIdx(activeMealIdx + 1);
    if (dx > 0 && canGoPrev) onChangeIdx(activeMealIdx - 1);
  };
  const mainLabel = getComponentLabel(selectedPattern, "main", locale);
  const sideLabel = getComponentLabel(selectedPattern, "side", locale);
  const soupLabel = getComponentLabel(selectedPattern, "soup", locale);

  const difficultyKey = meal.difficulty as "easy" | "medium" | "hard";
  const difficultyLabel = t(difficultyKey);

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="text-gray-500 p-1 hover:text-gray-700 transition"><ArrowLeft size={20} /></button>
        <h2 className="font-bold text-gray-800 text-lg">{t("title")}</h2>
        <button
          onClick={() => onToggleFavorite(meal)}
          className="ml-auto p-1 transition-transform active:scale-90"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Heart size={22} className={isFavorite ? "fill-red-500 text-red-500" : "text-gray-300"} />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-6 space-y-5"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div>
          <p className="text-xs font-semibold text-primary mb-1 uppercase tracking-wide">{mainLabel}</p>
          <p className="text-2xl font-bold text-gray-900">{meal.name}</p>
          <p className="text-gray-500 text-sm mt-1">{meal.reason}</p>
          <div className="flex gap-3 mt-2">
            <span className="text-sm text-gray-500">{t("time", { minutes: meal.time_minutes })}</span>
            <span className="text-sm text-gray-500">{t("difficulty_label", { level: difficultyLabel })}</span>
            <span className="text-sm text-gray-500">{meal.genre}</span>
          </div>
        </div>

        {meal.side && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-green-600 mb-1">🥗 {sideLabel}</p>
            <p className="font-bold text-gray-900">{meal.side.name}</p>
            {meal.side.matched_ingredients?.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">{meal.side.matched_ingredients.join("・")}</p>
            )}
          </div>
        )}

        {meal.soup && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-blue-500 mb-1">🍵 {soupLabel}</p>
            <p className="font-bold text-gray-900">{meal.soup.name}</p>
            {meal.soup.matched_ingredients?.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">{meal.soup.matched_ingredients.join("・")}</p>
            )}
          </div>
        )}

        {meal.matched_ingredients?.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-sm font-semibold text-accent mb-2">{t("available")}</p>
            <p className="text-sm text-gray-600">{meal.matched_ingredients.join("・")}</p>
          </div>
        )}

        {meal.missing_ingredients?.length > 0 && (
          <ShoppingListSimple items={meal.missing_ingredients} />
        )}
      </div>

      <div className="px-4 pb-8 pt-4 bg-white border-t border-gray-100 space-y-3">
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
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition"
        >
          {t("select")}
        </button>

        <button
          onClick={() => canGoNext ? onChangeIdx(activeMealIdx + 1) : null}
          disabled={!canGoNext}
          className="w-full bg-gray-100 text-gray-700 py-3.5 rounded-2xl font-semibold text-base hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {meals.length < totalSlots && !canGoNext ? t("preparing") : t("next")}
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
  const t = useTranslations("loginPrompt");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <p className="text-4xl mb-3">{reason === "favorite" ? "❤️" : "⚡"}</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">
            {reason === "favorite" ? t("fav_title") : t("limit_title")}
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            {reason === "favorite"
              ? t("fav_body")
              : t("limit_body", { limit: GUEST_LIMIT })}
          </p>
        </div>
        <button
          onClick={onLogin}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition mb-3"
        >
          {t("cta")}
        </button>
        <button
          onClick={onClose}
          className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
        >
          {t("later")}
        </button>
      </div>
    </div>
  );
}

// ─── Login view ───────────────────────────────────────────────────────────────

function LoginView({ onBack }: { onBack: () => void }) {
  const t = useTranslations("login");
  const locale = useLocale();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);

  const supabase = createClient();

  const handleResend = async () => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/${locale}/auth/callback` },
    });
    if (error) setError(t("error_generic"));
    else { setInfo(t("email_resent")); setShowResend(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/${locale}/auth/callback?type=recovery`,
      });
      setLoading(false);
      if (error) setError(t("error_generic"));
      else setInfo(t("forgot_sent"));
      return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/${locale}/auth/callback` },
      });
      setLoading(false);
      if (error) {
        if (error.message?.includes("Database error saving new user") || error.code === "unexpected_failure") {
          setError(t("error_already_registered"));
        } else {
          setError(t("error_generic"));
        }
      } else if (data.session) {
        // メール確認なしで即ログイン成功（確認不要設定の場合）
        setInfo(null);
      } else {
        setInfo(t("signup_success"));
      }
      return;
    }

    // signin
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      if (error.code === "email_not_confirmed") {
        setError(t("error_not_confirmed"));
        setShowResend(true);
      } else {
        setError(t("error_invalid"));
        setShowResend(false);
      }
    }
  };

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/${locale}/auth/callback` },
    });
  };

  const switchMode = (next: "signin" | "signup") => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword("");
  };

  return (
    <main className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto px-6">
      <div className="flex items-center pt-6 pb-2">
        <button onClick={onBack} className="text-gray-500 p-1 hover:text-gray-700 transition">
          <ArrowLeft size={20} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full">
          <div className="text-center mb-8">
            <p className="text-6xl mb-4">📸</p>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("title")}</h1>
            <p className="text-gray-500 text-sm">{t("subtitle")}</p>
          </div>

          {mode === "forgot" ? (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-1">{t("forgot_title")}</p>
              <p className="text-xs text-gray-400 mb-4">{t("forgot_subtitle")}</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("email_placeholder")}
                  required
                  autoFocus
                  autoComplete="email"
                  className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-green-100 transition text-base"
                />
                {error && <p className="text-sm text-red-500 bg-red-50 py-2 px-4 rounded-xl text-center">{error}</p>}
                {info && <p className="text-sm text-green-600 bg-green-50 py-2 px-4 rounded-xl text-center">{info}</p>}
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition disabled:opacity-40"
                >
                  {loading ? t("loading") : t("forgot_cta")}
                </button>
              </form>
              <button onClick={() => setMode("signin")} className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition w-full text-center">
                {t("back_to_signin")}
              </button>
            </>
          ) : (
            <>
              {/* タブ */}
              <div className="flex bg-gray-100 rounded-2xl p-1 mb-6">
                {(["signin", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMode(m)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${
                      mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-400"
                    }`}
                  >
                    {m === "signin" ? t("tab_signin") : t("tab_signup")}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("email_placeholder")}
                  required
                  autoFocus
                  autoComplete="email"
                  className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-green-100 transition text-base"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("password_placeholder")}
                  required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 8 : undefined}
                  className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-800 placeholder-gray-300 focus:outline-none focus:border-primary focus:ring-2 focus:ring-green-100 transition text-base"
                />

                {error && (
                  <div className="bg-red-50 py-2 px-4 rounded-xl text-center">
                    <p className="text-sm text-red-500">{error}</p>
                    {showResend && (
                      <button type="button" onClick={handleResend} className="text-xs text-red-600 underline mt-1">
                        {t("resend_email")}
                      </button>
                    )}
                  </div>
                )}
                {info && <p className="text-sm text-green-600 bg-green-50 py-2 px-4 rounded-xl text-center">{info}</p>}

                <button
                  type="submit"
                  disabled={loading || !email.trim() || !password}
                  className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition disabled:opacity-40"
                >
                  {loading ? t("loading") : mode === "signin" ? t("signin_cta") : t("signup_cta")}
                </button>
              </form>

              {mode === "signin" && (
                <button
                  onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}
                  className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition w-full text-center"
                >
                  {t("forgot")}
                </button>
              )}

              {/* 区切り */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">{t("divider")}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* Google ログイン */}
              <button
                onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl border-2 border-gray-200 bg-white text-gray-700 font-semibold text-sm hover:border-gray-300 hover:bg-gray-50 transition"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                {t("google_cta")}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// ─── Upgrade modal ────────────────────────────────────────────────────────────

function UpgradeModal({ onClose, locale }: { onClose: () => void; locale: string }) {
  const t = useTranslations("upgrade");
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    // ブラウザの言語設定からEU圏かを判定
    const browserLang = typeof navigator !== "undefined" ? navigator.language : "";
    const euLangs = ["de", "fr", "it", "es", "nl", "pl", "pt", "sv", "fi", "da", "nb", "el"];
    const isEU = euLangs.some((l) => browserLang.startsWith(l));
    const region = locale === "ja" ? "jp" : isEU ? "eur" : "usd";
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, region }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <p className="text-4xl mb-3">🚀</p>
          <h3 className="text-lg font-bold text-gray-900 mb-1">{t("title")}</h3>
          <p className="text-sm text-gray-500 leading-relaxed mb-4 whitespace-pre-line">
            {t("body")}
          </p>

          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-gray-50 rounded-2xl p-4 text-left border-2 border-gray-100">
              <p className="text-xs text-gray-400 font-semibold mb-1">{t("free_label")}</p>
              <p className="text-2xl font-bold text-gray-800 mb-1">{t("free_price")}</p>
              <p className="text-sm text-gray-500">{t("free_count")}</p>
            </div>
            <div className="flex-1 bg-green-50 rounded-2xl p-4 text-left border-2 border-primary">
              <p className="text-xs text-primary font-semibold mb-1">{t("pro_label")}</p>
              <p className="text-2xl font-bold text-gray-800 mb-1">
                {t("pro_price")}<span className="text-sm font-normal text-gray-500">{t("pro_period")}</span>
              </p>
              <p className="text-sm text-gray-600">{t("pro_count")}</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base shadow-lg shadow-green-200 hover:opacity-90 transition mb-3 disabled:opacity-60"
        >
          {loading ? t("redirecting") : t("cta")}
        </button>
        <button
          onClick={onClose}
          className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition"
        >
          {t("wait")}
        </button>
      </div>
    </div>
  );
}
