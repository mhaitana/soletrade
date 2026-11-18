"use client";

import { useState } from "react";
import type { MessageRating } from "@/lib/domain/conversations/conversations-types";
import { setMessageFeedbackAction } from "@/features/assistant/api/actions";

export type MessageRatings = Readonly<Record<string, MessageRating>>;

/**
 * The signed-in person's thumbs up / down on the replies of the conversation on screen.
 * A rating shows at once and is put back if the server did not take it.
 */
export function useMessageFeedback(initial: MessageRatings = {}) {
  const [ratings, setRatings] = useState<MessageRatings>(initial);

  /** Rate a reply, change the rating, add a note, or clear it (`null`). True when saved. */
  async function rate(
    messageId: string,
    rating: MessageRating | null,
    comment?: string,
  ): Promise<boolean> {
    const before = ratings[messageId];
    setRatings((current) => withRating(current, messageId, rating));
    try {
      const result = await setMessageFeedbackAction({ messageId, rating, comment });
      if (result.ok) return true;
    } catch {
      // Falls through to putting the previous rating back.
    }
    setRatings((current) => withRating(current, messageId, before ?? null));
    return false;
  }

  return {
    ratings,
    rate,
    /** Show another conversation's ratings. */
    reset: setRatings,
  };
}

function withRating(
  ratings: MessageRatings,
  messageId: string,
  rating: MessageRating | null,
): MessageRatings {
  const next = { ...ratings };
  if (rating) next[messageId] = rating;
  else delete next[messageId];
  return next;
}
