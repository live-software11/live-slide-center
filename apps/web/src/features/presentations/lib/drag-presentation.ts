/**
 * Sprint H (GUIDA_OPERATIVA_v3 §3.C C3) — drag&drop file gia' caricati tra
 * sessioni dell'evento.
 *
 * Usiamo un MIME type custom per il `DataTransfer` cosi':
 *  1) Distinguere il drop "muovi presentation" dal drop "carica file dal SO":
 *     i due si presentano allo stesso `onDrop` handler con payload diverso.
 *     Files dal SO: `e.dataTransfer.files.length > 0` + `types.includes('Files')`.
 *     Presentation: `e.dataTransfer.types.includes(PRESENTATION_DRAG_MIME)`.
 *  2) Browser cross-tab: se l'utente tenta di trascinare un file da un'altra
 *     tab del nostro stesso dominio funziona (alcuni browser preservano i
 *     types custom); cross-origin invece non si trasferisce per sicurezza
 *     (good: non vogliamo che un sito esterno possa "fingere" un nostro drag).
 *  3) Visual feedback: durante `dragover`, controlliamo i types per cambiare
 *     il colore del border (verde "carica" vs blu "sposta") senza dover
 *     leggere `dataTransfer.getData()` che e' disponibile solo su `drop`.
 *
 * NB: i `dataTransfer.types` durante `dragover`/`dragenter` ritornano un
 * `DOMStringList` su browser legacy e un `Array<string>` su moderni; usiamo
 * `Array.from()` per uniformare. I valori sono lowercase; il MIME custom
 * deve essere lowercase per match cross-browser.
 */

export const PRESENTATION_DRAG_MIME = 'application/x-slidecenter-presentation';

export interface PresentationDragPayload {
  presentationId: string;
  fromSessionId: string;
  fileName: string;
}

/** Serializza payload + setta sia MIME custom sia text/plain (fallback DnD). */
export function setPresentationDragData(
  dataTransfer: DataTransfer,
  payload: PresentationDragPayload,
): void {
  const json = JSON.stringify(payload);
  // Custom MIME e' la fonte di verita'.
  dataTransfer.setData(PRESENTATION_DRAG_MIME, json);
  // text/plain come fallback umano (es. drop in barra indirizzi mostra il nome).
  dataTransfer.setData('text/plain', payload.fileName);
  // 'move' indica al browser di mostrare il cursor "→" invece di "+".
  dataTransfer.effectAllowed = 'move';
}

/** Estrae payload da un drop event. Ritorna null se MIME custom assente o JSON corrotto. */
export function readPresentationDragData(
  dataTransfer: DataTransfer,
): PresentationDragPayload | null {
  const raw = dataTransfer.getData(PRESENTATION_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PresentationDragPayload;
    if (
      typeof parsed.presentationId !== 'string'
      || typeof parsed.fromSessionId !== 'string'
      || typeof parsed.fileName !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * True se il dragover/dragenter event sta trasportando una presentation
 * (e non file di OS). NB: durante dragover la lista files e' VUOTA per
 * design (privacy) — bisogna controllare types.
 */
export function isPresentationDragActive(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes(PRESENTATION_DRAG_MIME);
}

/** True se il dragover trasporta file dal SO (per discriminare upload). */
export function isFilesDragActive(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes('Files');
}
