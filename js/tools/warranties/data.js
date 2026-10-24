// Warranties & documents data. Photos live in their own collection ('docImages') so editing
// a document's details doesn't re-send its pictures to your other devices.
import * as store from '../../core/store.js';

export const docs = () => store.all('docs');
export const getDoc = (id) => store.get('docs', id);
export const docsForItem = (itemId) => (itemId ? docs().filter((d) => d.itemId === itemId) : []);
export const imagesOf = (docId) => store.all('docImages').filter((i) => i.docId === docId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** Save the document and sync its image list: images = [{ id?, data }] in display order. */
export async function saveDoc(doc, images) {
  const rec = await store.put('docs', doc);
  if (images) {
    const keep = new Set(images.filter((i) => i.id).map((i) => i.id));
    for (const old of imagesOf(rec.id)) if (!keep.has(old.id)) await store.remove('docImages', old.id);
    let order = 0;
    for (const img of images) {
      if (img.id) { const cur = store.get('docImages', img.id); if (cur && cur.order !== order) await store.put('docImages', { ...cur, order }); }
      else await store.put('docImages', { docId: rec.id, data: img.data, order });
      order++;
    }
  }
  return rec;
}

export async function removeDoc(id) {
  const imgs = imagesOf(id);
  const prev = await store.remove('docs', id);
  for (const i of imgs) await store.remove('docImages', i.id);
  return { prev, imgs };
}
export async function restoreDoc({ prev, imgs }) {
  await store.restore('docs', prev);
  for (const i of imgs) await store.restore('docImages', i);
}
