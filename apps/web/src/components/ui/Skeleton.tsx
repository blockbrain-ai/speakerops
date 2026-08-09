/**
 * Lumen 2 Skeleton — loading placeholders approximating final layout.
 * States: loading (default). Honors prefers-reduced-motion via CSS.
 */
import type { HTMLAttributes } from "react";

export type SkeletonVariant = "text" | "title" | "circle" | "rect" | "row";

export type SkeletonProps = {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className">;

export function Skeleton({
  variant = "text",
  width,
  height,
  className = "",
  style,
  ...rest
}: SkeletonProps) {
  const classes = [
    "l2-skeleton",
    `l2-skeleton--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-state="loading"
      aria-hidden="true"
      style={{
        ...style,
        width: width ?? style?.width,
        height: height ?? style?.height,
      }}
      {...rest}
    />
  );
}
