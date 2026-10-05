-- Mobile wallets as payment modes (roadmap Phase 1B): bKash and Nagad in Bangladesh, eSewa and
-- Khalti in Nepal. Record-only — the app notes how a worker was paid, it does not move money.
ALTER TYPE "payment_mode" ADD VALUE IF NOT EXISTS 'bkash';
ALTER TYPE "payment_mode" ADD VALUE IF NOT EXISTS 'nagad';
ALTER TYPE "payment_mode" ADD VALUE IF NOT EXISTS 'esewa';
ALTER TYPE "payment_mode" ADD VALUE IF NOT EXISTS 'khalti';
