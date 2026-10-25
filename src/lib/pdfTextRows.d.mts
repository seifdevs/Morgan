export type PositionedText = { str: string; x: number; y: number; width: number };
export function pdfTextRows(items: PositionedText[], rowTolerance?: number, columnGap?: number): string[][];
