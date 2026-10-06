import React from 'react';
import { cn } from '../../lib/utils.js';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('rounded-md bg-white/5 animate-shimmer', className)}
      {...props}
    />
  );
}
