/**
 * A post on X sharing a claimed name. X shows the profile's card, the name's neon sign, under it.
 * The text leaves out the @name, because X would make it a mention of whoever holds that name there.
 */
export function signShareHref(handle: string): string {
  const text = 'I claimed my name on UPROAR.';
  const url = `${window.location.origin}/@${handle}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
