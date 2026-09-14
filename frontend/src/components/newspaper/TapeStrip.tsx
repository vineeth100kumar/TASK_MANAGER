import React from 'react';
import { clsx } from 'clsx';

interface TapeStripProps {
  rotate?: number;
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const TapeStrip: React.FC<TapeStripProps> = ({
  rotate = -2,
  className,
  width,
  height,
}) => {
  return (
    <div
      aria-hidden="true"
      className={clsx('tape-strip', className)}
      style={{
        transform: `rotate(${rotate}deg)`,
        width: width ?? undefined,
        height: height ?? undefined,
      }}
    />
  );
};
