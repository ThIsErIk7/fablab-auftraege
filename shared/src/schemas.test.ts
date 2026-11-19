import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  invoiceItemPatchSchema, machinePatchSchema, materialPatchSchema, orderPatchSchema, partPatchSchema, processPatchSchema,
} from './schemas.ts';

// Regression: .partial() übernimmt in zod 4 die Standardwerte – ein PATCH { done: true }
// hat dadurch Anzahl und Status zurückgesetzt. Patch-Schemas dürfen nur gesendete Felder liefern.
describe('Patch-Schemas setzen keine Standardwerte', () => {
  it('Teil', () => expect(partPatchSchema.parse({ done: true })).toEqual({ done: true }));
  it('Auftrag', () => expect(orderPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' }));
  it('Maschine', () => expect(machinePatchSchema.parse({ active: false })).toEqual({ active: false }));
  it('Material', () => expect(materialPatchSchema.parse({ priceMills: 35 })).toEqual({ priceMills: 35 }));
  it('Verfahren', () => expect(processPatchSchema.parse({ active: false })).toEqual({ active: false }));
  it('Rechnungsposition', () => expect(invoiceItemPatchSchema.parse({ quantity: 2 })).toEqual({ quantity: 2 }));
  it('validiert weiterhin', () => {
    expect(() => partPatchSchema.parse({ quantity: 0 })).toThrow();
    expect(partPatchSchema.parse({ notes: '' })).toEqual({ notes: null });
    expect(z.object({}).parse({})).toEqual({});
  });
});
