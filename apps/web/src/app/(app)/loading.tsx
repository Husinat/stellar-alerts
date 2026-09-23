export default function AppLoading() {
  return (
    <div className="py-24 flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-sm text-gray-400">Loading workspace…</p>
    </div>
  );
}