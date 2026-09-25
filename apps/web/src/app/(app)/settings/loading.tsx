import { LoadingState } from '@/components/LoadingState';

export default function SettingsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-2 border-b border-white/5 pb-6">
        <div className="h-8 w-44 bg-white/10 rounded-xl" />
        <div className="h-4 w-72 bg-white/5 rounded-lg" />
      </div>

      <LoadingState message="Loading notification preferences and security settings…" variant="card" />
    </div>
  );
}
