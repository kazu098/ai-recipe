import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Snapmeal</h1>
      <p className="text-gray-500 mb-8">冷蔵庫を撮るだけ。30秒で今夜の夕食が決まる。</p>
      <Link
        href="/playground"
        className="bg-primary text-white px-6 py-3 rounded-2xl font-semibold hover:opacity-90 transition"
      >
        🧪 モデル比較プレイグラウンドを開く
      </Link>
    </main>
  );
}
