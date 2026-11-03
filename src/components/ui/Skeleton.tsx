export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-xl bg-[linear-gradient(90deg,#141414_0%,#222_50%,#141414_100%)] bg-[length:500px_100%] ${className}`} />;
}
