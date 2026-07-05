import type { Setter } from "solid-js";
import type { TranslationKey, TranslationParams } from "../../../shared/i18n";
import type { Feedback } from "./types";

export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export type FeedbackSetter = (tone: Feedback["tone"], message: string) => void;

export const createInitialFeedback = (t: Translator): Feedback => ({
  tone: "neutral",
  message: t("ncm.feedback.initial")
});

export const createFeedbackSetter = (setFeedback: Setter<Feedback>): FeedbackSetter => {
  return (tone, message) => setFeedback({ tone, message });
};

export const createErrorMessageReader = (t: Translator) => {
  return (error: unknown): string =>
    error instanceof Error ? error.message : t("common.error.requestFailed");
};
