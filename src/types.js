export const MATURITY_RANK = { child: 0, teen: 1, adult: 2 };

export function maturityAllowed(profileMaturity, itemMaturity) {
  return MATURITY_RANK[itemMaturity] <= MATURITY_RANK[profileMaturity];
}
