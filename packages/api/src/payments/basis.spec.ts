import {
  MICRO_RON,
  baniToMicroRon,
  costBasisPerCredit,
  estimateFeeMicroRon,
  microRonToBani,
  vatFromGross,
} from './basis';

describe('payments/basis', () => {
  describe('unit conversion', () => {
    it('round-trips bani through micro-lei', () => {
      expect(baniToMicroRon(2900)).toBe(29 * MICRO_RON);
      expect(microRonToBani(29 * MICRO_RON)).toBe(2900);
    });
  });

  describe('vatFromGross', () => {
    /**
     * The one that is easy to get wrong: Romanian prices are displayed
     * VAT-inclusive, so the tax is extracted from the gross, not added to it.
     * `gross × rate` would overstate it by a factor of `1 + rate`.
     */
    it('extracts VAT from a VAT-inclusive gross rather than adding it', () => {
      const gross = 121 * MICRO_RON;
      expect(vatFromGross(gross, 0.21)).toBe(21 * MICRO_RON);
    });

    it('is zero when the rate is zero', () => {
      expect(vatFromGross(100 * MICRO_RON, 0)).toBe(0);
    });
  });

  describe('costBasisPerCredit', () => {
    it('subtracts both the Stripe fee and the VAT we never own', () => {
      const basis = costBasisPerCredit({
        grossMicroRon: 121 * MICRO_RON,
        feeMicroRon: 1 * MICRO_RON,
        credits: 100,
        vatRate: 0.21,
      });

      /* 121 gross − 21 VAT − 1 fee = 99 net over 100 credits. */
      expect(basis).toBe(Math.floor((99 * MICRO_RON) / 100));
    });

    it('lands near the business model figure for the Uzual bundle', () => {
      const basis = costBasisPerCredit({
        grossMicroRon: 99 * MICRO_RON,
        feeMicroRon: estimateFeeMicroRon(99 * MICRO_RON),
        credits: 800,
        vatRate: 0.21,
      });

      /* Business model quotes ~0.099 lei net per credit for Uzual. */
      expect(basis / MICRO_RON).toBeGreaterThan(0.09);
      expect(basis / MICRO_RON).toBeLessThan(0.11);
    });

    it('rounds down, so a basis never flatters the margin reports built on it', () => {
      const basis = costBasisPerCredit({
        grossMicroRon: 10 * MICRO_RON,
        feeMicroRon: 0,
        credits: 3,
        vatRate: 0,
      });

      expect(basis).toBe(Math.floor((10 * MICRO_RON) / 3));
      expect(basis * 3).toBeLessThanOrEqual(10 * MICRO_RON);
    });

    it('floors at zero when fees and VAT exceed the gross', () => {
      const basis = costBasisPerCredit({
        grossMicroRon: 1 * MICRO_RON,
        feeMicroRon: 5 * MICRO_RON,
        credits: 10,
        vatRate: 0.21,
      });

      expect(basis).toBe(0);
    });

    it('refuses a non-positive credit count rather than dividing by zero', () => {
      expect(() =>
        costBasisPerCredit({
          grossMicroRon: 29 * MICRO_RON,
          feeMicroRon: 0,
          credits: 0,
          vatRate: 0.21,
        }),
      ).toThrow(/positive credit count/);
    });
  });

  describe('estimateFeeMicroRon', () => {
    it('is pessimistic — an estimate must not understate the fee', () => {
      const gross = 99 * MICRO_RON;
      expect(estimateFeeMicroRon(gross)).toBeGreaterThan(gross * 0.014);
    });
  });
});
