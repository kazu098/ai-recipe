"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isEn =
    typeof window !== "undefined" && window.location.pathname.startsWith("/en");

  const handleRestart = () => {
    window.location.href = isEn ? "/en" : "/ja";
  };

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl mb-6">⚠️</div>
      <h1 className="text-lg font-bold text-gray-800 mb-2">
        {isEn ? "Something went wrong" : "エラーが発生しました"}
      </h1>
      <p className="text-sm text-gray-500 mb-8 leading-relaxed">
        {isEn
          ? "An unexpected error occurred. Please try again from the beginning."
          : "予期しないエラーが発生しました。最初からやり直してください。"}
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={handleRestart}
          className="w-full bg-primary text-white font-bold py-3.5 rounded-full text-sm shadow-lg shadow-green-100 hover:bg-primary-dark transition"
        >
          {isEn ? "Start over" : "最初からやり直す"}
        </button>
        <button
          onClick={reset}
          className="w-full bg-white text-gray-500 font-medium py-3 rounded-full text-sm border border-gray-200 hover:bg-gray-50 transition"
        >
          {isEn ? "Try again" : "もう一度試す"}
        </button>
      </div>
    </div>
  );
}
