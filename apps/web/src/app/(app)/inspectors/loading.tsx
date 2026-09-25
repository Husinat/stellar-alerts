import { LoadingState } from '@/components/LoadingState';

export default function InspectorsLoading() {
  return (
    <div className="space-y-12 animate-pulse">
      <div className="space-y-2 border-b border-white/5 pb-6">
        <div className="h-8 w-64 bg-white/10 rounded-xl" />
        <div className="h-4 w-96 bg-white/5 rounded-lg" />
      </div>

      <LoadingState message="Loading payment ledger and Dead-Letter Queue…" variant="card" />
    </div>
  );
}
