/**
 * Lumen 2 Alert — inline persistent status (info/success/warn/danger).
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

export type AlertTone = "info" | "success" | "warn" | "danger";

export type AlertProps = {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
  icon?: IconName | null;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children" | "className">;

const TONE_ICON: Record<AlertTone, IconName> = {
  info: "info",
  success: "check",
  warn: "warning",
  danger: "warning",
};

export function Alert({
  tone = "info",
  title,
  children,
  className = "",
  icon,
  ...rest
}: AlertProps) {
  const iconName = icon === null ? null : (icon ?? TONE_ICON[tone]);
  const classes = ["l2-alert", `l2-alert--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role={tone === "danger" || tone === "warn" ? "alert" : "status"}
      data-tone={tone}
      {...rest}
    >
      {iconName ? (
        <span className="l2-alert__icon">
          <Icon name={iconName} size="md" decorative />
        </span>
      ) : null}
      <div className="l2-alert__content">
        {title ? <p className="l2-alert__title">{title}</p> : null}
        <div className="l2-alert__body">{children}</div>
      </div>
    </div>
  );
}
