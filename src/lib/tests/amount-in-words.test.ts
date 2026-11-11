import { describe, expect, it } from 'vitest';
import { invoiceTotalMention, numberInWords } from '@/lib/amount-in-words';
import { cadastralRequired, formatCadastralRef, parseCadastralRef } from '@/lib/cadastral';

describe('numberInWords', () => {
  it.each([
    [0, 'zéro'], [1, 'un'], [16, 'seize'], [17, 'dix-sept'], [21, 'vingt et un'], [22, 'vingt-deux'],
    [70, 'soixante-dix'], [71, 'soixante et onze'], [77, 'soixante-dix-sept'], [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'], [101, 'cent un'], [200, 'deux cents'], [280, 'deux cent quatre-vingts'], [201, 'deux cent un'],
    [1000, 'mille'], [1001, 'mille un'], [2000, 'deux mille'], [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'], [118000, 'cent dix-huit mille'], [1_000_000, 'un million'],
    [2_500_000, 'deux millions cinq cent mille'], [1_234_567, 'un million deux cent trente-quatre mille cinq cent soixante-sept'],
    [3_000_000_000, 'trois milliards'],
  ])('%i → %s', (n, words) => {
    expect(numberInWords(n)).toBe(words);
  });

  it('builds the invoice mention', () => {
    expect(invoiceTotalMention(118000)).toBe('Arrêtée la présente facture à la somme de cent dix-huit mille francs CFA.');
    expect(invoiceTotalMention(2000, 'devis')).toBe('Arrêté le présent devis à la somme de deux mille francs CFA.');
  });
});

describe('cadastral reference', () => {
  it('accepts 11 digits in any spacing and prints SSSS LLL PPPP', () => {
    expect(parseCadastralRef('0123 456 7890')).toBe('01234567890');
    expect(parseCadastralRef('01234567890')).toBe('01234567890');
    expect(parseCadastralRef('0123 456')).toBeNull();
    expect(formatCadastralRef('01234567890')).toBe('0123 456 7890');
  });
  it('is required in Burkina Faso only', () => {
    expect(cadastralRequired('Burkina Faso')).toBe(true);
    expect(cadastralRequired('Sénégal')).toBe(false);
  });
});
