/**
 * `text` cut to at most `max` UTF-16 units without splitting a surrogate pair.
 *
 * `text.slice(0, max)` can end on the first half of an emoji. That lone half is not valid
 * in the JSON sent to the database, which rejects the whole row, so anything stored from a
 * cut string is cut here instead.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
}
