import Stripe from "stripe";

const key =
  process.env.NODE_ENV === "development"
    ? (process.env.STRIPE_SECRET_KEY_LOCAL ?? process.env.STRIPE_SECRET_KEY!)
    : process.env.STRIPE_SECRET_KEY!;

export const stripe = new Stripe(key);
