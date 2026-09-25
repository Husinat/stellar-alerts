export default function TMALoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-4"
    >
      <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-white">Loading Telegram Mini App…</p>
        <p className="text-xs text-gray-500">Validating HMAC signature and user profile</p>
      </div>
    </div>
  );
}
