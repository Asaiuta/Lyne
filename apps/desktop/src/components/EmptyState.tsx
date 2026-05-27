import type { JSX } from "solid-js";
import { useTranslation } from "../shared/i18n";
import { NaiveEmpty } from "../shared/ui/naive";

interface EmptyStateProps {
  description?: string;
  size?: "sm" | "md" | "lg";
  icon?: JSX.Element;
}

export function EmptyState(props: EmptyStateProps) {
  const { t } = useTranslation();
  const text = () => props.description ?? t("common.empty.description");
  return <NaiveEmpty description={text()} icon={props.icon} size={props.size} />;
}
