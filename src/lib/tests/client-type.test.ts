import { describe, expect, it } from 'vitest';
import { clientTypeDef, clientTypeOf, isClientType } from '@/lib/client-type';

describe('client type', () => {
  it('keeps a valid type', () => {
    expect(clientTypeOf({ clientType: 'PC', ifu: '' })).toBe('PC');
    expect(clientTypeOf({ clientType: 'CC' })).toBe('CC');
  });
  it('infers PM with an IFU and PP without for older clients', () => {
    expect(clientTypeOf({ ifu: '00012345B' })).toBe('PM');
    expect(clientTypeOf({ ifu: '  ' })).toBe('PP');
    expect(clientTypeOf({ clientType: 'XX', ifu: '' })).toBe('PP');
  });
  it('gives the mention printed on the invoice and the IFU rule', () => {
    expect(clientTypeDef('PM').mention).toBe('[PM] Personne morale');
    expect(clientTypeDef('PC').ifuRequired).toBe(true);
    expect(clientTypeDef('PP').ifuRequired).toBe(false);
    expect(isClientType('CC')).toBe(true);
    expect(isClientType('pm')).toBe(false);
  });
});
