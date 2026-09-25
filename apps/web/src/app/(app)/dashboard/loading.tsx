import { LoadingState } from '@/components/LoadingState';

export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-white/10 rounded-xl" />
          <div className="h-4 w-72 bg-white/5 rounded-lg" />
        </div>
        <div className="h-10 w-36 bg-purple-500/10 rounded-xl border border-purple-500/20" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-6 rounded-2xl bg-[#0c0c14] border border-white/5 space-y-3">
            <div className="h-4 w-24 bg-white/5 rounded" />
            <div className="h-8 w-32 bg-white/10 rounded" />
            <div className="h-3 w-16 bg-white/5 rounded" />
          </div>
        ))}
      </div>

      <LoadingState message="Loading live payments and contract subscriptions…" variant="card" />
    </div>
  );
}
