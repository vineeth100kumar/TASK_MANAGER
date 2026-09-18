import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { haptics } from '../../utils/haptics';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = ''
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const PULL_THRESHOLD = 60;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only start pull if at top of scroll
      if (window.scrollY <= 0 && el.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
      } else {
        startY.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startY.current === null || isRefreshing) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;

      if (diff > 0) {
        // Elastic damping
        const damped = Math.min(100, Math.pow(diff, 0.8));
        setPullDistance(damped);
      }
    };

    const handleTouchEnd = async () => {
      if (startY.current === null) return;
      if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
        setIsRefreshing(true);
        haptics.medium();
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
      startY.current = null;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, isRefreshing, onRefresh]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Pull Indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-150"
        style={{ height: `${pullDistance}px`, opacity: pullDistance / PULL_THRESHOLD }}
      >
        <div className="flex items-center space-x-2 text-meta font-medium text-blue-400 bg-surface/90 border border-hairline px-3 py-1 rounded-full shadow-lg">
          <RefreshCw
            className={`w-3.5 h-3.5 text-blue-400 ${
              isRefreshing ? 'animate-spin' : ''
            }`}
            style={{ transform: `rotate(${pullDistance * 3}deg)` }}
          />
          <span>{isRefreshing ? 'Refreshing...' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull down'}</span>
        </div>
      </div>

      {children}
    </div>
  );
};
