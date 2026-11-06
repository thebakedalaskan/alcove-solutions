import { type CreditBalance } from './schema';
export interface CreditsApi {
  balance(): Promise<CreditBalance>;
}
